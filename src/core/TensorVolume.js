import * as THREE from "three";
import { createLabelSprite } from "./label-utils.js";

const DEFAULT_CHANNEL_PALETTE = [
  0x2e6cff, 0xff3b30, 0xffd60a, 0xffffff, 0xff9500, 0xff2d92, 0xff7a00, 0x34c759,
  0xaf52de, 0x00c7be, 0x5ac8fa, 0xff6482, 0xa2845e, 0x8e8e93, 0x64d2ff, 0xff375f,
  0x30d158, 0x7d7aff, 0xff9f0a, 0xbf5af2, 0x66d4cf, 0xfc3f6d, 0xe5e5ea
];

function computeAxisSpan(length, unitSize) {
  if (length <= 0) {
    return 0;
  }
  return length * unitSize;
}

function resolveChannelIndex(x, channelSpan, channelCount) {
  if (channelCount <= 1 || channelSpan <= 1e-6) {
    return 0;
  }

  const t = THREE.MathUtils.clamp((x + channelSpan * 0.5) / channelSpan, 0, 1);
  const mapped = Math.floor(t * channelCount);
  return THREE.MathUtils.clamp(mapped, 0, channelCount - 1);
}

function createGradientBoxGeometry(
  width,
  height,
  depth,
  startColor,
  endColor,
  { channelColor = null, channels = 1 } = {}
) {
  const useChannelColor = typeof channelColor === "function";
  const channelCount = Math.max(1, Math.round(channels));
  const widthSegments = useChannelColor ? channelCount : 1;
  const geometry = new THREE.BoxGeometry(width, height, depth, widthSegments, 1, 1);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);

  const start = new THREE.Color(startColor);
  const end = new THREE.Color(endColor);

  for (let index = 0; index < position.count; index += 1) {
    let vertexColor = null;
    if (useChannelColor) {
      const channelIndex = resolveChannelIndex(position.getX(index), width, channelCount);
      const resolvedColor = channelColor(channelIndex, channelCount);
      if (resolvedColor != null) {
        vertexColor = new THREE.Color(resolvedColor);
      }
    }

    if (!vertexColor) {
      const z = position.getZ(index);
      const t = depth <= 1e-6 ? 0.5 : THREE.MathUtils.clamp((z + depth * 0.5) / depth, 0, 1);
      vertexColor = start.clone().lerp(end, t);
    }

    const base = index * 3;
    colors[base] = vertexColor.r;
    colors[base + 1] = vertexColor.g;
    colors[base + 2] = vertexColor.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function toRgba(colorValue, opacity = 1) {
  const color = new THREE.Color(colorValue);
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = THREE.MathUtils.clamp(opacity, 0, 1);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Renders a tensor as one translucent cuboid with dimension labels on edges.
 */
export class TensorVolume {
  /**
   * @param {object} options
   * @param {[number, number, number]} options.shape - [channels, height, width]
   * @param {THREE.Vector3} [options.upperLeft] - Upper-left-front corner.
   * @param {number} [options.pixelSize=1] - Spatial unit for width/height.
   * @param {number} [options.pixelWidth=pixelSize] - Width unit.
   * @param {number} [options.pixelHeight=pixelSize] - Height unit.
   * @param {number} [options.pixelDepth=0.7] - Channel unit depth.
   * @param {number} [options.gap=0] - Kept for backward compatibility.
   * @param {number} [options.layerGap=0] - Kept for backward compatibility.
   * @param {string|number} [options.startColor=0xff7676]
   * @param {string|number} [options.endColor=0x4a0606]
   * @param {(index: number, count: number) => number} [options.channelColor]
   * @param {boolean} [options.showDimensionLabels=true]
   * @param {object} [options.labelStyle]
   */
  constructor({
    shape,
    upperLeft,
    pixelSize = 1,
    pixelWidth = pixelSize,
    pixelHeight = pixelSize,
    pixelDepth = 0.7,
    gap = 0,
    layerGap = 0,
    startColor = 0xff7676,
    endColor = 0x4a0606,
    channelColor,
    showDimensionLabels = true,
    labelStyle = {}
  }) {
    const [channels, height, width] = shape;

    this.channels = Math.max(1, Math.round(channels));
    this.height = Math.max(1, Math.round(height));
    this.width = Math.max(1, Math.round(width));

    this.pixelSize = pixelSize;
    this.pixelWidth = pixelWidth;
    this.pixelHeight = pixelHeight;
    this.pixelDepth = pixelDepth;
    this.gap = gap;
    this.layerGap = layerGap;

    this.stepXY = pixelSize;
    this.stepZ = pixelDepth;

    this.channelSpan = computeAxisSpan(this.channels, this.pixelDepth);
    this.heightSpan = computeAxisSpan(this.height, this.pixelHeight);
    this.widthSpan = computeAxisSpan(this.width, this.pixelWidth);

    this.upperLeft = upperLeft
      ? upperLeft.clone()
      : new THREE.Vector3(-this.channelSpan * 0.5, this.heightSpan * 0.5, this.widthSpan * 0.5);

    this.startColor = startColor;
    this.endColor = endColor;
    this.channelColor = channelColor;
    this.showDimensionLabels = showDimensionLabels;
    this.labelStyle = labelStyle;

    this.object3d = this.buildVolumeGroup();
  }

  buildVolumeGroup() {
    const group = new THREE.Group();

    const geometry = createGradientBoxGeometry(
      Math.max(this.channelSpan, 0.001),
      Math.max(this.heightSpan, 0.001),
      Math.max(this.widthSpan, 0.001),
      this.startColor,
      this.endColor,
      {
        channelColor: this.channelColor,
        channels: this.channels
      }
    );

    this.meshMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geometry, this.meshMaterial);
    this.mesh.position.copy(this.getCenterVector());

    const edgeGeometry = new THREE.EdgesGeometry(geometry);
    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 1,
      depthWrite: false
    });

    this.edges = new THREE.LineSegments(edgeGeometry, this.edgeMaterial);
    this.edges.position.copy(this.getCenterVector());

    group.add(this.mesh);
    group.add(this.edges);

    this.dimensionLabels = [];
    if (this.showDimensionLabels) {
      this.addDimensionLabels(group);
    }

    return group;
  }

  addDimensionLabels(group) {
    const labelMargin = Math.max(0.7, Math.min(this.pixelWidth, this.pixelHeight, this.pixelDepth) * 0.55);
    const center = this.getCenterVector();
    const baseLabelStyle = {
      fontFamily: "Helvetica",
      fontSize: this.labelStyle.fontSize ?? 30,
      textColor: this.labelStyle.textColor ?? "#0f172a",
      backgroundColor: toRgba(
        this.labelStyle.backgroundColor ?? "#ffffff",
        this.labelStyle.backgroundOpacity ?? 0.78
      ),
      borderColor: this.labelStyle.borderColor ?? "#334155",
      borderWidth: this.labelStyle.borderWidth ?? 2,
      padding: this.labelStyle.padding ?? 10,
      scaleHeight: this.labelStyle.scaleHeight ?? 2.8
    };

    const widthLabel = createLabelSprite(`W:${this.width}`, baseLabelStyle);
    widthLabel.position.set(
      center.x,
      center.y - this.heightSpan * 0.5 - labelMargin,
      center.z + this.widthSpan * 0.5 + labelMargin * 0.4
    );

    const heightLabel = createLabelSprite(`H:${this.height}`, baseLabelStyle);
    heightLabel.position.set(
      center.x - this.channelSpan * 0.5 - labelMargin,
      center.y,
      center.z + this.widthSpan * 0.5 + labelMargin * 0.4
    );

    const channelLabel = createLabelSprite(`C:${this.channels}`, baseLabelStyle);
    channelLabel.position.set(
      center.x + this.channelSpan * 0.5 + labelMargin,
      center.y - this.heightSpan * 0.5,
      center.z
    );

    this.dimensionLabels.push(widthLabel, heightLabel, channelLabel);
    group.add(widthLabel, heightLabel, channelLabel);
  }

  getCenterVector() {
    return new THREE.Vector3(this.getCenterX(), this.getCenterY(), this.getCenterZ());
  }

  getCellCenter(channel, y, x) {
    const channelWidth = this.channelSpan / this.channels;
    const cellHeight = this.heightSpan / this.height;
    const widthDepth = this.widthSpan / this.width;

    return new THREE.Vector3(
      this.upperLeft.x + (channel + 0.5) * channelWidth,
      this.upperLeft.y - (y + 0.5) * cellHeight,
      this.upperLeft.z - (x + 0.5) * widthDepth
    );
  }

  getKernelCenter(channel, kernelSize = 3) {
    const clampedKernel = Math.max(1, Math.round(kernelSize));
    const channelWidth = this.channelSpan / this.channels;
    const cellHeight = this.heightSpan / this.height;
    const widthDepth = this.widthSpan / this.width;
    const kernelWidth = Math.min(this.width, clampedKernel) * widthDepth;
    const kernelHeight = Math.min(this.height, clampedKernel) * cellHeight;

    return new THREE.Vector3(
      this.upperLeft.x + (channel + 0.5) * channelWidth,
      this.upperLeft.y - kernelHeight * 0.5,
      this.upperLeft.z - kernelWidth * 0.5
    );
  }

  getWidthSpan() {
    return this.widthSpan;
  }

  getHeightSpan() {
    return this.heightSpan;
  }

  getDepthSpan() {
    return this.channelSpan;
  }

  getCenterX() {
    return this.upperLeft.x + this.channelSpan * 0.5;
  }

  getCenterY() {
    return this.upperLeft.y - this.heightSpan * 0.5;
  }

  getCenterZ() {
    return this.upperLeft.z - this.widthSpan * 0.5;
  }

  getRightEdgeX() {
    return this.upperLeft.x + this.channelSpan;
  }

  getChannelColor(index) {
    if (typeof this.channelColor === "function") {
      return this.channelColor(index, this.channels);
    }
    return DEFAULT_CHANNEL_PALETTE[index % DEFAULT_CHANNEL_PALETTE.length];
  }

  setFillOpacity(opacity) {
    if (!this.meshMaterial) {
      return;
    }

    const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    this.meshMaterial.opacity = clampedOpacity;
    this.meshMaterial.transparent = clampedOpacity < 1;
    this.meshMaterial.needsUpdate = true;
  }

  setEdgeColor(colorHex) {
    if (!this.edgeMaterial || !this.edges) {
      return;
    }

    if (colorHex == null) {
      this.edges.visible = false;
      return;
    }

    this.edges.visible = true;
    this.edgeMaterial.color.set(colorHex);
  }

  setEdgeOpacity(opacity) {
    if (!this.edgeMaterial) {
      return;
    }

    const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    this.edgeMaterial.opacity = clampedOpacity;
    this.edgeMaterial.transparent = clampedOpacity < 1;
    this.edgeMaterial.needsUpdate = true;
  }
}
