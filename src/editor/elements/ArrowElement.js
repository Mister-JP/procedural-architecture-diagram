import * as THREE from "three";
import { BaseElement } from "./BaseElement.js";

function createSolidMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1
  });
}

function createLineMaterial({ dotted, color, opacity, thickness, dashSize, gapSize }) {
  if (dotted) {
    return new THREE.LineDashedMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      linewidth: thickness,
      dashSize,
      gapSize
    });
  }

  return new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    linewidth: thickness
  });
}

export class ArrowElement extends BaseElement {
  buildContent(config) {
    const group = new THREE.Group();
    const data = config.data;
    const color = new THREE.Color(data.color);
    const length = data.length;
    const thickness = data.thickness;
    const headLength = Math.min(data.headLength, length * 0.7);
    const headWidth = Math.min(data.headWidth, Math.max(0.2, length * 0.5));

    if (data.arrowType === "3d") {
      this.build3DArrow(group, {
        color,
        opacity: data.opacity,
        length,
        thickness,
        headLength,
        headWidth
      });
    } else if (data.arrowType === "2d") {
      this.buildLineArrow(group, {
        dotted: false,
        color,
        opacity: data.opacity,
        length,
        thickness,
        headLength,
        headWidth
      });
    } else if (data.arrowType === "dotted") {
      this.buildLineArrow(group, {
        dotted: true,
        color,
        opacity: data.opacity,
        length,
        thickness,
        headLength,
        headWidth,
        dashSize: data.dashSize,
        gapSize: data.gapSize
      });
    } else {
      this.buildCurvedArrow(group, {
        color,
        opacity: data.opacity,
        length,
        thickness,
        headLength,
        headWidth,
        controlPoint: new THREE.Vector3(...data.controlPoint)
      });
    }

    return group;
  }

  build3DArrow(group, { color, opacity, length, thickness, headLength, headWidth }) {
    const shaftLength = Math.max(0.001, length - headLength);

    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(thickness, thickness, shaftLength, 16),
      createSolidMaterial(color, opacity)
    );
    shaft.rotation.z = -Math.PI * 0.5;
    shaft.position.x = -headLength * 0.5;

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(headWidth, headLength, 16),
      createSolidMaterial(color, opacity)
    );
    head.rotation.z = -Math.PI * 0.5;
    head.position.x = length * 0.5 - headLength * 0.5;

    group.add(shaft, head);
  }

  buildLineArrow(
    group,
    { dotted, color, opacity, length, thickness, headLength, headWidth, dashSize = 2.5, gapSize = 1.3 }
  ) {
    const startX = -length * 0.5;
    const endX = length * 0.5 - headLength;
    const points = [new THREE.Vector3(startX, 0, 0), new THREE.Vector3(endX, 0, 0)];

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      createLineMaterial({ dotted, color, opacity, thickness, dashSize, gapSize })
    );

    if (dotted) {
      line.computeLineDistances();
    }

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(headWidth, headLength, 16),
      createSolidMaterial(color, opacity)
    );
    head.rotation.z = -Math.PI * 0.5;
    head.position.x = length * 0.5 - headLength * 0.5;

    group.add(line, head);
  }

  buildCurvedArrow(group, { color, opacity, length, thickness, headLength, headWidth, controlPoint }) {
    const start = new THREE.Vector3(-length * 0.5, 0, 0);
    const end = new THREE.Vector3(length * 0.5, 0, 0);
    const curve = new THREE.QuadraticBezierCurve3(start, controlPoint, end);

    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 80, thickness, 12, false),
      createSolidMaterial(color, opacity)
    );

    const endTangent = curve.getTangent(1).normalize();
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(headWidth, headLength, 16),
      createSolidMaterial(color, opacity)
    );

    head.position.copy(end.clone().sub(endTangent.clone().multiplyScalar(headLength * 0.5)));
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), endTangent);

    group.add(tube, head);
  }

  isCurved() {
    return this.config?.data?.arrowType === "curved";
  }

  getControlPointLocal() {
    if (!this.isCurved()) {
      return null;
    }

    const [x, y, z] = this.config.data.controlPoint;
    return new THREE.Vector3(x, y, z);
  }

  getControlPointWorld() {
    const local = this.getControlPointLocal();
    if (!local) {
      return null;
    }
    return this.group.localToWorld(local.clone());
  }

  setControlPointFromWorld(worldPosition) {
    if (!this.isCurved()) {
      return;
    }

    const local = this.group.worldToLocal(worldPosition.clone());
    this.config.data.controlPoint = [local.x, local.y, local.z];
    this.update(this.config);
  }
}
