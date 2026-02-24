import * as THREE from "three";
import { BaseElement } from "./BaseElement.js";
import { createLabelSprite } from "../../core/label-utils.js";

function toRgba(colorValue, opacity) {
  const color = new THREE.Color(colorValue);
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.min(1, Math.max(0, opacity));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export class LabelElement extends BaseElement {
  buildContent(config) {
    const group = new THREE.Group();
    const data = config.data;

    const sprite = createLabelSprite(data.text, {
      fontSize: data.fontSize,
      fontFamily: data.fontFamily,
      textColor: toRgba(data.textColor, data.textOpacity),
      backgroundColor: toRgba(data.backgroundColor, data.backgroundOpacity),
      borderColor: toRgba(data.borderColor, data.borderOpacity),
      borderWidth: data.borderWidth,
      padding: data.padding,
      scaleHeight: data.scaleHeight
    });

    group.add(sprite);
    return group;
  }
}
