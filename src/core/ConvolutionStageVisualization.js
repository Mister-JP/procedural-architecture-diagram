import * as THREE from "three";
import { TensorVolume } from "./TensorVolume.js";
import { createTunnelPlanes } from "./tunnel-utils.js";

/**
 * Visualizes one convolution stage:
 * - Kernel bank (filterCount kernels, each channels x kernelSize x kernelSize)
 * - One highlighted kernel near the input receptive field
 * - Input->kernel and kernel->output translucent tunnel connections
 */
export class ConvolutionStageVisualization {
  /**
   * @param {object} options - Stage options.
   * @param {TensorVolume} options.inputVolume - Stage input tensor.
   * @param {TensorVolume} options.outputVolume - Stage output tensor.
   * @param {number} [options.kernelSize=3] - Spatial kernel size.
   * @param {number} [options.filterCount=32] - Number of kernels.
   * @param {number} [options.kernelGridColumns=8] - Kernels per row in bank layout.
   * @param {number} [options.highlightedKernelIndex=0] - Kernel index to highlight.
   * @param {(index: number, count: number) => number} [options.filterColor] - Kernel color resolver.
   */
  constructor({
    inputVolume,
    outputVolume,
    kernelSize = 3,
    filterCount = 32,
    kernelGridColumns = 8,
    highlightedKernelIndex = 0,
    filterColor
  }) {
    this.inputVolume = inputVolume;
    this.outputVolume = outputVolume;
    this.kernelSize = kernelSize;
    this.filterCount = filterCount;
    this.kernelGridColumns = kernelGridColumns;
    this.highlightedKernelIndex = highlightedKernelIndex;
    this.filterColor = filterColor;

    this.object3d = this.build();
  }

  build() {
    const group = new THREE.Group();
    const layout = this.computeLayout();

    this.addKernelBank(group, layout);
    this.addHighlightConnections(group, layout);

    return group;
  }

  computeLayout() {
    const kernelXYSpan = this.kernelSize * this.inputVolume.pixelSize + (this.kernelSize - 1) * this.inputVolume.gap;
    const kernelDepthSpan =
      this.inputVolume.channels * this.inputVolume.pixelDepth +
      (this.inputVolume.channels - 1) * this.inputVolume.layerGap;

    const cols = this.kernelGridColumns;
    const rows = Math.ceil(this.filterCount / cols);
    const cellStep = kernelXYSpan + 1.15;

    const bankWidth = cols * kernelXYSpan + (cols - 1) * (cellStep - kernelXYSpan);
    const bankHeight = rows * kernelXYSpan + (rows - 1) * (cellStep - kernelXYSpan);

    const bankCenterY = this.inputVolume.getCenterY();
    const bankCenterZ = (this.inputVolume.getCenterZ() + this.outputVolume.getCenterZ()) * 0.5;

    const bankStartX = this.inputVolume.getCenterX() - bankWidth * 0.5 + kernelXYSpan * 0.5;
    const bankTopY = bankCenterY + bankHeight * 0.5 - kernelXYSpan * 0.5;

    const highlightedKernelCenter = new THREE.Vector3(
      this.inputVolume.getKernelCenter(0, this.kernelSize).x,
      this.inputVolume.getKernelCenter(0, this.kernelSize).y,
      bankCenterZ
    );

    return {
      cols,
      cellStep,
      bankCenterZ,
      bankStartX,
      bankTopY,
      kernelXYSpan,
      kernelDepthSpan,
      highlightedKernelCenter
    };
  }

  addKernelBank(group, layout) {
    for (let i = 0; i < this.filterCount; i += 1) {
      const row = Math.floor(i / layout.cols);
      const col = i % layout.cols;

      const gridCenter = new THREE.Vector3(
        layout.bankStartX + col * layout.cellStep,
        layout.bankTopY - row * layout.cellStep,
        layout.bankCenterZ
      );

      const displayCenter = i === this.highlightedKernelIndex ? layout.highlightedKernelCenter : gridCenter;
      const kernelColor = this.getFilterColor(i);

      const kernelUpperLeft = new THREE.Vector3(
        displayCenter.x - layout.kernelXYSpan * 0.5,
        displayCenter.y + layout.kernelXYSpan * 0.5,
        displayCenter.z + layout.kernelDepthSpan * 0.5
      );

      const kernelVolume = new TensorVolume({
        shape: [this.inputVolume.channels, this.kernelSize, this.kernelSize],
        upperLeft: kernelUpperLeft,
        pixelSize: this.inputVolume.pixelSize,
        pixelDepth: this.inputVolume.pixelDepth,
        gap: this.inputVolume.gap,
        layerGap: this.inputVolume.layerGap,
        channelColor: () => kernelColor
      });

      group.add(kernelVolume.object3d);
    }
  }

  addHighlightConnections(group, layout) {
    const inputPatchCenter = this.inputVolume.getKernelCenter(0, this.kernelSize);

    const outputChannelIndex = this.outputVolume.channels - 1;
    const outputPixelCenter = this.outputVolume.getCellCenter(outputChannelIndex, 0, 0);
    const outputPixelColor = this.outputVolume.getChannelColor(outputChannelIndex);

    const inputToKernelDirection = Math.sign(layout.highlightedKernelCenter.z - inputPatchCenter.z) || 1;
    const kernelFaceTowardInput = new THREE.Vector3(
      layout.highlightedKernelCenter.x,
      layout.highlightedKernelCenter.y,
      layout.highlightedKernelCenter.z - inputToKernelDirection * (layout.kernelDepthSpan * 0.5)
    );

    const kernelToOutputDirection = Math.sign(outputPixelCenter.z - layout.highlightedKernelCenter.z) || 1;
    const kernelFaceTowardOutput = new THREE.Vector3(
      layout.highlightedKernelCenter.x,
      layout.highlightedKernelCenter.y,
      layout.highlightedKernelCenter.z + kernelToOutputDirection * (layout.kernelDepthSpan * 0.5)
    );

    const inputToKernelTunnel = createTunnelPlanes({
      startCenter: inputPatchCenter,
      startWidth: layout.kernelXYSpan,
      startHeight: layout.kernelXYSpan,
      endCenter: kernelFaceTowardInput,
      endWidth: layout.kernelXYSpan,
      endHeight: layout.kernelXYSpan,
      color: this.getFilterColor(this.highlightedKernelIndex),
      opacity: 0.18
    });
    group.add(inputToKernelTunnel);

    const kernelToOutputTunnel = createTunnelPlanes({
      startCenter: kernelFaceTowardOutput,
      startWidth: layout.kernelXYSpan,
      startHeight: layout.kernelXYSpan,
      endCenter: outputPixelCenter,
      endWidth: this.outputVolume.pixelSize,
      endHeight: this.outputVolume.pixelSize,
      color: outputPixelColor,
      opacity: 0.2
    });
    group.add(kernelToOutputTunnel);

    const outputPixelHighlight = new THREE.Mesh(
      new THREE.BoxGeometry(this.outputVolume.pixelSize, this.outputVolume.pixelSize, this.outputVolume.pixelDepth),
      new THREE.MeshBasicMaterial({
        color: outputPixelColor,
        transparent: true,
        opacity: 0.95
      })
    );
    outputPixelHighlight.position.copy(outputPixelCenter);
    group.add(outputPixelHighlight);
  }

  getFilterColor(index) {
    if (this.filterColor) {
      return this.filterColor(index, this.filterCount);
    }
    return 0xffb347;
  }
}
