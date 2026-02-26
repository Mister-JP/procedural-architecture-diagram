#!/usr/bin/env python3
"""Generate scaled U-Net architecture JSON variants from the polished template.

The script uses `src/config/U-NetArchitecture.json` as the reference layout,
then updates channels and reflows x positions to avoid overlap.
"""

from __future__ import annotations

import argparse
import bisect
import copy
import json
import re
from pathlib import Path
from typing import Dict, List, Tuple

DIMENSION_TEXT_RE = re.compile(r"^(\d+)×(\d+)×(\d+)$")

# Tensor order in this architecture. We preserve the relative pipeline shape.
TENSOR_ORDER = [
    "Input",
    "Enc1_Conv1",
    "Enc1_Conv2",
    "Enc2_Conv1",
    "Enc2_Conv2",
    "Enc2_Conv3",
    "Enc3_Conv1",
    "Enc3_Conv2",
    "Enc3_Conv3",
    "Enc4_Conv1",
    "Enc4_Conv2",
    "Enc4_Conv3",
    "Bottleneck_1",
    "Bottleneck_2",
    "SE_Pool",
    "SE_FC1",
    "SE_FC2",
    "SE_Sigmoid",
    "SE_Scale",
    "Expand",
    "Project",
    "Dec4_Conv1",
    "Dec4_Conv2",
    "Dec4_Conv3",
    "Dec3_Conv1",
    "Dec3_Conv2",
    "Dec3_Conv3",
    "Dec2_Conv1",
    "Dec2_Conv2",
    "Dec2_Conv3",
    "Dec1_Conv1",
    "Dec1_Conv2",
    "Dec1_Conv3",
    "Output",
]

# Arrows whose lengths should be recomputed from tensor edge-to-edge spacing.
HORIZONTAL_ARROW_LINKS = {
    "SE Skip": ("Bottleneck_2", "SE_Scale"),
    "Skip Connection 4": ("Enc4_Conv3", "Dec4_Conv1"),
    "Skip Connection 3": ("Enc3_Conv3", "Dec3_Conv1"),
    "Skip Connection 2": ("Enc2_Conv3", "Dec2_Conv1"),
    "Skip Connection 1": ("Enc1_Conv2", "Dec1_Conv1"),
}

# Arrows that should track a tensor's x-position (with preserved base offset).
ARROW_X_ANCHORS = {
    "Downsample 1\u21922": "Enc1_Conv2",
    "Downsample 2\u21923": "Enc2_Conv3",
    "Downsample 3\u21924": "Enc3_Conv3",
    "Downsample 4\u2192B": "Enc4_Conv3",
    "SE Squeeze Arrow": "SE_Pool",
    "SE Sigmoid Arrow": "SE_FC2",
    "SE Broadcast Arrow": "SE_Sigmoid",
    "Upsample_4": "Project",
    "Upsample_3": "Dec4_Conv3",
    "Upsample_2": "Dec3_Conv3",
    "Upsample_1": "Dec2_Conv3",
}

PRESETS = {
    "small": 32,
    "medium": 64,
    "large": 128,
}


def get_elements_by_type(document: dict, element_type: str) -> Dict[str, dict]:
    return {
        element["name"]: element
        for element in document.get("elements", [])
        if element.get("type") == element_type and isinstance(element.get("name"), str)
    }


def tensor_span_channels(tensor: dict, channels_override: int | None = None) -> float:
    channels = channels_override
    if channels is None:
        channels = int(tensor["data"]["dimensions"]["channels"])
    scale = float(tensor["data"]["scale"]["channel"])
    return channels * scale


def tensor_x(tensor: dict) -> float:
    return float(tensor["transform"]["position"][0])


def tensor_left(tensor: dict, channels_override: int | None = None) -> float:
    span = tensor_span_channels(tensor, channels_override)
    return tensor_x(tensor) - span * 0.5


def tensor_right(tensor: dict, channels_override: int | None = None) -> float:
    span = tensor_span_channels(tensor, channels_override)
    return tensor_x(tensor) + span * 0.5


