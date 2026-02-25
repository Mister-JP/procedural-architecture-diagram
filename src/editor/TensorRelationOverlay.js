import * as THREE from "three";
import { createLabelSprite } from "../core/label-utils.js";
import {
  clampToTensorBounds,
  getOrthogonalAxes,
  resolveAxisDominance,
  resolveTensorDimensions,
  resolveTensorSpans
} from "../core/tensor-geometry.js";
import { disposeObject3D } from "./elements/dispose-utils.js";

function getAxisSpanMap(spans) {
  return {
    x: spans.channels,
    y: spans.height,
    z: spans.width
  };
}

function toRgba(colorHex, opacity) {
  const color = new THREE.Color(colorHex);
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `rgba(${r},${g},${b},${THREE.MathUtils.clamp(opacity, 0, 1)})`;
}

function createSolidMaterial(color, opacity) {
  const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
  return new THREE.MeshBasicMaterial({
    color,
    transparent: clampedOpacity < 1,
    opacity: clampedOpacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function createLineMaterial(color, opacity) {
  const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
  return new THREE.LineBasicMaterial({
    color,
    transparent: clampedOpacity < 1,
    opacity: clampedOpacity,
    depthWrite: false
  });
}

function createKernelGroup(spanMap, kernelConfig) {
  const group = new THREE.Group();

  const geometry = new THREE.BoxGeometry(
    Math.max(0.001, spanMap.x),
    Math.max(0.001, spanMap.y),
    Math.max(0.001, spanMap.z)
  );

  const mesh = new THREE.Mesh(
    geometry,
    createSolidMaterial(new THREE.Color(kernelConfig.color), kernelConfig.opacity)
  );
  group.add(mesh);

  if (kernelConfig.borderOpacity > 0) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      createLineMaterial(new THREE.Color(kernelConfig.borderColor), kernelConfig.borderOpacity)
    );
    group.add(edges);
  }

  return group;
}

function computeAxisLimit(halfSpan, innerHalfSpan, padding = 0.05) {
  return Math.max(0, halfSpan - innerHalfSpan - padding);
}

function createRectFrustumGeometry({ startWidth, startHeight, endWidth, endHeight, length }) {
  const halfLength = length * 0.5;
  const sw = Math.max(0.02, startWidth);
  const sh = Math.max(0.02, startHeight);
  const ew = Math.max(0.02, endWidth);
  const eh = Math.max(0.02, endHeight);

  const s0 = [-sw * 0.5, -halfLength, -sh * 0.5];
  const s1 = [sw * 0.5, -halfLength, -sh * 0.5];
  const s2 = [sw * 0.5, -halfLength, sh * 0.5];
  const s3 = [-sw * 0.5, -halfLength, sh * 0.5];

  const e0 = [-ew * 0.5, halfLength, -eh * 0.5];
  const e1 = [ew * 0.5, halfLength, -eh * 0.5];
  const e2 = [ew * 0.5, halfLength, eh * 0.5];
  const e3 = [-ew * 0.5, halfLength, eh * 0.5];

  const positions = new Float32Array([
    ...s0, ...s1, ...s2, ...s3,
    ...e0, ...e1, ...e2, ...e3
  ]);

  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createPyramidGroup({
  startPoint,
  endPoint,
  startWidth,
  startHeight,
  endWidth,
  endHeight,
  pyramidConfig
}) {
  const direction = endPoint.clone().sub(startPoint);
  const length = direction.length();
  if (length <= 0.05) {
    return null;
  }

  const geometry = createRectFrustumGeometry({
    startWidth,
    startHeight,
    endWidth,
    endHeight,
    length
  });

  const group = new THREE.Group();

  const mesh = new THREE.Mesh(
    geometry,
    createSolidMaterial(new THREE.Color(pyramidConfig.color), pyramidConfig.opacity)
  );
  group.add(mesh);

  if (pyramidConfig.borderOpacity > 0) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      createLineMaterial(new THREE.Color(pyramidConfig.borderColor), pyramidConfig.borderOpacity)
    );
    group.add(edges);
  }

  const center = startPoint.clone().add(endPoint).multiplyScalar(0.5);
  const normalizedDirection = direction.normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    normalizedDirection
  );

  group.position.copy(center);
  group.quaternion.copy(quaternion);

  return group;
}

