import * as THREE from "three";
import { BaseElement } from "./BaseElement.js";
import { TensorVolume } from "../../core/TensorVolume.js";
import { resolveTensorSpans } from "../../core/tensor-geometry.js";

function toRgba(colorHex, opacity) {
  const color = new THREE.Color(colorHex);
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const alpha = THREE.MathUtils.clamp(opacity, 0, 1);
  return `rgba(${r},${g},${b},${alpha})`;
}

function createChannelRangeColorResolver(channelColorRanges) {
  if (!Array.isArray(channelColorRanges) || channelColorRanges.length === 0) {
    return null;
  }

  return (channelIndex) => {
    const channelNumber = channelIndex + 1;
    for (const range of channelColorRanges) {
      if (channelNumber >= range.minChannel && channelNumber <= range.maxChannel) {
        return range.color;
      }
    }
    return null;
  };
}

export class TensorElement extends BaseElement {
  buildContent(config) {
    const group = new THREE.Group();
    const { dimensions, scale, style, labels } = config.data;
    const spans = resolveTensorSpans(config.data);
    const resolveChannelColor = createChannelRangeColorResolver(style.channelColorRanges);

    this.tensorVolume = new TensorVolume({
      shape: [dimensions.channels, dimensions.height, dimensions.width],
      upperLeft: new THREE.Vector3(-spans.channels * 0.5, spans.height * 0.5, spans.width * 0.5),
      pixelSize: scale.width,
      pixelWidth: scale.width,
      pixelHeight: scale.height,
      pixelDepth: scale.channel,
      startColor: style.startColor,
      endColor: style.endColor,
      channelColor: resolveChannelColor ?? undefined,
      showDimensionLabels: labels.enabled,
      labelStyle: {
        textColor: toRgba(labels.textColor, labels.textOpacity),
        backgroundColor: labels.backgroundColor,
        backgroundOpacity: labels.backgroundOpacity,
        borderColor: toRgba(labels.borderColor, labels.borderOpacity),
        scaleHeight: labels.scaleHeight
      }
    });

    this.tensorVolume.setFillOpacity(style.fillOpacity);
    this.tensorVolume.setEdgeColor(style.borderOpacity <= 0 ? null : style.borderColor);
    this.tensorVolume.setEdgeOpacity(style.borderOpacity);

    group.add(this.tensorVolume.object3d);
    return group;
  }
}
