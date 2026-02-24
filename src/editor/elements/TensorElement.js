import * as THREE from "three";
import { BaseElement } from "./BaseElement.js";
import { TensorVolume } from "../../core/TensorVolume.js";
import { getAxisSpan } from "../../core/tensor-math.js";
import { createGradientResolver } from "../../core/color-utils.js";

export class TensorElement extends BaseElement {
  buildContent(config) {
    const group = new THREE.Group();
    const {
      shape: [channels, height, width],
      voxel,
      style
    } = config.data;

    const widthSpan = getAxisSpan(width, voxel.pixelSize, voxel.gap);
    const heightSpan = getAxisSpan(height, voxel.pixelSize, voxel.gap);
    const depthSpan = getAxisSpan(channels, voxel.pixelDepth, voxel.layerGap);

    const gradient = createGradientResolver(
      new THREE.Color(style.startColor).getHex(),
      new THREE.Color(style.endColor).getHex()
    );

    this.tensorVolume = new TensorVolume({
      shape: [channels, height, width],
      upperLeft: new THREE.Vector3(-widthSpan * 0.5, heightSpan * 0.5, depthSpan * 0.5),
      pixelSize: voxel.pixelSize,
      pixelDepth: voxel.pixelDepth,
      gap: voxel.gap,
      layerGap: voxel.layerGap,
      channelColor: gradient
    });

    this.tensorVolume.setFillOpacity(style.fillOpacity);
    this.tensorVolume.setEdgeColor(style.borderOpacity <= 0 ? null : style.borderColor);
    this.tensorVolume.setEdgeOpacity(style.borderOpacity);

    group.add(this.tensorVolume.object3d);
    return group;
  }
}
