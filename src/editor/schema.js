const DOCUMENT_VERSION = 1;

export { DOCUMENT_VERSION };

export const ELEMENT_TYPES = {
  tensor: "tensor",
  arrow: "arrow",
  label: "label",
  frustum: "frustum"
};

const DEFAULT_SCENE = {
  background: "#0f1624",
  cameraPosition: [0, 0, 260]
};

const DEFAULT_TENSOR_DATA = {
  dimensions: {
    channels: 3,
    height: 3,
    width: 3
  },
  scale: {
    channel: 1.2,
    height: 2,
    width: 2
  },
  style: {
    startColor: "#ff7676",
    endColor: "#4a0606",
    fillOpacity: 0.42,
    borderColor: "#111111",
    borderOpacity: 0.44
  },
  labels: {
    enabled: true,
    textColor: "#0f172a",
    textOpacity: 0.95,
    backgroundColor: "#ffffff",
    backgroundOpacity: 0.78,
    borderColor: "#334155",
    borderOpacity: 0.35,
    scaleHeight: 2.8
  },
  convolution: {
    parentTensorId: "",
    targetTensorId: "",
    branchOrder: 0,
    layout: {
      branchSpacing: 1,
      branchOffset: [0, 0, 0]
    },
    kernel: {
      height: 3,
      width: 3,
      channels: null,
      offset: [0, 0, 0],
      color: "#3b82f6",
      opacity: 0.82,
      borderColor: "#0f172a",
      borderOpacity: 0.68,
      labelScaleHeight: 2.4
    },
    pyramid: {
      color: "#60a5fa",
      opacity: 0.24,
      borderColor: "#1d4ed8",
      borderOpacity: 0.45,
      spread: 1.65
    }
  }
};

const DEFAULT_ARROW_DATA = {
  arrowType: "3d",
  length: 42,
  thickness: 1.4,
  headLength: 7,
  headWidth: 4,
  color: "#9cd8ff",
  opacity: 1,
  dashSize: 2.5,
  gapSize: 1.3,
  controlPoint: [0, 12, 0]
};

const DEFAULT_LABEL_DATA = {
  text: "Layer Label",
  fontFamily: "Arial",
  fontSize: 56,
  textColor: "#e7f4ff",
  textOpacity: 1,
  backgroundColor: "#0f1624",
  backgroundOpacity: 0.86,
  borderColor: "#9cd8ff",
  borderOpacity: 1,
  borderWidth: 5,
  padding: 20,
  scaleHeight: 10
};

const DEFAULT_FRUSTUM_DATA = {
  topSize: 18,
  bottomSize: 32,
  length: 36,
  color: "#7bc5ff",
  opacity: 1,
  borderColor: "#111111",
  borderOpacity: 1
};

const DEFAULT_TRANSFORM = {
  position: [0, 0, 0],
  rotation: [0, 0, 0]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asInteger(value, fallback, min = 1) {
  return Math.max(min, Math.round(asNumber(value, fallback)));
}

function asOptionalInteger(value, fallback = null, min = 1) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(min, Math.round(parsed));
}

function asNonNegativeInteger(value, fallback = 0) {
  return Math.max(0, Math.round(asNumber(value, fallback)));
}

function clamp(value, min, max, fallback) {
  const number = asNumber(value, fallback);
  return Math.min(max, Math.max(min, number));
}

function asColor(value, fallback) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  const trimmed = value.trim();
  const fullHexMatch = /^#?[0-9a-fA-F]{6}$/.exec(trimmed);
  if (fullHexMatch) {
    return trimmed.startsWith("#") ? trimmed.toLowerCase() : `#${trimmed.toLowerCase()}`;
  }

  const shortHexMatch = /^#?[0-9a-fA-F]{3}$/.exec(trimmed);
  if (shortHexMatch) {
    const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
  }

  return fallback;
}

function asVector3(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) {
    return [...fallback];
  }

  return [
    asNumber(value[0], fallback[0]),
    asNumber(value[1], fallback[1]),
    asNumber(value[2], fallback[2])
  ];
}

function normalizeTransform(transform) {
  return {
    position: asVector3(transform?.position, DEFAULT_TRANSFORM.position),
    rotation: asVector3(transform?.rotation, DEFAULT_TRANSFORM.rotation)
  };
}

