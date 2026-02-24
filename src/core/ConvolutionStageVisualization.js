import * as THREE from "three";
import { TensorVolume } from "./TensorVolume.js";
import { getAxisSpan, getKernelSpatialSpan } from "./tensor-math.js";
import { createTunnelPlanes } from "./tunnel-utils.js";
import { createLabelSprite } from "./label-utils.js";

/**
 * Visualizes one convolution stage:
 * - Kernel bank (kernelCount kernels, each channels x kernelSize x kernelSize)
 * - One highlighted kernel near the input receptive field
 * - Input->kernel and kernel->output translucent tunnel connections
 */
export class ConvolutionStageVisualization {
  /**
   * @param {object} options - Stage options.
   * @param {TensorVolume} options.inputVolume - Stage input tensor.
   * @param {TensorVolume} options.outputVolume - Stage output tensor.
   * @param {number} [options.kernelSize=3] - Spatial kernel size.
   * @param {number} [options.kernelCount=32] - Number of kernels.
   * @param {number} [options.filterCount] - Deprecated alias for kernelCount.
   * @param {number} [options.kernelGridColumns=8] - Kernels per row in bank layout.
   * @param {number} [options.highlightedKernelIndex=0] - Kernel index to highlight.
   * @param {"bank" | "between-volumes"} [options.kernelLayoutMode="bank"] - Kernel layout mode.
   * @param {"bank" | "between-volumes"} [options.kernelDisplayMode] - Deprecated alias for kernelLayoutMode.
   * @param {(index: number, count: number) => number} [options.kernelColor] - Kernel color resolver.
   * @param {(index: number, count: number) => number} [options.filterColor] - Deprecated alias for kernelColor.
   */
  constructor({
    inputVolume,
    outputVolume,
    kernelSize = 3,
    kernelCount,
    filterCount,
    kernelGridColumns,
    highlightedKernelIndex = 0,
    kernelLayoutMode,
    kernelDisplayMode,
    highlightKernelAtInputPatch = true,
    showHighlightConnections = true,
    showDiagramTransition = false,
    diagramTransitionLabel = "Strided Convolution",
    kernelColor,
    filterColor
  }) {
    this.inputVolume = inputVolume;
    this.outputVolume = outputVolume;
    this.kernelSize = kernelSize;
    this.kernelCount = Math.max(1, kernelCount ?? filterCount ?? 32);
    this.kernelGridColumns = kernelGridColumns ?? this.getAdaptiveKernelGridColumns();
    this.highlightedKernelIndex = Math.max(
      0,
      Math.min(highlightedKernelIndex, this.kernelCount - 1)
    );
    this.kernelLayoutMode = kernelLayoutMode ?? kernelDisplayMode ?? "bank";
    this.highlightKernelAtInputPatch = highlightKernelAtInputPatch;
    this.showHighlightConnections = showHighlightConnections;
    this.showDiagramTransition = showDiagramTransition;
    this.diagramTransitionLabel = diagramTransitionLabel;
    this.kernelColor = kernelColor ?? filterColor;
    this.kernelVisible = true;
    this.diagramMode = false;
    this.kernelVolumes = [];

    this.object3d = this.build();
  }

  getAdaptiveKernelGridColumns() {
    // Keep small banks visually consistent with prior layouts, but scale columns
    // for large kernel counts to avoid excessively tall banks.
    return Math.max(8, Math.ceil(Math.sqrt(this.kernelCount)));
  }

  build() {
    const group = new THREE.Group();
    const layout = this.computeLayout();

    this.kernelBankGroup = new THREE.Group();
    this.referenceKernelGroup = new THREE.Group();
    this.connectionGroup = new THREE.Group();
    this.diagramGroup = new THREE.Group();

    this.addKernelBank(layout);
    this.addHighlightConnections(this.connectionGroup, layout);
    if (this.showDiagramTransition) {
      this.addDiagramArrow(this.diagramGroup, layout);
    }

    group.add(
      this.kernelBankGroup,
      this.referenceKernelGroup,
      this.connectionGroup,
      this.diagramGroup
    );
    this.applyDisplayState();

    return group;
  }

