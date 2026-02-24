const DOCUMENT_VERSION = 1;

export { DOCUMENT_VERSION };

export const ELEMENT_TYPES = {
  tensor: "tensor",
  arrow: "arrow",
  label: "label"
};

const DEFAULT_SCENE = {
  background: "#0f1624",
  cameraPosition: [0, 0, 260]
};

const DEFAULT_TENSOR_DATA = {
  shape: [3, 3, 3],
  voxel: {
    pixelSize: 2,
    pixelDepth: 1.2,
    gap: 0.25,
    layerGap: 0.35
  },
  style: {
    startColor: "#ff7676",
    endColor: "#4a0606",
    fillOpacity: 1,
    borderColor: "#111111",
    borderOpacity: 1
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
  return {
    shape: [
      asInteger(data?.shape?.[0], DEFAULT_TENSOR_DATA.shape[0]),
      asInteger(data?.shape?.[1], DEFAULT_TENSOR_DATA.shape[1]),
      asInteger(data?.shape?.[2], DEFAULT_TENSOR_DATA.shape[2])
    ],
    voxel: {
      pixelSize: clamp(data?.voxel?.pixelSize, 0.2, 20, DEFAULT_TENSOR_DATA.voxel.pixelSize),
      pixelDepth: clamp(data?.voxel?.pixelDepth, 0.1, 20, DEFAULT_TENSOR_DATA.voxel.pixelDepth),
      gap: clamp(data?.voxel?.gap, 0, 10, DEFAULT_TENSOR_DATA.voxel.gap),
      layerGap: clamp(data?.voxel?.layerGap, 0, 10, DEFAULT_TENSOR_DATA.voxel.layerGap)
    },
    style: {
      startColor: asColor(data?.style?.startColor, DEFAULT_TENSOR_DATA.style.startColor),
      endColor: asColor(data?.style?.endColor, DEFAULT_TENSOR_DATA.style.endColor),
      fillOpacity: clamp(data?.style?.fillOpacity, 0, 1, DEFAULT_TENSOR_DATA.style.fillOpacity),
      borderColor: asColor(data?.style?.borderColor, DEFAULT_TENSOR_DATA.style.borderColor),
      borderOpacity: clamp(data?.style?.borderOpacity, 0, 1, DEFAULT_TENSOR_DATA.style.borderOpacity)
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
  } else {
    base.data = normalizeLabelData(rawElement?.data);
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
