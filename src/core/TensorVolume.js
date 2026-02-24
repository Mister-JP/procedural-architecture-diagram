import * as THREE from "three";

const DEFAULT_LAYER_PALETTE = [
  0x2e6cff, 0xff3b30, 0xffd60a, 0xffffff, 0xff9500, 0xff2d92, 0xff7a00, 0x34c759,
  0xaf52de, 0x00c7be, 0x5ac8fa, 0xff6482, 0xa2845e, 0x8e8e93, 0x64d2ff, 0xff375f,
  0x30d158, 0x7d7aff, 0xff9f0a, 0xbf5af2, 0x66d4cf, 0xfc3f6d, 0xe5e5ea
];

const EDGE_VERTEX_SHADER = `
  attribute vec3 instanceOffset;
  void main() {
    vec3 p = position + instanceOffset;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const EDGE_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

/**
 * Renders a 3D tensor using instanced voxel cubes per channel.
 *
 * Public methods provide center/position helpers that other visual components
 * (kernels, tunnels, highlights) can reuse without duplicating math.
 */
export class TensorVolume {
  /**
   * @param {object} options - Tensor volume options.
   * @param {[number, number, number]} options.shape - [channels, height, width].
   * @param {THREE.Vector3} options.upperLeft - Upper-left front origin.
   * @param {number} [options.pixelSize=1] - Voxel size in X/Y.
   * @param {number} [options.pixelDepth=0.7] - Voxel size in Z.
   * @param {number} [options.gap=0.12] - Gap between neighboring X/Y voxels.
   * @param {number} [options.layerGap=0.24] - Gap between channel layers in Z.
   * @param {(index: number, count: number) => number} [options.channelColor] - Color resolver.
   */
  constructor({
    shape,
    upperLeft,
    pixelSize = 1,
    pixelDepth = 0.7,
    gap = 0.12,
    layerGap = 0.24,
    channelColor
  }) {
    const [channels, height, width] = shape;

    this.channels = channels;
    this.height = height;
    this.width = width;
    this.upperLeft = upperLeft.clone();
    this.pixelSize = pixelSize;
    this.pixelDepth = pixelDepth;
    this.gap = gap;
    this.layerGap = layerGap;
    this.channelColor = channelColor;

    this.stepXY = pixelSize + gap;
    this.stepZ = pixelDepth + layerGap;

    this.object3d = this.buildVolumeGroup();
  }

  buildVolumeGroup() {
    const voxelGeometry = new THREE.BoxGeometry(this.pixelSize, this.pixelSize, this.pixelDepth);
    const edgeGeometry = new THREE.EdgesGeometry(voxelGeometry);

    const group = new THREE.Group();
    for (let channel = 0; channel < this.channels; channel += 1) {
      const layer = this.buildChannelLayer({ channel, voxelGeometry, edgeGeometry });
      group.add(layer.mesh);
      group.add(layer.edges);
    }

    return group;
  }

  buildChannelLayer({ channel, voxelGeometry, edgeGeometry }) {
    const countPerLayer = this.height * this.width;
    const layerColor = this.getChannelColor(channel);

    const mesh = new THREE.InstancedMesh(
      voxelGeometry,
      new THREE.MeshBasicMaterial({ color: layerColor }),
      countPerLayer
    );

    const offsets = new Float32Array(countPerLayer * 3);
    const matrix = new THREE.Matrix4();

    const offsetX = this.pixelSize * 0.5;
    const offsetY = this.pixelSize * 0.5;
    const offsetZ = this.pixelDepth * 0.5;

    let instance = 0;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const px = this.upperLeft.x + x * this.stepXY + offsetX;
        const py = this.upperLeft.y - y * this.stepXY - offsetY;
        const pz = this.upperLeft.z - channel * this.stepZ - offsetZ;

        matrix.setPosition(px, py, pz);
        mesh.setMatrixAt(instance, matrix);

        const offsetIndex = instance * 3;
        offsets[offsetIndex] = px;
        offsets[offsetIndex + 1] = py;
        offsets[offsetIndex + 2] = pz;

        instance += 1;
      }
    }

    mesh.instanceMatrix.needsUpdate = true;

    const edgeInstances = new THREE.InstancedBufferGeometry();
    edgeInstances.setAttribute("position", edgeGeometry.getAttribute("position"));
    edgeInstances.setAttribute("instanceOffset", new THREE.InstancedBufferAttribute(offsets, 3));
    edgeInstances.instanceCount = countPerLayer;

    const edgeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x111111) }
      },
      vertexShader: EDGE_VERTEX_SHADER,
      fragmentShader: EDGE_FRAGMENT_SHADER
    });

    const edges = new THREE.LineSegments(edgeInstances, edgeMaterial);
    edges.frustumCulled = false;

    return { mesh, edges };
  }

  getCellCenter(channel, y, x) {
    return new THREE.Vector3(
      this.upperLeft.x + x * this.stepXY + this.pixelSize * 0.5,
      this.upperLeft.y - y * this.stepXY - this.pixelSize * 0.5,
      this.upperLeft.z - channel * this.stepZ - this.pixelDepth * 0.5
    );
  }

  getKernelCenter(channel, kernelSize = 3) {
    const kernelSpan = kernelSize * this.pixelSize + (kernelSize - 1) * this.gap;
    return new THREE.Vector3(
      this.upperLeft.x + kernelSpan * 0.5,
      this.upperLeft.y - kernelSpan * 0.5,
      this.upperLeft.z - channel * this.stepZ - this.pixelDepth * 0.5
    );
  }

  getCenterX() {
    const totalWidth = this.width * this.pixelSize + (this.width - 1) * this.gap;
    return this.upperLeft.x + totalWidth * 0.5;
  }

  getCenterY() {
    const totalHeight = this.height * this.pixelSize + (this.height - 1) * this.gap;
    return this.upperLeft.y - totalHeight * 0.5;
  }

  getCenterZ() {
    const totalDepth = this.channels * this.pixelDepth + (this.channels - 1) * this.layerGap;
    return this.upperLeft.z - totalDepth * 0.5;
  }

  getRightEdgeX() {
    return this.upperLeft.x + this.width * this.pixelSize + (this.width - 1) * this.gap;
  }

  getChannelColor(index) {
    if (this.channelColor) {
      return this.channelColor(index, this.channels);
    }
    return DEFAULT_LAYER_PALETTE[index % DEFAULT_LAYER_PALETTE.length];
  }
}