def build_channel_plan(stage1_channels: int, input_channels: int, output_channels: int) -> Dict[str, int]:
    c1 = stage1_channels
    c2 = c1 * 2
    c3 = c2 * 2
    c4 = c3 * 2
    c5 = c4 * 2

    return {
        "Input": input_channels,
        "Enc1_Conv1": c1,
        "Enc1_Conv2": c1,
        "Enc2_Conv1": c2,
        "Enc2_Conv2": c2,
        "Enc2_Conv3": c2,
        "Enc3_Conv1": c3,
        "Enc3_Conv2": c3,
        "Enc3_Conv3": c3,
        "Enc4_Conv1": c4,
        "Enc4_Conv2": c4,
        "Enc4_Conv3": c4,
        "Bottleneck_1": c5,
        "Bottleneck_2": c5,
        "SE_Pool": c5,
        "SE_FC1": c5 // 4,
        "SE_FC2": c5,
        "SE_Sigmoid": c5,
        "SE_Scale": c5,
        "Expand": c5 * 4,
        "Project": c5,
        "Dec4_Conv1": c5,
        "Dec4_Conv2": c4,
        "Dec4_Conv3": c4,
        "Dec3_Conv1": c4,
        "Dec3_Conv2": c3,
        "Dec3_Conv3": c3,
        "Dec2_Conv1": c3,
        "Dec2_Conv2": c2,
        "Dec2_Conv3": c2,
        "Dec1_Conv1": c2,
        "Dec1_Conv2": c1,
        "Dec1_Conv3": c1,
        "Output": output_channels,
    }


