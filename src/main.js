import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

class InputTensorVolume {
  constructor({ shape, upperLeft, pixelSize = 1, pixelDepth = 0.18, gap = 0.02, layerGap = 0.1, color = 0x4d8cff }) {
    const [channels, height, width] = shape;
    const stepXY = pixelSize + gap;
    const stepZ = pixelDepth + layerGap;
    const count = channels * height * width;

    const geometry = new THREE.BoxGeometry(pixelSize, pixelSize, pixelDepth);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);

    const matrix = new THREE.Matrix4();
    const offsetX = pixelSize * 0.5;
    const offsetY = pixelSize * 0.5;
    const offsetZ = pixelDepth * 0.5;

    let index = 0;
    for (let c = 0; c < channels; c += 1) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          matrix.setPosition(
            upperLeft.x + x * stepXY + offsetX,
            upperLeft.y - y * stepXY - offsetY,
            upperLeft.z - c * stepZ - offsetZ
          );
          mesh.setMatrixAt(index, matrix);
          index += 1;
        }
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    this.object3d = mesh;
  }
}

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1624);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 0, 260);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 1.05));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(60, 80, 120);
scene.add(keyLight);

const inputVolume = new InputTensorVolume({
  shape: [23, 128, 128],
  upperLeft: new THREE.Vector3(-65.2, 65.2, 4),
  pixelSize: 1,
  pixelDepth: 0.18,
  gap: 0.02,
  layerGap: 0.1
});

scene.add(inputVolume.object3d);

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
