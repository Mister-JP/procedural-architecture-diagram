import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createElementInstance } from "./elements/ElementFactory.js";
import { normalizeDocument } from "./schema.js";

function sanitizeElementConfig(config) {
  return normalizeDocument({ elements: [config] }).elements[0];
}

export class ElementPreview {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#101a2d");

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5000);
    this.camera.position.set(0, 0, 90);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = true;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 2600;
    this.controls.addEventListener("change", () => this.render());

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(50, 60, 80);
    this.scene.add(keyLight);

    this.currentElement = null;

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.render();
    });
    this.resizeObserver.observe(this.container);

    this.resize();
    this.animate = this.animate.bind(this);
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  resize() {
    const width = Math.max(120, this.container.clientWidth || 240);
    const height = Math.max(120, this.container.clientHeight || 180);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  setElementConfig(config) {
    const normalized = sanitizeElementConfig(config);

    if (this.currentElement) {
      this.currentElement.dispose();
      this.currentElement = null;
      this.root.clear();
    }

    this.currentElement = createElementInstance(normalized);
    this.root.add(this.currentElement.group);
    this.root.rotation.set(0, 0, 0);

    this.frameCurrentElement();
    this.render();
  }

  frameCurrentElement() {
    if (!this.currentElement) {
      return;
    }

    const box = new THREE.Box3().setFromObject(this.currentElement.group);
    if (box.isEmpty()) {
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const distance = Math.max(8, (maxSize * 0.75) / Math.tan(halfFov));

    this.camera.position.copy(center.clone().add(new THREE.Vector3(distance * 0.8, distance * 0.45, distance)));
    this.camera.near = Math.max(0.1, distance / 200);
    this.camera.far = Math.max(400, distance * 8 + maxSize * 2);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  animate() {
    this.controls.update();
    this.render();
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    if (this.currentElement) {
      this.currentElement.dispose();
    }

    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