function normalizeTensorData(data) {
  const legacyShape = Array.isArray(data?.shape) ? data.shape : [];
  const legacyVoxel = data?.voxel ?? {};
  const legacyChannels = asInteger(legacyShape[0], DEFAULT_TENSOR_DATA.dimensions.channels);
  const legacyHeight = asInteger(legacyShape[1], DEFAULT_TENSOR_DATA.dimensions.height);
  const legacyWidth = asInteger(legacyShape[2], DEFAULT_TENSOR_DATA.dimensions.width);
  const legacySpatialScale = clamp(
    legacyVoxel.pixelSize,
    0.1,
    80,
    DEFAULT_TENSOR_DATA.scale.height
  );
  const legacyChannelScale = clamp(
    legacyVoxel.pixelDepth,
    0.1,
    80,
    DEFAULT_TENSOR_DATA.scale.channel
  );
  const normalizedParentTensorId =
    typeof data?.convolution?.parentTensorId === "string" ? data.convolution.parentTensorId.trim() : "";
  const normalizedTargetTensorId =
    typeof data?.convolution?.targetTensorId === "string" ? data.convolution.targetTensorId.trim() : "";

  return {
    dimensions: {
      channels: asInteger(data?.dimensions?.channels, legacyChannels),
      height: asInteger(data?.dimensions?.height, legacyHeight),
      width: asInteger(data?.dimensions?.width, legacyWidth)
    },
    scale: {
      channel: clamp(data?.scale?.channel, 0.1, 80, legacyChannelScale),
      height: clamp(data?.scale?.height, 0.1, 80, legacySpatialScale),
      width: clamp(data?.scale?.width, 0.1, 80, legacySpatialScale)
    },
    style: {
      startColor: asColor(data?.style?.startColor, DEFAULT_TENSOR_DATA.style.startColor),
      endColor: asColor(data?.style?.endColor, DEFAULT_TENSOR_DATA.style.endColor),
      fillOpacity: clamp(data?.style?.fillOpacity, 0, 1, DEFAULT_TENSOR_DATA.style.fillOpacity),
      borderColor: asColor(data?.style?.borderColor, DEFAULT_TENSOR_DATA.style.borderColor),
      borderOpacity: clamp(data?.style?.borderOpacity, 0, 1, DEFAULT_TENSOR_DATA.style.borderOpacity)
    },
    labels: {
      enabled:
        typeof data?.labels?.enabled === "boolean"
          ? data.labels.enabled
          : DEFAULT_TENSOR_DATA.labels.enabled,
      textColor: asColor(data?.labels?.textColor, DEFAULT_TENSOR_DATA.labels.textColor),
      textOpacity: clamp(data?.labels?.textOpacity, 0, 1, DEFAULT_TENSOR_DATA.labels.textOpacity),
      backgroundColor: asColor(data?.labels?.backgroundColor, DEFAULT_TENSOR_DATA.labels.backgroundColor),
      backgroundOpacity: clamp(
        data?.labels?.backgroundOpacity,
        0,
        1,
        DEFAULT_TENSOR_DATA.labels.backgroundOpacity
      ),
      borderColor: asColor(data?.labels?.borderColor, DEFAULT_TENSOR_DATA.labels.borderColor),
      borderOpacity: clamp(data?.labels?.borderOpacity, 0, 1, DEFAULT_TENSOR_DATA.labels.borderOpacity),
      scaleHeight: clamp(data?.labels?.scaleHeight, 0.4, 30, DEFAULT_TENSOR_DATA.labels.scaleHeight)
    },
    convolution: {
      parentTensorId: normalizedParentTensorId,
      targetTensorId: normalizedTargetTensorId,
      branchOrder: asNonNegativeInteger(
        data?.convolution?.branchOrder,
        DEFAULT_TENSOR_DATA.convolution.branchOrder
      ),
      layout: {
        branchSpacing: clamp(
          data?.convolution?.layout?.branchSpacing,
          0,
          4,
          DEFAULT_TENSOR_DATA.convolution.layout.branchSpacing
        ),
        branchOffset: asVector3(
          data?.convolution?.layout?.branchOffset,
          DEFAULT_TENSOR_DATA.convolution.layout.branchOffset
        )
      },
      kernel: {
        height: asInteger(data?.convolution?.kernel?.height, DEFAULT_TENSOR_DATA.convolution.kernel.height),
        width: asInteger(data?.convolution?.kernel?.width, DEFAULT_TENSOR_DATA.convolution.kernel.width),
        channels: asOptionalInteger(data?.convolution?.kernel?.channels, null),
        offset: asVector3(data?.convolution?.kernel?.offset, DEFAULT_TENSOR_DATA.convolution.kernel.offset),
        color: asColor(data?.convolution?.kernel?.color, DEFAULT_TENSOR_DATA.convolution.kernel.color),
        opacity: clamp(data?.convolution?.kernel?.opacity, 0, 1, DEFAULT_TENSOR_DATA.convolution.kernel.opacity),
        borderColor: asColor(
          data?.convolution?.kernel?.borderColor,
          DEFAULT_TENSOR_DATA.convolution.kernel.borderColor
        ),
        borderOpacity: clamp(
          data?.convolution?.kernel?.borderOpacity,
          0,
          1,
          DEFAULT_TENSOR_DATA.convolution.kernel.borderOpacity
        ),
        labelScaleHeight: clamp(
          data?.convolution?.kernel?.labelScaleHeight,
          0.3,
          40,
          DEFAULT_TENSOR_DATA.convolution.kernel.labelScaleHeight
        )
      },
      pyramid: {
        color: asColor(data?.convolution?.pyramid?.color, DEFAULT_TENSOR_DATA.convolution.pyramid.color),
        opacity: clamp(
          data?.convolution?.pyramid?.opacity,
          0,
          1,
          DEFAULT_TENSOR_DATA.convolution.pyramid.opacity
        ),
        borderColor: asColor(
          data?.convolution?.pyramid?.borderColor,
          DEFAULT_TENSOR_DATA.convolution.pyramid.borderColor
        ),
        borderOpacity: clamp(
          data?.convolution?.pyramid?.borderOpacity,
          0,
          1,
          DEFAULT_TENSOR_DATA.convolution.pyramid.borderOpacity
        ),
        spread: clamp(data?.convolution?.pyramid?.spread, 0.6, 8, DEFAULT_TENSOR_DATA.convolution.pyramid.spread)
      }
    }
  };
}