def compute_tensor_positions(
    base_tensors: Dict[str, dict],
    new_channels: Dict[str, int],
) -> Dict[str, float]:
    missing = [name for name in TENSOR_ORDER if name not in base_tensors]
    if missing:
        raise ValueError(f"Template is missing tensors: {', '.join(missing)}")

    base_x = {name: tensor_x(base_tensors[name]) for name in TENSOR_ORDER}
    base_left = {name: tensor_left(base_tensors[name]) for name in TENSOR_ORDER}
    base_right = {name: tensor_right(base_tensors[name]) for name in TENSOR_ORDER}

    new_spans = {
        name: tensor_span_channels(base_tensors[name], new_channels[name])
        for name in TENSOR_ORDER
    }

    def gap(left_name: str, right_name: str) -> float:
        return base_left[right_name] - base_right[left_name]

    def delta(ref_name: str, target_name: str) -> float:
        return base_x[target_name] - base_x[ref_name]

    x: Dict[str, float] = {}

    def right(name: str) -> float:
        return x[name] + new_spans[name] * 0.5

    # Encoder + bottleneck + decoder chain.
    x["Input"] = base_x["Input"]
    x["Enc1_Conv1"] = right("Input") + gap("Input", "Enc1_Conv1") + new_spans["Enc1_Conv1"] * 0.5
    x["Enc1_Conv2"] = right("Enc1_Conv1") + gap("Enc1_Conv1", "Enc1_Conv2") + new_spans["Enc1_Conv2"] * 0.5
    x["Enc2_Conv1"] = x["Enc1_Conv2"] + delta("Enc1_Conv2", "Enc2_Conv1")
    x["Enc2_Conv2"] = right("Enc2_Conv1") + gap("Enc2_Conv1", "Enc2_Conv2") + new_spans["Enc2_Conv2"] * 0.5
    x["Enc2_Conv3"] = right("Enc2_Conv2") + gap("Enc2_Conv2", "Enc2_Conv3") + new_spans["Enc2_Conv3"] * 0.5
    x["Enc3_Conv1"] = x["Enc2_Conv3"] + delta("Enc2_Conv3", "Enc3_Conv1")
    x["Enc3_Conv2"] = right("Enc3_Conv1") + gap("Enc3_Conv1", "Enc3_Conv2") + new_spans["Enc3_Conv2"] * 0.5
    x["Enc3_Conv3"] = right("Enc3_Conv2") + gap("Enc3_Conv2", "Enc3_Conv3") + new_spans["Enc3_Conv3"] * 0.5
    x["Enc4_Conv1"] = x["Enc3_Conv3"] + delta("Enc3_Conv3", "Enc4_Conv1")
    x["Enc4_Conv2"] = right("Enc4_Conv1") + gap("Enc4_Conv1", "Enc4_Conv2") + new_spans["Enc4_Conv2"] * 0.5
    x["Enc4_Conv3"] = right("Enc4_Conv2") + gap("Enc4_Conv2", "Enc4_Conv3") + new_spans["Enc4_Conv3"] * 0.5
    x["Bottleneck_1"] = x["Enc4_Conv3"] + delta("Enc4_Conv3", "Bottleneck_1")
    x["Bottleneck_2"] = right("Bottleneck_1") + gap("Bottleneck_1", "Bottleneck_2") + new_spans["Bottleneck_2"] * 0.5
    x["SE_Pool"] = x["Bottleneck_2"] + delta("Bottleneck_2", "SE_Pool")
    x["SE_FC1"] = right("SE_Pool") + gap("SE_Pool", "SE_FC1") + new_spans["SE_FC1"] * 0.5
    x["SE_FC2"] = right("SE_FC1") + gap("SE_FC1", "SE_FC2") + new_spans["SE_FC2"] * 0.5
    x["SE_Sigmoid"] = x["SE_FC2"] + delta("SE_FC2", "SE_Sigmoid")
    x["SE_Scale"] = x["SE_Sigmoid"] + delta("SE_Sigmoid", "SE_Scale")
    x["Expand"] = right("SE_Scale") + gap("SE_Scale", "Expand") + new_spans["Expand"] * 0.5
    x["Project"] = right("Expand") + gap("Expand", "Project") + new_spans["Project"] * 0.5
    x["Dec4_Conv1"] = x["Project"] + delta("Project", "Dec4_Conv1")
    x["Dec4_Conv2"] = right("Dec4_Conv1") + gap("Dec4_Conv1", "Dec4_Conv2") + new_spans["Dec4_Conv2"] * 0.5
    x["Dec4_Conv3"] = right("Dec4_Conv2") + gap("Dec4_Conv2", "Dec4_Conv3") + new_spans["Dec4_Conv3"] * 0.5
    x["Dec3_Conv1"] = x["Dec4_Conv3"] + delta("Dec4_Conv3", "Dec3_Conv1")
    x["Dec3_Conv2"] = right("Dec3_Conv1") + gap("Dec3_Conv1", "Dec3_Conv2") + new_spans["Dec3_Conv2"] * 0.5
    x["Dec3_Conv3"] = right("Dec3_Conv2") + gap("Dec3_Conv2", "Dec3_Conv3") + new_spans["Dec3_Conv3"] * 0.5
    x["Dec2_Conv1"] = x["Dec3_Conv3"] + delta("Dec3_Conv3", "Dec2_Conv1")
    x["Dec2_Conv2"] = right("Dec2_Conv1") + gap("Dec2_Conv1", "Dec2_Conv2") + new_spans["Dec2_Conv2"] * 0.5
    x["Dec2_Conv3"] = right("Dec2_Conv2") + gap("Dec2_Conv2", "Dec2_Conv3") + new_spans["Dec2_Conv3"] * 0.5
    x["Dec1_Conv1"] = x["Dec2_Conv3"] + delta("Dec2_Conv3", "Dec1_Conv1")
    x["Dec1_Conv2"] = right("Dec1_Conv1") + gap("Dec1_Conv1", "Dec1_Conv2") + new_spans["Dec1_Conv2"] * 0.5
    x["Dec1_Conv3"] = right("Dec1_Conv2") + gap("Dec1_Conv2", "Dec1_Conv3") + new_spans["Dec1_Conv3"] * 0.5
    x["Output"] = right("Dec1_Conv3") + gap("Dec1_Conv3", "Output") + new_spans["Output"] * 0.5

    return x


