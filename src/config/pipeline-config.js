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

/**
 * Pipeline definition.
 *
 * Contract:
 * - Each stage consumes the previous tensor as input.
 * - Each stage produces an output tensor with the same HxW and configured channels.
 * - Each stage adds a kernel-bank visualization between input and output.
 */
export const PIPELINE_CONFIG = {
  input: {
    shape: [23, 128, 128],
    upperLeft: new THREE.Vector3(-65.2, 65.2, 4),
    channelColor: createGradientResolver(0xff7676, 0x4a0606)
  },
  stages: [
    {
      outputChannels: 32,
      kernelSize: 3,
      filterCount: 32,
      zOffsetFromInput: 75,
      outputColor: createGradientResolver(0xfff7bf, 0xffe100),
      kernelColor: createGradientResolver(0xffe100, 0xfff7bf)
    },
    {
      outputChannels: 32,
      kernelSize: 3,
      filterCount: 32,
      zOffsetFromInput: 75,
      outputColor: createGradientResolver(0x8fd3ff, 0x0a2a8f),
      kernelColor: createGradientResolver(0x0a2a8f, 0x8fd3ff)
    }
  ]
};