  computeLayout() {
    const kernelXYSpan = getKernelSpatialSpan(
      this.kernelSize,
      this.inputVolume.pixelSize,
      this.inputVolume.gap
    );
    const kernelDepthSpan = this.inputVolume.getDepthSpan();
    const inputHeightSpan = this.inputVolume.getHeightSpan();
    const outputHeightSpan = this.outputVolume.getHeightSpan();
    const outputDepthSpan = this.outputVolume.getDepthSpan();
    const cols = this.kernelGridColumns;
    const rows = Math.ceil(this.kernelCount / cols);
    const bankCellStep = kernelXYSpan + 1.15;
    const bankWidth = getAxisSpan(cols, kernelXYSpan, bankCellStep - kernelXYSpan);
    const bankHeight = getAxisSpan(rows, kernelXYSpan, bankCellStep - kernelXYSpan);

    const inputCenterX = this.inputVolume.getCenterX();
    const inputCenterY = this.inputVolume.getCenterY();
    const inputCenterZ = this.inputVolume.getCenterZ();
    const outputCenterX = this.outputVolume.getCenterX();
    const outputCenterY = this.outputVolume.getCenterY();
    const outputCenterZ = this.outputVolume.getCenterZ();

    let bankCenterX = inputCenterX;
    let bankCenterY = inputCenterY;
    let bankCenterZ = (inputCenterZ + outputCenterZ) * 0.5;

    if (this.kernelLayoutMode === "between-volumes") {
      bankCenterX = (inputCenterX + outputCenterX) * 0.5;

      const deltaY = outputCenterY - inputCenterY;
      const deltaZ = outputCenterZ - inputCenterZ;

      if (Math.abs(deltaY) >= Math.abs(deltaZ)) {
        const inputFaceY = deltaY < 0 ? this.inputVolume.upperLeft.y - inputHeightSpan : this.inputVolume.upperLeft.y;
        const outputFaceY = deltaY < 0 ? this.outputVolume.upperLeft.y : this.outputVolume.upperLeft.y - outputHeightSpan;
        bankCenterY = (inputFaceY + outputFaceY) * 0.5;
        bankCenterZ = (inputCenterZ + outputCenterZ) * 0.5;
      } else {
        const inputFaceZ = deltaZ >= 0 ? this.inputVolume.upperLeft.z : this.inputVolume.upperLeft.z - kernelDepthSpan;
        const outputFaceZ = deltaZ >= 0 ? this.outputVolume.upperLeft.z - outputDepthSpan : this.outputVolume.upperLeft.z;
        bankCenterZ = (inputFaceZ + outputFaceZ) * 0.5;
        bankCenterY = (inputCenterY + outputCenterY) * 0.5;
      }
    }

    const bankStartX = bankCenterX - bankWidth * 0.5 + kernelXYSpan * 0.5;
    const bankTopY = bankCenterY + bankHeight * 0.5 - kernelXYSpan * 0.5;
    const highlightedKernelRow = Math.floor(this.highlightedKernelIndex / cols);
    const highlightedKernelCol = this.highlightedKernelIndex % cols;
    const highlightedGridCenter = new THREE.Vector3(
      bankStartX + highlightedKernelCol * bankCellStep,
      bankTopY - highlightedKernelRow * bankCellStep,
      bankCenterZ
    );

    const inputKernelCenter = this.inputVolume.getKernelCenter(0, this.kernelSize);
    const highlightedKernelCenter = this.highlightKernelAtInputPatch
      ? new THREE.Vector3(inputKernelCenter.x, inputKernelCenter.y, bankCenterZ)
      : highlightedGridCenter;

    return {
      cols,
      bankCellStep,
      bankCenterZ,
      bankStartX,
      bankTopY,
      kernelXYSpan,
      kernelDepthSpan,
      highlightedKernelCenter
    };
  }

  addKernelBank(layout) {
    for (let i = 0; i < this.kernelCount; i += 1) {
      const row = Math.floor(i / layout.cols);
      const col = i % layout.cols;

      const gridCenter = new THREE.Vector3(
        layout.bankStartX + col * layout.bankCellStep,
        layout.bankTopY - row * layout.bankCellStep,
        layout.bankCenterZ
      );

      const displayCenter = i === this.highlightedKernelIndex ? layout.highlightedKernelCenter : gridCenter;
      const kernelColor = this.getKernelColor(i);

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
      this.kernelVolumes.push(kernelVolume);

      if (i === this.highlightedKernelIndex) {
        this.referenceKernelGroup.add(kernelVolume.object3d);
      } else {
        this.kernelBankGroup.add(kernelVolume.object3d);
      }
    }
  }