def build_piecewise_mapper(base_tensor_x: Dict[str, float], new_tensor_x: Dict[str, float]):
    grouped: Dict[float, List[float]] = {}
    for name, old_x in base_tensor_x.items():
        grouped.setdefault(old_x, []).append(new_tensor_x[name])

    old_points = sorted(grouped.keys())
    new_points = [sum(grouped[x]) / len(grouped[x]) for x in old_points]

    if len(old_points) < 2:
        return lambda value: value

    slopes = []
    for idx in range(len(old_points) - 1):
        old_a = old_points[idx]
        old_b = old_points[idx + 1]
        new_a = new_points[idx]
        new_b = new_points[idx + 1]
        if abs(old_b - old_a) < 1e-9:
            slopes.append(1.0)
        else:
            slopes.append((new_b - new_a) / (old_b - old_a))

    def map_x(value: float) -> float:
        if value <= old_points[0]:
            slope = slopes[0]
            return new_points[0] + (value - old_points[0]) * slope
        if value >= old_points[-1]:
            slope = slopes[-1]
            return new_points[-1] + (value - old_points[-1]) * slope

        index = bisect.bisect_right(old_points, value) - 1
        index = max(0, min(index, len(slopes) - 1))
        slope = slopes[index]
        return new_points[index] + (value - old_points[index]) * slope

    return map_x


def format_dim_text(channels: int, height: int, width: int) -> str:
    return f"{channels}×{height}×{width}"


def update_dimension_labels(
    document: dict,
    tensors_by_name: Dict[str, dict],
) -> None:
    special_label_dims = {
        "Dec4_Skip Dim": (
            int(tensors_by_name["Enc4_Conv3"]["data"]["dimensions"]["channels"]),
            int(tensors_by_name["Enc4_Conv3"]["data"]["dimensions"]["height"]),
            int(tensors_by_name["Enc4_Conv3"]["data"]["dimensions"]["width"]),
        ),
        "Dec3_Skip Dim": (
            int(tensors_by_name["Dec3_Conv1"]["data"]["dimensions"]["channels"]),
            int(tensors_by_name["Dec3_Conv1"]["data"]["dimensions"]["height"]),
            int(tensors_by_name["Dec3_Conv1"]["data"]["dimensions"]["width"]),
        ),
    }

    labels = [element for element in document["elements"] if element.get("type") == "label"]

    for label in labels:
        label_name = label.get("name", "")
        text = label.get("data", {}).get("text", "")
        if not isinstance(text, str) or not DIMENSION_TEXT_RE.match(text):
            continue

        if isinstance(label_name, str) and label_name.endswith(" Dim"):
            tensor_name = label_name[: -len(" Dim")]
            if tensor_name in tensors_by_name:
                dims = tensors_by_name[tensor_name]["data"]["dimensions"]
                label["data"]["text"] = format_dim_text(
                    int(dims["channels"]),
                    int(dims["height"]),
                    int(dims["width"]),
                )
                continue

        if label_name in special_label_dims:
            c, h, w = special_label_dims[label_name]
            label["data"]["text"] = format_dim_text(c, h, w)


def update_tensor_channels(document: dict, channel_plan: Dict[str, int]) -> Dict[str, dict]:
    tensors = get_elements_by_type(document, "tensor")
    for name, channels in channel_plan.items():
        if name not in tensors:
            raise ValueError(f"Template does not contain tensor '{name}'")
        tensors[name]["data"]["dimensions"]["channels"] = int(channels)
    return tensors


def retarget_tensor_positions(
    document: dict,
    new_positions: Dict[str, float],
) -> Dict[str, dict]:
    tensors = get_elements_by_type(document, "tensor")
    for name, x_pos in new_positions.items():
        tensors[name]["transform"]["position"][0] = float(x_pos)
    return tensors


def apply_non_tensor_x_warp(
    document: dict,
    map_x,
) -> None:
    for element in document.get("elements", []):
        if element.get("type") == "tensor":
            continue

        position = element.get("transform", {}).get("position")
        if isinstance(position, list) and len(position) >= 1:
            position[0] = float(map_x(float(position[0])))


def get_label_by_name(document: dict, label_name: str) -> dict | None:
    for element in document.get("elements", []):
        if element.get("type") == "label" and element.get("name") == label_name:
            return element
    return None


