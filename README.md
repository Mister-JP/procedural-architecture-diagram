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
- Stage 5 stack:
  - `128` kernels of `128 x 3 x 3` -> output `128 x 16 x 16`
  - `256` kernels of `128 x 3 x 3` -> output `256 x 16 x 16`
  - `256` kernels of `256 x 3 x 3` -> output `256 x 16 x 16`
- Highlighted tunnels: input patch -> highlighted kernel -> highlighted output pixel
- UI controls:
  - Toggle kernel visibility on/off.
  - Toggle Diagram Mode (keeps one reference kernel per stage and shows 3D `Strided Convolution` arrows only on downsampling transitions).
  - Toggle per-volume dimension labels (`W`, `H`, `C` values placed on tensor edges).
  - Background mode: color or `none` (transparent canvas background).
  - Pixel border mode: custom color or `none`.
  - Pixel opacity slider for all voxels plus a separate input-volume opacity slider.
  - Export capture flow with adjustable camera before download (`PNG`, `JPEG`, `SVG`).

## Project structure

- `src/core/SceneApp.js`: scene/renderer/camera lifecycle
- `src/core/TensorVolume.js`: reusable voxel tensor renderer
- `src/core/ConvolutionStageVisualization.js`: reusable convolution stage visualizer
- `src/core/tensor-math.js`: shared tensor/kernel span helpers
- `src/core/tunnel-utils.js`: translucent tunnel geometry helpers
- `src/core/label-utils.js`: camera-facing text label sprite helper
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