function sortByBranchOrder(left, right) {
  const leftOrder = left.source?.data?.convolution?.branchOrder ?? 0;
  const rightOrder = right.source?.data?.convolution?.branchOrder ?? 0;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return (left.source?.id ?? "").localeCompare(right.source?.id ?? "");
}

function computeKernelPlacement({
  parent,
  source,
  output,
  branchIndex,
  branchCount
}) {
  const parentCenter = parent.element.group.getWorldPosition(new THREE.Vector3());
  const outputCenter = output.element.group.getWorldPosition(new THREE.Vector3());
  const parentToOutputWorld = outputCenter.clone().sub(parentCenter);
  if (parentToOutputWorld.lengthSq() <= 1e-8) {
    return null;
  }

  const parentQuaternion = parent.element.group.getWorldQuaternion(new THREE.Quaternion());
  const parentInverseQuaternion = parentQuaternion.clone().invert();
  const parentDirectionLocal = parentToOutputWorld.clone().applyQuaternion(parentInverseQuaternion);

  // Keep the kernel anchored on the channel axis face. Movement is only HxW.
  const parentExit = {
    axis: "x",
    sign: Math.sign(parentDirectionLocal.x) || 1
  };
  const laneAxis = "y";
  const depthAxis = "z";

  const parentAxisSpans = getAxisSpanMap(parent.spans);
  const parentHalf = {
    x: parentAxisSpans.x * 0.5,
    y: parentAxisSpans.y * 0.5,
    z: parentAxisSpans.z * 0.5
  };

  const kernelConfig = source.data.convolution.kernel;
  const kernelDimensions = {
    width: Math.max(1, Math.round(kernelConfig.width)),
    height: Math.max(1, Math.round(kernelConfig.height)),
    channels: Math.max(1, Math.round(kernelConfig.channels ?? parent.dimensions.channels))
  };
  const kernelSpans = {
    width: Math.min(parent.spans.width, kernelDimensions.width * parent.spans.scale.width),
    height: Math.min(parent.spans.height, kernelDimensions.height * parent.spans.scale.height),
    channels: Math.min(parent.spans.channels, kernelDimensions.channels * parent.spans.scale.channels)
  };
  const kernelAxisSpans = getAxisSpanMap(kernelSpans);

  const inset = Math.max(
    0.2,
    Math.min(parent.spans.scale.width, parent.spans.scale.height, parent.spans.scale.channels) * 0.45
  );
  const availableLane = Math.max(0, parentAxisSpans[laneAxis] - kernelAxisSpans[laneAxis] - inset * 2);
  const baseLaneStep = branchCount > 1 ? availableLane / (branchCount - 1) : 0;
  const spacingScale = source.data?.convolution?.layout?.branchSpacing ?? 1;
  const laneStep = baseLaneStep * spacingScale;
  const centeredBranchIndex = branchIndex - (branchCount - 1) * 0.5;

  const baseKernelCenterLocal = new THREE.Vector3();
  baseKernelCenterLocal[parentExit.axis] =
    parentExit.sign * (parentHalf[parentExit.axis] - kernelAxisSpans[parentExit.axis] * 0.5 - inset);
  baseKernelCenterLocal[laneAxis] = centeredBranchIndex * laneStep;
  baseKernelCenterLocal[depthAxis] = 0;

  const [branchOffsetX = 0, branchOffsetY = 0, branchOffsetZ = 0] =
    source.data?.convolution?.layout?.branchOffset ?? [0, 0, 0];
  baseKernelCenterLocal.x += branchOffsetX;
  baseKernelCenterLocal.y += branchOffsetY;
  baseKernelCenterLocal.z += branchOffsetZ;

  const kernelCenterLocal = baseKernelCenterLocal.clone();
  const [, offsetY = 0, offsetZ = 0] = kernelConfig.offset ?? [0, 0, 0];
  kernelCenterLocal.y += offsetY;
  kernelCenterLocal.z += offsetZ;

  const xLimit = computeAxisLimit(parentHalf.x, kernelAxisSpans.x * 0.5);
  const yLimit = computeAxisLimit(parentHalf.y, kernelAxisSpans.y * 0.5);
  const zLimit = computeAxisLimit(parentHalf.z, kernelAxisSpans.z * 0.5);

  const fixedX = THREE.MathUtils.clamp(baseKernelCenterLocal.x, -xLimit, xLimit);
  kernelCenterLocal.x = fixedX;
  kernelCenterLocal.y = clampToTensorBounds(kernelCenterLocal.y, parentHalf.y, kernelAxisSpans.y * 0.5);
  kernelCenterLocal.z = clampToTensorBounds(kernelCenterLocal.z, parentHalf.z, kernelAxisSpans.z * 0.5);

  return {
    outputCenter,
    parentQuaternion,
    parentExit,
    parentHalf,
    kernelConfig,
    kernelDimensions,
    kernelAxisSpans,
    baseKernelCenterLocal,
    kernelCenterLocal,
    movementBounds: {
      y: { min: -yLimit, max: yLimit },
      z: { min: -zLimit, max: zLimit }
    },
    fixedAxis: {
      axis: "x",
      value: fixedX
    }
  };
}