function normalizeArrowData(data) {
  const arrowType = ["3d", "2d", "dotted", "curved"].includes(data?.arrowType)
    ? data.arrowType
    : DEFAULT_ARROW_DATA.arrowType;

  return {
    arrowType,
    length: clamp(data?.length, 4, 3000, DEFAULT_ARROW_DATA.length),
    thickness: clamp(data?.thickness, 0.1, 100, DEFAULT_ARROW_DATA.thickness),
    headLength: clamp(data?.headLength, 0.3, 800, DEFAULT_ARROW_DATA.headLength),
    headWidth: clamp(data?.headWidth, 0.3, 800, DEFAULT_ARROW_DATA.headWidth),
    color: asColor(data?.color, DEFAULT_ARROW_DATA.color),
    opacity: clamp(data?.opacity, 0, 1, DEFAULT_ARROW_DATA.opacity),
    dashSize: clamp(data?.dashSize, 0.1, 200, DEFAULT_ARROW_DATA.dashSize),
    gapSize: clamp(data?.gapSize, 0.1, 200, DEFAULT_ARROW_DATA.gapSize),
    controlPoint: asVector3(data?.controlPoint, DEFAULT_ARROW_DATA.controlPoint)
  };
}

function normalizeLabelData(data) {
  return {
    text: typeof data?.text === "string" && data.text.trim().length > 0 ? data.text : DEFAULT_LABEL_DATA.text,
    fontFamily:
      typeof data?.fontFamily === "string" && data.fontFamily.trim().length > 0
        ? data.fontFamily
        : DEFAULT_LABEL_DATA.fontFamily,
    fontSize: clamp(data?.fontSize, 8, 180, DEFAULT_LABEL_DATA.fontSize),
    textColor: asColor(data?.textColor, DEFAULT_LABEL_DATA.textColor),
    textOpacity: clamp(data?.textOpacity, 0, 1, DEFAULT_LABEL_DATA.textOpacity),
    backgroundColor: asColor(data?.backgroundColor, DEFAULT_LABEL_DATA.backgroundColor),
    backgroundOpacity: clamp(data?.backgroundOpacity, 0, 1, DEFAULT_LABEL_DATA.backgroundOpacity),
    borderColor: asColor(data?.borderColor, DEFAULT_LABEL_DATA.borderColor),
    borderOpacity: clamp(data?.borderOpacity, 0, 1, DEFAULT_LABEL_DATA.borderOpacity),
    borderWidth: clamp(data?.borderWidth, 0, 40, DEFAULT_LABEL_DATA.borderWidth),
    padding: clamp(data?.padding, 0, 120, DEFAULT_LABEL_DATA.padding),
    scaleHeight: clamp(data?.scaleHeight, 0.1, 120, DEFAULT_LABEL_DATA.scaleHeight)
  };
}

