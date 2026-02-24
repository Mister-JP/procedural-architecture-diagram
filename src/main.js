import * as THREE from "three";
import { SceneApp } from "./core/SceneApp.js";
import { TensorVolume } from "./core/TensorVolume.js";
import { ConvolutionStageVisualization } from "./core/ConvolutionStageVisualization.js";
import { PIPELINE_CONFIG, SCENE_CONFIG, SHARED_VOXEL_GEOMETRY } from "./config/pipeline-config.js";

function createTensorVolume({ shape, upperLeft, channelColor }) {
  return new TensorVolume({
    shape,
    upperLeft,
    channelColor,
    ...SHARED_VOXEL_GEOMETRY
  });
}

function getTensorSpan(length, step, voxelSize) {
  return length * voxelSize + (length - 1) * (step - voxelSize);
}

function createOutputUpperLeft(inputVolume, stage, outputShape) {
  const xOffset = stage.xOffsetFromInput ?? 0;
  const yOffset = stage.yOffsetFromInput ?? 0;
  const zOffset = stage.zOffsetFromInput ?? 0;

  const outputWidth = outputShape[2];
  const outputWidthSpan = getTensorSpan(outputWidth, inputVolume.stepXY, inputVolume.pixelSize);
  const alignedUpperLeftX = inputVolume.getCenterX() - outputWidthSpan * 0.5;

  return new THREE.Vector3(
    (stage.alignCenterXWithInput ? alignedUpperLeftX : inputVolume.upperLeft.x) + xOffset,
    inputVolume.upperLeft.y + yOffset,
    inputVolume.upperLeft.z + zOffset
  );
}

function buildPipeline(app) {
  const inputVolume = createTensorVolume({
    shape: PIPELINE_CONFIG.input.shape,
    upperLeft: PIPELINE_CONFIG.input.upperLeft,
    channelColor: PIPELINE_CONFIG.input.channelColor
  });

  app.add(inputVolume.object3d);

  let currentInputVolume = inputVolume;

  for (const stage of PIPELINE_CONFIG.stages) {
    const outputShape = stage.outputShape ?? [stage.outputChannels, currentInputVolume.height, currentInputVolume.width];
    const outputVolume = createTensorVolume({
      shape: outputShape,
      upperLeft: createOutputUpperLeft(currentInputVolume, stage, outputShape),
      channelColor: stage.outputColor
    });

    app.add(outputVolume.object3d);

    if (stage.showStageVisualization !== false) {
      const stageVisualization = new ConvolutionStageVisualization({
        inputVolume: currentInputVolume,
        outputVolume,
        kernelSize: stage.kernelSize,
        filterCount: stage.filterCount,
        kernelDisplayMode: stage.kernelDisplayMode,
        highlightKernelAtInputPatch: stage.highlightKernelAtInputPatch,
        showHighlightConnections: stage.showHighlightConnections,
        filterColor: stage.kernelColor
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
