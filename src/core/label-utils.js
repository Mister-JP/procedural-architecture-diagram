import * as THREE from "three";

/**
 * Builds a camera-facing text sprite for lightweight 3D labels.
 *
 * @param {string} text - Label text.
 * @param {object} [options] - Label style.
 * @param {number} [options.fontSize=56] - Font size in canvas pixels.
 * @param {string} [options.fontFamily="Arial"] - Font family.
 * @param {string} [options.textColor="#e7f4ff"] - Text color.
 * @param {string} [options.backgroundColor="rgba(15, 22, 36, 0.86)"] - Background fill.
 * @param {string} [options.borderColor="#9cd8ff"] - Border stroke color.
 * @param {number} [options.borderWidth=5] - Border stroke width.
 * @param {number} [options.padding=20] - Inner text padding.
 * @param {number} [options.scaleHeight=10] - Sprite height in world units.
 * @returns {THREE.Sprite}
 */
export function createLabelSprite(text, {
  fontSize = 56,
  fontFamily = "Arial",
  textColor = "#e7f4ff",
  backgroundColor = "rgba(15, 22, 36, 0.86)",
  borderColor = "#9cd8ff",
  borderWidth = 5,
  padding = 20,
  scaleHeight = 10
} = {}) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  context.font = `700 ${fontSize}px ${fontFamily}`;
  const measuredWidth = Math.ceil(context.measureText(text).width);
  canvas.width = measuredWidth + padding * 2;
  canvas.height = fontSize + padding * 2;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = borderColor;
  context.lineWidth = borderWidth;
  context.strokeRect(
    borderWidth * 0.5,
    borderWidth * 0.5,
    canvas.width - borderWidth,
    canvas.height - borderWidth
  );
  context.font = `700 ${fontSize}px ${fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = textColor;
  context.fillText(text, canvas.width * 0.5, canvas.height * 0.5);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false
  });

  const sprite = new THREE.Sprite(material);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(scaleHeight * aspect, scaleHeight, 1);
  sprite.renderOrder = 1000;
  return sprite;
}