  addHighlightConnections(group, layout) {
    const inputPatchCenter = this.inputVolume.getKernelCenter(0, this.kernelSize);
    const connectorCenter = new THREE.Vector3(
      inputPatchCenter.x,
      inputPatchCenter.y,
      layout.bankCenterZ
    );

    const outputChannelIndex = this.outputVolume.channels - 1;
    const outputPixelCenter = this.outputVolume.getCellCenter(outputChannelIndex, 0, 0);
    const outputPixelColor = this.outputVolume.getChannelColor(outputChannelIndex);

    const inputToKernelDirection = Math.sign(connectorCenter.z - inputPatchCenter.z) || 1;
    const kernelFaceTowardInput = new THREE.Vector3(
      connectorCenter.x,
      connectorCenter.y,
      connectorCenter.z - inputToKernelDirection * (layout.kernelDepthSpan * 0.5)
    );

    const kernelToOutputDirection = Math.sign(outputPixelCenter.z - connectorCenter.z) || 1;
    const kernelFaceTowardOutput = new THREE.Vector3(
      connectorCenter.x,
      connectorCenter.y,
      connectorCenter.z + kernelToOutputDirection * (layout.kernelDepthSpan * 0.5)
    );

    const inputToKernelTunnel = createTunnelPlanes({
      startCenter: inputPatchCenter,
      startWidth: layout.kernelXYSpan,
      startHeight: layout.kernelXYSpan,
      endCenter: kernelFaceTowardInput,
      endWidth: layout.kernelXYSpan,
      endHeight: layout.kernelXYSpan,
      color: this.getKernelColor(this.highlightedKernelIndex),
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

  addDiagramArrow(group, layout) {
    const start = new THREE.Vector3(
      this.inputVolume.getCenterX(),
      this.inputVolume.getCenterY(),
      this.inputVolume.getCenterZ()
    );
    const end = new THREE.Vector3(
      this.outputVolume.getCenterX(),
      this.outputVolume.getCenterY(),
      this.outputVolume.getCenterZ()
    );
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();

    if (length <= 0.0001) {
      return;
    }

    direction.normalize();
    const color = this.getKernelColor(this.highlightedKernelIndex);
    const coneHeight = Math.max(4, length * 0.12);
    const shaftLength = Math.max(4, length - coneHeight);
    const shaftRadius = Math.max(0.55, layout.kernelXYSpan * 0.12);
    const orientation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction
    );

    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    shaft.position.copy(
      start.clone().add(direction.clone().multiplyScalar(shaftLength * 0.5))
    );
    shaft.quaternion.copy(orientation);
    group.add(shaft);

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(shaftRadius * 1.75, coneHeight, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    head.position.copy(
      start.clone().add(direction.clone().multiplyScalar(shaftLength + coneHeight * 0.5))
    );
    head.quaternion.copy(orientation);
    group.add(head);

    const label = createLabelSprite(this.diagramTransitionLabel, {
      scaleHeight: Math.max(7, layout.kernelXYSpan * 1.75)
    });
    const labelOffset = new THREE.Vector3();
    labelOffset.crossVectors(direction, new THREE.Vector3(0, 1, 0));
    if (labelOffset.lengthSq() < 0.001) {
      labelOffset.set(1, 0, 0);
    }
    labelOffset.normalize().multiplyScalar(layout.kernelXYSpan * 1.3);
    label.position.copy(start.clone().add(end).multiplyScalar(0.5).add(labelOffset));
    group.add(label);
  }

  applyDisplayState() {
    if (this.kernelBankGroup) {
      this.kernelBankGroup.visible = this.kernelVisible && !this.diagramMode;
    }
    if (this.referenceKernelGroup) {
      this.referenceKernelGroup.visible = true;
    }
    if (this.connectionGroup) {
      this.connectionGroup.visible = true;
    }
    if (this.diagramGroup) {
      this.diagramGroup.visible = this.diagramMode && this.showDiagramTransition;
    }
  }

  setKernelVisibility(visible) {
    this.kernelVisible = visible;
    this.applyDisplayState();
  }

  setDiagramMode(enabled) {
    this.diagramMode = enabled;
    this.applyDisplayState();
  }

  setVoxelOpacity(opacity) {
    for (const kernelVolume of this.kernelVolumes) {
      kernelVolume.setFillOpacity(opacity);
    }
  }

  setVoxelEdgeColor(colorHex) {
    for (const kernelVolume of this.kernelVolumes) {
      kernelVolume.setEdgeColor(colorHex);
    }
  }

  getKernelVolumes() {
    return this.kernelVolumes;
  }

  getKernelColor(index) {
    if (this.kernelColor) {
      return this.kernelColor(index, this.kernelCount);
    }
    return 0xffb347;
  }

  // Backward compatibility for older integrations that used filter nomenclature.
  getFilterColor(index) {
    return this.getKernelColor(index);
  }
}
