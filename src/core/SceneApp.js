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

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(background);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 2000);
    this.camera.position.copy(cameraPosition);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.addDefaultLights();

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
}
