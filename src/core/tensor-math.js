/**
 * Computes the physical span of a discrete axis (N cells with fixed inter-cell gap).
 */
export function getAxisSpan(length, cellSize, gap) {
  if (length <= 0) {
    return 0;
  }
  return length * cellSize + (length - 1) * gap;
}

/**
 * Computes the spatial (X/Y) span of a square convolution kernel.
 */
export function getKernelSpatialSpan(kernelSize, pixelSize, pixelGap) {
  return getAxisSpan(kernelSize, pixelSize, pixelGap);
}