def preserve_dim_label_offsets(
    variant_doc: dict,
    base_doc: dict,
    new_tensors: Dict[str, dict],
    base_tensors: Dict[str, dict],
) -> None:
    for base_label in base_doc.get("elements", []):
        if base_label.get("type") != "label":
            continue
        label_name = base_label.get("name", "")
        if not isinstance(label_name, str) or not label_name.endswith(" Dim"):
            continue

        tensor_name = label_name[: -len(" Dim")]
        if tensor_name not in base_tensors or tensor_name not in new_tensors:
            continue

        target_label = get_label_by_name(variant_doc, label_name)
        if target_label is None:
            continue

        base_offset = (
            float(base_label["transform"]["position"][0])
            - float(base_tensors[tensor_name]["transform"]["position"][0])
        )
        target_label["transform"]["position"][0] = (
            float(new_tensors[tensor_name]["transform"]["position"][0]) + base_offset
        )


def update_arrow_links(
    variant_doc: dict,
    base_doc: dict,
    variant_tensors: Dict[str, dict],
    base_tensors: Dict[str, dict],
) -> None:
    variant_arrows = get_elements_by_type(variant_doc, "arrow")
    base_arrows = get_elements_by_type(base_doc, "arrow")

    # Keep selected vertical arrows attached to their source tensor x.
    for arrow_name, tensor_name in ARROW_X_ANCHORS.items():
        if arrow_name not in variant_arrows or arrow_name not in base_arrows:
            continue
        if tensor_name not in variant_tensors or tensor_name not in base_tensors:
            continue

        base_arrow_x = float(base_arrows[arrow_name]["transform"]["position"][0])
        base_tensor_x = float(base_tensors[tensor_name]["transform"]["position"][0])
        new_tensor_x = float(variant_tensors[tensor_name]["transform"]["position"][0])
        variant_arrows[arrow_name]["transform"]["position"][0] = new_tensor_x + (base_arrow_x - base_tensor_x)

    # Recompute horizontal skip/SE arrows from tensor edge spacing.
    for arrow_name, (source_tensor, target_tensor) in HORIZONTAL_ARROW_LINKS.items():
        if arrow_name not in variant_arrows or arrow_name not in base_arrows:
            continue
        if source_tensor not in variant_tensors or target_tensor not in variant_tensors:
            continue

        base_arrow = base_arrows[arrow_name]
        variant_arrow = variant_arrows[arrow_name]

        base_source_right = tensor_right(base_tensors[source_tensor])
        base_target_left = tensor_left(base_tensors[target_tensor])
        base_edge_distance = base_target_left - base_source_right
        base_midpoint = (base_source_right + base_target_left) * 0.5

        base_arrow_x = float(base_arrow["transform"]["position"][0])
        base_arrow_length = float(base_arrow["data"]["length"])

        center_offset = base_arrow_x - base_midpoint
        length_offset = base_arrow_length - base_edge_distance

        variant_source_right = tensor_right(variant_tensors[source_tensor])
        variant_target_left = tensor_left(variant_tensors[target_tensor])
        variant_edge_distance = variant_target_left - variant_source_right
        variant_midpoint = (variant_source_right + variant_target_left) * 0.5

        variant_arrow["transform"]["position"][0] = variant_midpoint + center_offset
        variant_arrow["data"]["length"] = max(4.0, variant_edge_distance + length_offset)


def adjust_camera(document: dict, base_doc: dict, map_x, width_ratio: float) -> None:
    scene = document.get("scene", {})
    base_scene = base_doc.get("scene", {})

    if isinstance(scene.get("cameraPosition"), list) and len(scene["cameraPosition"]) == 3:
        base_camera = base_scene.get("cameraPosition", scene["cameraPosition"])
        if isinstance(base_camera, list) and len(base_camera) == 3:
            scene["cameraPosition"][0] = float(map_x(float(base_camera[0])))
            scene["cameraPosition"][2] = float(base_camera[2]) * max(1.0, width_ratio)

    if isinstance(scene.get("cameraTarget"), list) and len(scene["cameraTarget"]) == 3:
        base_target = base_scene.get("cameraTarget", scene["cameraTarget"])
        if isinstance(base_target, list) and len(base_target) == 3:
            scene["cameraTarget"][0] = float(map_x(float(base_target[0])))


def compute_tensor_width_range(tensors: Dict[str, dict]) -> Tuple[float, float]:
    left = min(tensor_left(tensor) for tensor in tensors.values())
    right = max(tensor_right(tensor) for tensor in tensors.values())
    return left, right