export class TensorRelationOverlay {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = "tensor-relation-overlay";
    this.kernelRelationMetaBySourceId = new Map();
  }

  clear() {
    this.kernelRelationMetaBySourceId.clear();
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      disposeObject3D(child);
    }
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }

  getKernelRelationMetadata(sourceId) {
    if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
      return null;
    }
    return this.kernelRelationMetaBySourceId.get(sourceId.trim()) ?? null;
  }

  getKernelRelationMetadataByParent(parentId) {
    if (typeof parentId !== "string" || parentId.trim().length === 0) {
      return [];
    }

    const normalizedParentId = parentId.trim();
    const relations = [];

    for (const metadata of this.kernelRelationMetaBySourceId.values()) {
      if (metadata.parentId === normalizedParentId) {
        relations.push(metadata);
      }
    }

    return relations;
  }

  rebuild(elements) {
    this.clear();

    const tensors = new Map();
    for (const [id, element] of elements.entries()) {
      if (element.type !== "tensor") {
        continue;
      }

      const data = element.config?.data ?? element.toDocumentElement().data;
      tensors.set(id, {
        id,
        element,
        data,
        spans: resolveTensorSpans(data),
        dimensions: resolveTensorDimensions(data)
      });
    }

    const childrenByParent = new Map();

    for (const tensor of tensors.values()) {
      const parentTensorId = tensor.data?.convolution?.parentTensorId;
      if (typeof parentTensorId !== "string" || parentTensorId.trim().length === 0) {
        continue;
      }

      const parentId = parentTensorId.trim();
      if (!tensors.has(parentId) || parentId === tensor.id) {
        continue;
      }

      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      const targetTensorId = tensor.data?.convolution?.targetTensorId;
      const resolvedTargetId =
        typeof targetTensorId === "string" && targetTensorId.trim().length > 0
          ? targetTensorId.trim()
          : tensor.id;
      const outputTensor = tensors.get(resolvedTargetId) ?? tensor;

      childrenByParent.get(parentId).push({
        source: tensor,
        output: outputTensor
      });
    }

    for (const [parentId, children] of childrenByParent.entries()) {
      const parent = tensors.get(parentId);
      if (!parent || children.length === 0) {
        continue;
      }

      children.sort(sortByBranchOrder);
      for (let index = 0; index < children.length; index += 1) {
        const relation = children[index];
        this.addConvolutionRelation({
          parent,
          source: relation.source,
          output: relation.output,
          branchIndex: index,
          branchCount: children.length
        });
      }
    }
  }

  addConvolutionRelation({ parent, source, output, branchIndex, branchCount }) {
    const placement = computeKernelPlacement({
      parent,
      source,
      output,
      branchIndex,
      branchCount
    });
    if (!placement) {
      return;
    }

    const {
      outputCenter,
      parentQuaternion,
      parentExit,
      parentHalf,
      kernelConfig,
      kernelDimensions,
      kernelAxisSpans,
      baseKernelCenterLocal,
      kernelCenterLocal,
      movementBounds,
      fixedAxis
    } = placement;

    this.kernelRelationMetaBySourceId.set(source.id, {
      sourceId: source.id,
      parentId: parent.id,
      outputId: output.id,
      kernelCenterLocal: kernelCenterLocal.clone(),
      baseKernelCenterLocal: baseKernelCenterLocal.clone(),
      movementBounds: {
        y: { ...movementBounds.y },
        z: { ...movementBounds.z }
      },
      fixedAxis: { ...fixedAxis }
    });

    const kernelCenterWorld = parent.element.group.localToWorld(kernelCenterLocal.clone());
    const kernelExitLocal = kernelCenterLocal.clone();
    kernelExitLocal[parentExit.axis] += parentExit.sign * kernelAxisSpans[parentExit.axis] * 0.5;
    const kernelExitWorld = parent.element.group.localToWorld(kernelExitLocal.clone());

    const kernelGroup = createKernelGroup(
      {
        x: kernelAxisSpans.x,
        y: kernelAxisSpans.y,
        z: kernelAxisSpans.z
      },
      kernelConfig
    );
    kernelGroup.userData.elementId = source.id;
    kernelGroup.userData.elementType = source.type;
    kernelGroup.traverse((node) => {
      node.userData.elementId = source.id;
      node.userData.elementType = source.type;
    });
    kernelGroup.position.copy(kernelCenterWorld);
    kernelGroup.quaternion.copy(parentQuaternion);
    this.group.add(kernelGroup);

    const labelHeightOffset = kernelAxisSpans.y * 0.5 + Math.max(0.45, parent.spans.scale.height * 0.55);
    const kernelLabelLocal = kernelCenterLocal.clone();
    kernelLabelLocal.y += labelHeightOffset;
    const kernelLabelWorld = parent.element.group.localToWorld(kernelLabelLocal.clone());

    const kernelLabel = createLabelSprite(
      `${kernelDimensions.channels}x${kernelDimensions.height}x${kernelDimensions.width}`,
      {
        fontFamily: "Helvetica",
        fontSize: 22,
        textColor: "#1e293b",
        backgroundColor: "rgba(255,255,255,0.82)",
        borderColor: toRgba(kernelConfig.borderColor, kernelConfig.borderOpacity),
        borderWidth: 2,
        padding: 7,
        scaleHeight: kernelConfig.labelScaleHeight
      }
    );
    kernelLabel.position.copy(kernelLabelWorld);
    this.group.add(kernelLabel);

    const outputQuaternion = output.element.group.getWorldQuaternion(new THREE.Quaternion());
    const outputInverseQuaternion = outputQuaternion.clone().invert();
    const outputAxisSpans = getAxisSpanMap(output.spans);
    const outputHalf = {
      x: outputAxisSpans.x * 0.5,
      y: outputAxisSpans.y * 0.5,
      z: outputAxisSpans.z * 0.5
    };

    const outputToKernelWorld = kernelExitWorld.clone().sub(outputCenter);
    const outputDirectionLocal = outputToKernelWorld.clone().applyQuaternion(outputInverseQuaternion);
    const outputFace = resolveAxisDominance(outputDirectionLocal);
    const [outputLaneA, outputLaneB] = getOrthogonalAxes(outputFace.axis);

    const kernelInOutputLocal = output.element.group.worldToLocal(kernelExitWorld.clone());
    const outputFaceLocal = new THREE.Vector3(0, 0, 0);
    outputFaceLocal[outputFace.axis] = outputFace.sign * outputHalf[outputFace.axis];
    outputFaceLocal[outputLaneA] = THREE.MathUtils.clamp(
      kernelInOutputLocal[outputLaneA],
      -outputHalf[outputLaneA] * 0.9,
      outputHalf[outputLaneA] * 0.9
    );
    outputFaceLocal[outputLaneB] = THREE.MathUtils.clamp(
      kernelInOutputLocal[outputLaneB],
      -outputHalf[outputLaneB] * 0.9,
      outputHalf[outputLaneB] * 0.9
    );

    const outputFaceWorld = output.element.group.localToWorld(outputFaceLocal.clone());

    const outputUnitByAxis = {
      x: output.spans.scale.channels,
      y: output.spans.scale.height,
      z: output.spans.scale.width
    };
    const pyramidEndWidth = Math.max(0.02, outputUnitByAxis[outputLaneA] ?? 1);
    const pyramidEndHeight = Math.max(0.02, outputUnitByAxis[outputLaneB] ?? 1);
    const pyramidStartWidth = Math.max(0.02, kernelAxisSpans.y);
    const pyramidStartHeight = Math.max(0.02, kernelAxisSpans.z);

    const pyramidConfig = source.data.convolution.pyramid;
    const pyramidGroup = createPyramidGroup({
      startPoint: kernelExitWorld,
      endPoint: outputFaceWorld,
      startWidth: pyramidStartWidth,
      startHeight: pyramidStartHeight,
      endWidth: pyramidEndWidth,
      endHeight: pyramidEndHeight,
      pyramidConfig
    });

    if (pyramidGroup) {
      this.group.add(pyramidGroup);
    }
  }
}