function normalizeFrustumData(data) {
  return {
    topSize: clamp(data?.topSize, 0.2, 2000, DEFAULT_FRUSTUM_DATA.topSize),
    bottomSize: clamp(data?.bottomSize, 0.2, 2000, DEFAULT_FRUSTUM_DATA.bottomSize),
    length: clamp(data?.length, 0.2, 2000, DEFAULT_FRUSTUM_DATA.length),
    color: asColor(data?.color, DEFAULT_FRUSTUM_DATA.color),
    opacity: clamp(data?.opacity, 0, 1, DEFAULT_FRUSTUM_DATA.opacity),
    borderColor: asColor(data?.borderColor, DEFAULT_FRUSTUM_DATA.borderColor),
    borderOpacity: clamp(data?.borderOpacity, 0, 1, DEFAULT_FRUSTUM_DATA.borderOpacity)
  };
}

function normalizeElementName(type, name) {
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim();
  }

  if (type === ELEMENT_TYPES.tensor) {
    return "Tensor";
  }
  if (type === ELEMENT_TYPES.arrow) {
    return "Arrow";
  }
  if (type === ELEMENT_TYPES.frustum) {
    return "Frustum";
  }
  return "Label";
}

function normalizeElement(rawElement) {
  const type = Object.values(ELEMENT_TYPES).includes(rawElement?.type)
    ? rawElement.type
    : ELEMENT_TYPES.tensor;

  const base = {
    id: typeof rawElement?.id === "string" && rawElement.id.trim() ? rawElement.id.trim() : createElementId(type),
    type,
    name: normalizeElementName(type, rawElement?.name),
    transform: normalizeTransform(rawElement?.transform)
  };

  if (type === ELEMENT_TYPES.tensor) {
    base.data = normalizeTensorData(rawElement?.data);
  } else if (type === ELEMENT_TYPES.arrow) {
    base.data = normalizeArrowData(rawElement?.data);
  } else if (type === ELEMENT_TYPES.label) {
    base.data = normalizeLabelData(rawElement?.data);
  } else {
    base.data = normalizeFrustumData(rawElement?.data);
  }

  return base;
}

export function createElementId(type = "element") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${type}-${crypto.randomUUID().slice(0, 8)}`;
  }

  const random = Math.random().toString(36).slice(2, 10);
  return `${type}-${random}`;
}

export function createDefaultElement(type) {
  const normalizedType = Object.values(ELEMENT_TYPES).includes(type)
    ? type
    : ELEMENT_TYPES.tensor;

  return normalizeElement({ type: normalizedType });
}

export function createDefaultDocument() {
  const defaultTensor = createDefaultElement(ELEMENT_TYPES.tensor);
  defaultTensor.transform.position = [0, 0, 0];

  return {
    version: DOCUMENT_VERSION,
    scene: clone(DEFAULT_SCENE),
    elements: [defaultTensor]
  };
}

function normalizeScene(scene) {
  return {
    background: asColor(scene?.background, DEFAULT_SCENE.background),
    cameraPosition: asVector3(scene?.cameraPosition, DEFAULT_SCENE.cameraPosition)
  };
}

export function normalizeDocument(rawDocument) {
  const source = rawDocument && typeof rawDocument === "object" ? rawDocument : {};
  const normalized = {
    version: DOCUMENT_VERSION,
    scene: normalizeScene(source.scene),
    elements: Array.isArray(source.elements)
      ? source.elements.map((element) => normalizeElement(element))
      : []
  };

  if (normalized.elements.length === 0) {
    normalized.elements.push(createDefaultElement(ELEMENT_TYPES.tensor));
  }

  const usedIds = new Set();
  for (const element of normalized.elements) {
    while (usedIds.has(element.id)) {
      element.id = createElementId(element.type);
    }
    usedIds.add(element.id);
  }

  return normalized;
}

export function duplicateElementConfig(element, offset = [12, 8, 0]) {
  const copy = clone(element);
  copy.id = createElementId(element.type);
  copy.name = `${element.name} Copy`;
  copy.transform.position = [
    copy.transform.position[0] + offset[0],
    copy.transform.position[1] + offset[1],
    copy.transform.position[2] + offset[2]
  ];
  return normalizeDocument({ elements: [copy] }).elements[0];
}
