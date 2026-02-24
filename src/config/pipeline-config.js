import * as THREE from "three";
import { createGradientResolver } from "../core/color-utils.js";

/**
 * Shared voxel geometry for all tensor blocks (input, kernels, outputs).
 */
export const SHARED_VOXEL_GEOMETRY = {
  pixelSize: 1,
  pixelDepth: 0.7,
  gap: 0.12,
  layerGap: 0.24
};

/**
 * High-level scene setup used by the app shell.
 */
export const SCENE_CONFIG = {
  background: 0x0f1624,
  cameraPosition: new THREE.Vector3(0, 0, 260)
};

function createStageColors({
  outputStart,
  outputEnd,
  kernelStart = outputEnd,
  kernelEnd = outputStart
}) {
  return {
    outputChannelColor: createGradientResolver(outputStart, outputEnd),
    kernelColor: createGradientResolver(kernelStart, kernelEnd)
  };
}

function createConvolutionStage({
  outputChannels,
  outputShape,
  kernelSize = 3,
  kernelCount = outputChannels,
  kernelLayoutMode = "bank",
  highlightKernelAtInputPatch = true,
  showHighlightConnections = true,
  alignCenterXWithInput = false,
  xOffsetFromInput = 0,
  yOffsetFromInput = 0,
  zOffsetFromInput = 75,
  outputChannelColor,
  kernelColor,
  showStageVisualization = true
}) {
  const stage = {
    outputChannels,
    kernelSize,
    outputChannelColor,
    kernelColor
  };

  if (outputShape) {
    stage.outputShape = outputShape;
  }

  if (kernelCount !== outputChannels) {
    stage.kernelCount = kernelCount;
  }

  if (kernelLayoutMode !== "bank") {
    stage.kernelLayoutMode = kernelLayoutMode;
  }

  if (!highlightKernelAtInputPatch) {
    stage.highlightKernelAtInputPatch = false;
  }

  if (!showHighlightConnections) {
    stage.showHighlightConnections = false;
  }

  if (alignCenterXWithInput) {
    stage.alignCenterXWithInput = true;
  }

  if (xOffsetFromInput !== 0) {
    stage.xOffsetFromInput = xOffsetFromInput;
  }

  if (yOffsetFromInput !== 0) {
    stage.yOffsetFromInput = yOffsetFromInput;
  }

  if (zOffsetFromInput !== 75) {
    stage.zOffsetFromInput = zOffsetFromInput;
  }

  if (!showStageVisualization) {
    stage.showStageVisualization = false;
  }

  return stage;
}

const STAGE_COLORS = {
  gold: createStageColors({
    outputStart: 0xfff7bf,
    outputEnd: 0xffe100
  }),
  blue: createStageColors({
    outputStart: 0x8fd3ff,
    outputEnd: 0x0a2a8f
  }),
  red: createStageColors({
    outputStart: 0xff7676,
    outputEnd: 0x4a0606,
    kernelStart: 0x8e0b0b,
    kernelEnd: 0xff7676
  })
};

/**
 * Pipeline definition.
 *
 * Contract:
 * - Each stage consumes the previous tensor as input.
 * - Each stage produces an output feature map volume.
 * - For standard convolution, kernelCount defaults to outputChannels.
 * - Stage visualization renders a kernel bank and optional highlight connections.
 */
export const PIPELINE_CONFIG = {
  input: {
    shape: [23, 128, 128],
    upperLeft: new THREE.Vector3(-65.2, 65.2, 4),
    channelColor: createGradientResolver(0xff7676, 0x4a0606)
  },
  stages: [
    createConvolutionStage({
      outputChannels: 32,
      zOffsetFromInput: 75,
      ...STAGE_COLORS.gold
    }),
    createConvolutionStage({
      outputChannels: 32,
      zOffsetFromInput: 75,
      ...STAGE_COLORS.blue
    }),
    createConvolutionStage({
      outputChannels: 32,
      outputShape: [32, 64, 64],
      kernelLayoutMode: "between-volumes",
      highlightKernelAtInputPatch: false,
      showHighlightConnections: false,
      alignCenterXWithInput: true,
      yOffsetFromInput: -208,
      zOffsetFromInput: 0,
      ...STAGE_COLORS.red
    }),
    createConvolutionStage({
      outputChannels: 64,
      outputShape: [64, 64, 64],
      kernelLayoutMode: "between-volumes",
      alignCenterXWithInput: true,
      yOffsetFromInput: 0,
      zOffsetFromInput: 125,
      ...STAGE_COLORS.gold
    }),
    createConvolutionStage({
      outputChannels: 64,
      outputShape: [64, 64, 64],
      alignCenterXWithInput: true,
      yOffsetFromInput: 0,
      zOffsetFromInput: 160,
      ...STAGE_COLORS.blue
    })
  ]
};