def generate_variant(
    base_doc: dict,
    stage1_channels: int,
    input_channels: int,
    output_channels: int,
) -> dict:
    variant_doc = copy.deepcopy(base_doc)

    base_tensors = get_elements_by_type(base_doc, "tensor")
    channel_plan = build_channel_plan(stage1_channels, input_channels, output_channels)

    new_positions = compute_tensor_positions(base_tensors, channel_plan)
    variant_tensors = update_tensor_channels(variant_doc, channel_plan)
    variant_tensors = retarget_tensor_positions(variant_doc, new_positions)

    base_tensor_x = {name: tensor_x(tensor) for name, tensor in base_tensors.items()}
    new_tensor_x = {name: tensor_x(tensor) for name, tensor in variant_tensors.items()}
    map_x = build_piecewise_mapper(base_tensor_x, new_tensor_x)

    apply_non_tensor_x_warp(variant_doc, map_x)
    preserve_dim_label_offsets(variant_doc, base_doc, variant_tensors, base_tensors)
    update_dimension_labels(variant_doc, variant_tensors)
    update_arrow_links(variant_doc, base_doc, variant_tensors, base_tensors)

    base_left, base_right = compute_tensor_width_range(base_tensors)
    new_left, new_right = compute_tensor_width_range(variant_tensors)
    width_ratio = (new_right - new_left) / max(1e-6, base_right - base_left)
    adjust_camera(variant_doc, base_doc, map_x, width_ratio)

    return variant_doc


def parse_stage_channels(raw_value: str) -> int:
    value = int(raw_value)
    if value <= 0:
        raise argparse.ArgumentTypeError("stage-1 channels must be positive")
    if value % 2 != 0:
        raise argparse.ArgumentTypeError("stage-1 channels must be even for clean U-Net doubling")
    return value


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def build_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--template",
        type=Path,
        default=Path("src/config/U-NetArchitecture.json"),
        help="Path to the polished small U-Net JSON template.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("src/config"),
        help="Directory where generated variant JSON files are written.",
    )
    parser.add_argument(
        "--preset",
        choices=sorted(PRESETS.keys()),
        action="append",
        help="Preset(s) to generate. Can be passed multiple times.",
    )
    parser.add_argument(
        "--stage1-channels",
        type=parse_stage_channels,
        action="append",
        help="Custom stage-1 channel count(s). Produces files named custom-<channels>.",
    )
    parser.add_argument(
        "--input-channels",
        type=int,
        default=23,
        help="Input tensor channels.",
    )
    parser.add_argument(
        "--output-channels",
        type=int,
        default=6,
        help="Output tensor channels.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be generated without writing files.",
    )
    return parser


def collect_variant_requests(args) -> List[Tuple[str, int]]:
    requests: List[Tuple[str, int]] = []

    presets = args.preset or ["medium", "large"]
    for preset_name in presets:
        requests.append((preset_name, PRESETS[preset_name]))

    if args.stage1_channels:
        for stage1 in args.stage1_channels:
            requests.append((f"custom-{stage1}", stage1))

    # De-duplicate while preserving order.
    seen = set()
    unique_requests = []
    for name, stage1 in requests:
        key = (name, stage1)
        if key in seen:
            continue
        seen.add(key)
        unique_requests.append((name, stage1))

    return unique_requests


def main() -> int:
    parser = build_cli_parser()
    args = parser.parse_args()

    if args.input_channels <= 0 or args.output_channels <= 0:
        parser.error("input-channels and output-channels must be positive")

    if not args.template.exists():
        parser.error(f"template does not exist: {args.template}")

    with args.template.open("r", encoding="utf-8") as handle:
        base_doc = json.load(handle)

    requests = collect_variant_requests(args)
    if not requests:
        parser.error("No variants requested")

    for variant_name, stage1_channels in requests:
        variant_doc = generate_variant(
            base_doc,
            stage1_channels=stage1_channels,
            input_channels=args.input_channels,
            output_channels=args.output_channels,
        )

        output_name = f"U-NetArchitecture-{variant_name}.json"
        output_path = args.output_dir / output_name

        if args.dry_run:
            print(f"[dry-run] {output_path} (stage1={stage1_channels})")
            continue

        write_json(output_path, variant_doc)
        print(f"Wrote {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
