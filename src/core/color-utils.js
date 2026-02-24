import * as THREE from "three";

/**
 * Interpolates between two hex colors for a layer/filter index.
 *
 * @param {number} startHex - Start color in hex form, e.g. 0xff0000.
 * @param {number} endHex - End color in hex form, e.g. 0x00ff00.
 * @param {number} index - Zero-based index of the current layer/filter.
 * @param {number} count - Total number of layers/filters.
 * @returns {number} Interpolated hex color.
 */
export function makeGradientColor(startHex, endHex, index, count) {
  if (count <= 1) {
    return startHex;
  }

  const start = new THREE.Color(startHex);
  const end = new THREE.Color(endHex);
  const t = index / (count - 1);
  return start.lerp(end, t).getHex();
}

/**
 * Creates a reusable resolver function for channel/filter gradients.
 *
 * @param {number} startHex - Gradient start color.
 * @param {number} endHex - Gradient end color.
 * @returns {(index: number, count: number) => number} Color resolver.
 */
export function createGradientResolver(startHex, endHex) {
  return (index, count) => makeGradientColor(startHex, endHex, index, count);
}
