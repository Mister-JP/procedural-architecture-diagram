import * as THREE from "three";
import { BaseElement } from "./BaseElement.js";

function createMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1
  });
}

function createLineMaterial(color, opacity) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1
  });
}

export class FrustumElement extends BaseElement {
  buildContent(config) {
    const group = new THREE.Group();
    const data = config.data;
    const radiusTop = Math.max(0.001, data.topSize / Math.SQRT2);
    const radiusBottom = Math.max(0.001, data.bottomSize / Math.SQRT2);
    const length = Math.max(0.001, data.length);

    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 4, 1, false);
    geometry.rotateY(Math.PI * 0.25);

    const mesh = new THREE.Mesh(
      geometry,
      createMaterial(new THREE.Color(data.color), data.opacity)
    );
    group.add(mesh);

    if (data.borderOpacity > 0) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        createLineMaterial(new THREE.Color(data.borderColor), data.borderOpacity)
      );
      group.add(edges);
    }

    return group;
  }
}
