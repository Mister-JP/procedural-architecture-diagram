import * as THREE from "three";
import { disposeObject3D } from "./dispose-utils.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class BaseElement {
  constructor(config) {
    this.group = new THREE.Group();
    this.contentGroup = new THREE.Group();
    this.group.add(this.contentGroup);
    this.update(config);
  }

  update(config) {
    this.config = clone(config);
    this.id = config.id;
    this.type = config.type;

    this.group.name = `${this.type}:${this.id}`;
    this.rebuildContent();
    this.applyTransform(this.config.transform);
    this.markPickable();
  }

  rebuildContent() {
    while (this.contentGroup.children.length > 0) {
      const child = this.contentGroup.children[0];
      this.contentGroup.remove(child);
      disposeObject3D(child);
    }

    const content = this.buildContent(this.config);
    if (content) {
      this.contentGroup.add(content);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  buildContent() {
    throw new Error("Element subclasses must implement buildContent().");
  }

  markPickable() {
    this.group.traverse((node) => {
      node.userData.elementId = this.id;
      node.userData.elementType = this.type;
    });
  }

  applyTransform(transform) {
    const position = transform?.position ?? [0, 0, 0];
    const rotation = transform?.rotation ?? [0, 0, 0];

    this.group.position.set(position[0], position[1], position[2]);
    this.group.rotation.set(rotation[0], rotation[1], rotation[2]);
  }

  syncTransformFromGroup() {
    this.config.transform.position = [
      this.group.position.x,
      this.group.position.y,
      this.group.position.z
    ];
    this.config.transform.rotation = [
      this.group.rotation.x,
      this.group.rotation.y,
      this.group.rotation.z
    ];
  }

  toDocumentElement() {
    this.syncTransformFromGroup();
    return clone(this.config);
  }

  dispose() {
    while (this.contentGroup.children.length > 0) {
      const child = this.contentGroup.children[0];
      this.contentGroup.remove(child);
      disposeObject3D(child);
    }

    this.group.removeFromParent();
  }
}
