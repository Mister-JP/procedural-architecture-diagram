# CNN Volume Pipeline Visualization

Three.js app that visualizes a multi-stage convolution pipeline with reusable tensor and kernel components.

## Current scope

- Input tensor: `23 x 128 x 128`
- Stage 1: `32` kernels of `23 x 3 x 3` -> output `32 x 128 x 128`
- Stage 2: `32` kernels of `32 x 3 x 3` -> output `32 x 128 x 128`
- Stage 3 stack:
  - `32` kernels of `32 x 3 x 3` -> output `32 x 64 x 64`
  - `64` kernels of `32 x 3 x 3` -> output `64 x 64 x 64`
  - `64` kernels of `64 x 3 x 3` -> output `64 x 64 x 64`
- Stage 4 stack:
  - `64` kernels of `64 x 3 x 3` -> output `64 x 32 x 32`
  - `128` kernels of `64 x 3 x 3` -> output `128 x 32 x 32`
  - `128` kernels of `128 x 3 x 3` -> output `128 x 32 x 32`
- Highlighted tunnels: input patch -> highlighted kernel -> highlighted output pixel

## Project structure

- `src/core/SceneApp.js`: scene/renderer/camera lifecycle
- `src/core/TensorVolume.js`: reusable voxel tensor renderer
- `src/core/ConvolutionStageVisualization.js`: reusable convolution stage visualizer
- `src/core/tensor-math.js`: shared tensor/kernel span helpers
- `src/core/tunnel-utils.js`: translucent tunnel geometry helpers
- `src/core/color-utils.js`: color gradient helpers
- `src/config/pipeline-config.js`: declarative pipeline + style config

Detailed architecture notes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```
