# Architecture Guide

## Overview
The visualization is split into composable modules with clear ownership:
- `src/core/SceneApp.js`: App shell for renderer, scene, camera, controls, lights, and animation loop.
- `src/core/TensorVolume.js`: Reusable voxel tensor renderer for any `[C, H, W]` block.
- `src/core/ConvolutionStageVisualization.js`: Kernel bank and tunnel visualization between one input/output tensor pair.
- `src/core/tensor-math.js`: Shared tensor/kernel span math used by pipeline and stage layout.
- `src/core/tunnel-utils.js`: Shared geometry helpers for translucent tunnel planes.
- `src/core/color-utils.js`: Shared gradient/color utilities.
- `src/config/pipeline-config.js`: Declarative pipeline and visual style configuration.

## OOP Design Decisions
- Single Responsibility: each class handles one concern (scene lifecycle, tensor rendering, stage rendering).
- Composition over inheritance: the pipeline is composed by wiring `TensorVolume` and `ConvolutionStageVisualization` instances.
- Encapsulation: geometric and layout calculations are internal methods, while external code only uses stable public APIs.

## Documentation Standards Used
1. Public API JSDoc
- Constructors and exported functions have JSDoc for parameters and return values.

2. Architectural docs next to code
- This file documents module boundaries and intended responsibilities.

3. Declarative configuration
- `pipeline-config.js` acts as a living specification for shapes, colors, and stage topology.

## How to Extend
- Add a new convolution stage: append a `createConvolutionStage(...)` call to `PIPELINE_CONFIG.stages`.
- Stage naming aligns with CNN terminology: `outputChannels`, `kernelSize`, and optional `kernelCount` (defaults to `outputChannels`).
- Change tensor appearance globally: edit `SHARED_VOXEL_GEOMETRY`.
- Change gradient schemes: swap `createGradientResolver(start, end)` values.
