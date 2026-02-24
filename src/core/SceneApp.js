import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * Small app shell that owns renderer, scene, camera, controls and resize loop.
 */
export class SceneApp {
  /**
   * @param {object} options - Scene app options.
   * @param {HTMLElement} [options.container=document.body] - DOM mount point.
   * @param {number} [options.background=0x0f1624] - Scene background color.
   * @param {THREE.Vector3} [options.cameraPosition] - Initial camera position.
   */
  constructor({
    container = document.body,
    background = 0x0f1624,
    cameraPosition = new THREE.Vector3(0, 0, 260)
  } = {}) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.2, 15000);
    this.camera.position.copy(cameraPosition);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxDistance = 14000;

    this.addDefaultLights();
    this.setBackground(background, false);

    this.onResize = this.onResize.bind(this);
    window.addEventListener("resize", this.onResize);
  }

  addDefaultLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.05));

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(60, 80, 120);
    this.scene.add(keyLight);
  }

  add(...objects) {
    for (const object of objects) {
      this.scene.add(object);
    }
  }

  start() {
    const animate = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(animate);
    };

    animate();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  renderFrame() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  setBackground(background, render = true) {
    if (background == null) {
      this.scene.background = null;
      this.renderer.setClearAlpha(0);
    } else {
      const color = new THREE.Color(background);
      this.scene.background = color;
      this.renderer.setClearColor(color, 1);
    }

    if (render) {
      this.renderFrame();
    }
  }

  frameObject(target, padding = 1.25) {
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) {
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z);

    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const fitHeightDistance = (maxSize * 0.5) / Math.tan(halfFov);
    const fitWidthDistance = fitHeightDistance / this.camera.aspect;
    const distance = padding * Math.max(fitHeightDistance, fitWidthDistance, size.z);

    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center.clone().add(direction.multiplyScalar(distance)));
    this.camera.near = Math.max(0.1, distance / 200);
    this.camera.far = Math.max(2000, distance * 8 + maxSize * 2);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.renderFrame();
  }

  exportRaster(format = "png", quality = 0.92) {
    this.renderFrame();

    const mimeType =
      format === "jpeg" || format === "jpg" ? "image/jpeg" : "image/png";

    if (mimeType === "image/jpeg") {
      return this.renderer.domElement.toDataURL(mimeType, quality);
    }

    return this.renderer.domElement.toDataURL(mimeType);
  }
}
