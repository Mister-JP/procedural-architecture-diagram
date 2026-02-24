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

function createOutputUpperLeft(inputUpperLeft, zOffsetFromInput) {
  return new THREE.Vector3(inputUpperLeft.x, inputUpperLeft.y, inputUpperLeft.z + zOffsetFromInput);
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
    const outputVolume = createTensorVolume({
      shape: [stage.outputChannels, currentInputVolume.height, currentInputVolume.width],
      upperLeft: createOutputUpperLeft(currentInputVolume.upperLeft, stage.zOffsetFromInput),
      channelColor: stage.outputColor
    });

    app.add(outputVolume.object3d);

    const stageVisualization = new ConvolutionStageVisualization({
      inputVolume: currentInputVolume,
      outputVolume,
      kernelSize: stage.kernelSize,
      filterCount: stage.filterCount,
      filterColor: stage.kernelColor
    });

    app.add(stageVisualization.object3d);
    currentInputVolume = outputVolume;
  }
}

const app = new SceneApp({
  background: SCENE_CONFIG.background,
  cameraPosition: SCENE_CONFIG.cameraPosition
});

buildPipeline(app);
app.start();
