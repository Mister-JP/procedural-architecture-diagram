function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveInteger(value, fallback) {
  return Math.max(1, Math.round(toFiniteNumber(value, fallback)));
}

function toPositiveNumber(value, fallback) {
  return Math.max(0.01, toFiniteNumber(value, fallback));
}

export function resolveTensorDimensions(data = {}) {
  const legacyShape = Array.isArray(data.shape) ? data.shape : [];
  return {
    channels: toPositiveInteger(data?.dimensions?.channels, legacyShape[0] ?? 3),
    height: toPositiveInteger(data?.dimensions?.height, legacyShape[1] ?? 3),
    width: toPositiveInteger(data?.dimensions?.width, legacyShape[2] ?? 3)
  };
}

export function resolveTensorScale(data = {}) {
  const legacyVoxel = data?.voxel ?? {};
  return {
    channels: toPositiveNumber(data?.scale?.channel, legacyVoxel.pixelDepth ?? 1.2),
    height: toPositiveNumber(data?.scale?.height, legacyVoxel.pixelSize ?? 2),
    width: toPositiveNumber(data?.scale?.width, legacyVoxel.pixelSize ?? 2)
  };
}

export function resolveTensorSpans(data = {}) {
  const dimensions = resolveTensorDimensions(data);
  const scale = resolveTensorScale(data);

  return {
    width: dimensions.width * scale.width,
    height: dimensions.height * scale.height,
    channels: dimensions.channels * scale.channels,
    dimensions,
    scale
  };
}

export function clampToTensorBounds(value, halfSpan, innerHalfSpan, padding = 0.05) {
  const limit = Math.max(0, halfSpan - innerHalfSpan - padding);
  return Math.min(limit, Math.max(-limit, value));
}

export function resolveAxisDominance(vector) {
  const axes = [
    { axis: "x", value: vector.x },
    { axis: "y", value: vector.y },
    { axis: "z", value: vector.z }
  ];

  axes.sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  const dominant = axes[0] ?? { axis: "x", value: 1 };
  return {
    axis: dominant.axis,
    sign: Math.sign(dominant.value) || 1,
    ordered: axes.map((entry) => entry.axis)
  };
}

export function getOrthogonalAxes(axis) {
  if (axis === "x") {
    return ["y", "z"];
  }
  if (axis === "y") {
    return ["x", "z"];
  }
  return ["x", "y"];
}
