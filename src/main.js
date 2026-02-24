import * as THREE from "three";
import { SceneApp } from "./core/SceneApp.js";
import { TensorVolume } from "./core/TensorVolume.js";
import { ConvolutionStageVisualization } from "./core/ConvolutionStageVisualization.js";
import { getAxisSpan } from "./core/tensor-math.js";
import { PIPELINE_CONFIG, SCENE_CONFIG, SHARED_VOXEL_GEOMETRY } from "./config/pipeline-config.js";

const PROPORTIONAL_SPACING_FACTOR = 0.4;

function createTensorVolume({ shape, upperLeft, channelColor }) {
  return new TensorVolume({
    shape,
    upperLeft,
    channelColor,
    ...SHARED_VOXEL_GEOMETRY
  });
}

function createOutputUpperLeft(inputVolume, stage, outputShape) {
  const xOffset = stage.xOffsetFromInput ?? 0;
  const yOffset = stage.yOffsetFromInput ?? 0;
  const zOffset = stage.zOffsetFromInput ?? 0;

  const outputWidth = outputShape[2];
  const outputHeight = outputShape[1];
  const outputChannels = outputShape[0];
  const outputWidthSpan = getAxisSpan(outputWidth, inputVolume.pixelSize, inputVolume.gap);
  const outputHeightSpan = getAxisSpan(outputHeight, inputVolume.pixelSize, inputVolume.gap);
  const outputDepthSpan = getAxisSpan(outputChannels, inputVolume.pixelDepth, inputVolume.layerGap);
  const alignedUpperLeftX = inputVolume.getCenterX() - outputWidthSpan * 0.5;
  const inputHeightSpan = inputVolume.getHeightSpan();
  const inputDepthSpan = inputVolume.getDepthSpan();
  const proportionalYSpan = (inputHeightSpan * 0.5 + outputHeightSpan * 0.5) * PROPORTIONAL_SPACING_FACTOR;
  const proportionalZSpan = (inputDepthSpan * 0.5 + outputDepthSpan * 0.5) * PROPORTIONAL_SPACING_FACTOR;

  const outputCenterY =
    yOffset === 0
      ? inputVolume.getCenterY()
      : inputVolume.getCenterY() +
        Math.sign(yOffset) * (proportionalYSpan + Math.abs(yOffset));

  const outputCenterZ =
    zOffset === 0
      ? inputVolume.getCenterZ()
      : inputVolume.getCenterZ() +
        Math.sign(zOffset) * (proportionalZSpan + Math.abs(zOffset));

  const centeredUpperLeftY = outputCenterY + outputHeightSpan * 0.5;
  const centeredUpperLeftZ = outputCenterZ + outputDepthSpan * 0.5;

  return new THREE.Vector3(
    (stage.alignCenterXWithInput ? alignedUpperLeftX : inputVolume.upperLeft.x) + xOffset,
    centeredUpperLeftY,
    centeredUpperLeftZ
  );
}

function normalizeConvolutionStage(stageConfig, inputVolume) {
  const outputChannels =
    stageConfig.outputChannels ??
    stageConfig.outputShape?.[0] ??
    stageConfig.kernelCount ??
    stageConfig.filterCount;

  if (outputChannels == null) {
    throw new Error("Each stage must define outputChannels, outputShape[0], or kernelCount/filterCount.");
  }

  return {
    outputShape: stageConfig.outputShape ?? [outputChannels, inputVolume.height, inputVolume.width],
    kernelSize: stageConfig.kernelSize ?? 3,
    kernelCount: stageConfig.kernelCount ?? stageConfig.filterCount ?? outputChannels,
    kernelLayoutMode: stageConfig.kernelLayoutMode ?? stageConfig.kernelDisplayMode ?? "bank",
    highlightKernelAtInputPatch: stageConfig.highlightKernelAtInputPatch,
    showHighlightConnections: stageConfig.showHighlightConnections,
    outputChannelColor: stageConfig.outputChannelColor ?? stageConfig.outputColor,
    kernelColor: stageConfig.kernelColor ?? stageConfig.filterColor,
    showStageVisualization: stageConfig.showStageVisualization !== false,
    alignCenterXWithInput: stageConfig.alignCenterXWithInput ?? false,
    xOffsetFromInput: stageConfig.xOffsetFromInput ?? 0,
    yOffsetFromInput: stageConfig.yOffsetFromInput ?? 0,
    zOffsetFromInput: stageConfig.zOffsetFromInput ?? 75
  };
}

function buildPipeline(app) {
  const inputVolume = createTensorVolume({
    shape: PIPELINE_CONFIG.input.shape,
    upperLeft: PIPELINE_CONFIG.input.upperLeft,
    channelColor: PIPELINE_CONFIG.input.channelColor
  });

  app.add(inputVolume.object3d);

  let currentInputVolume = inputVolume;

  for (const stageConfig of PIPELINE_CONFIG.stages) {
    const stage = normalizeConvolutionStage(stageConfig, currentInputVolume);
    const outputShape = stage.outputShape;

    const outputVolume = createTensorVolume({
      shape: outputShape,
      upperLeft: createOutputUpperLeft(currentInputVolume, stage, outputShape),
      channelColor: stage.outputChannelColor
    });

    app.add(outputVolume.object3d);

    if (stage.showStageVisualization) {
      const stageVisualization = new ConvolutionStageVisualization({
        inputVolume: currentInputVolume,
        outputVolume,
        kernelSize: stage.kernelSize,
        kernelCount: stage.kernelCount,
        kernelLayoutMode: stage.kernelLayoutMode,
        highlightKernelAtInputPatch: stage.highlightKernelAtInputPatch,
        showHighlightConnections: stage.showHighlightConnections,
        kernelColor: stage.kernelColor
      });

      app.add(stageVisualization.object3d);
    }
    currentInputVolume = outputVolume;
  }
}

const app = new SceneApp({
  background: SCENE_CONFIG.background,
  cameraPosition: SCENE_CONFIG.cameraPosition
});

buildPipeline(app);
app.start();
