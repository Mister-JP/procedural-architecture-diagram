# Neural Architecture Editor (Three.js)

Live demo: https://Mister-JP.github.io/procedural-architecture-diagram/

A JSON-driven Three.js editor for building neural-network style architecture diagrams from reusable 3D elements.

## What You Can Do

![U-Net architecture screenshot](docs/U-Net%20Screenshot.png)

- Create and style `tensor`, `arrow`, `label`, and `frustum` elements.
- Configure tensor dimensions, scale, color gradients, per-channel color ranges, and label styling.
- Model tensor convolution relationships using `parentTensorId` with kernel and pyramid projection overlays.
- Use arrow variants: `3d`, `2d`, `dotted`, and `curved` (with optional direct curve handle editing).
- Multi-select with `Shift+Click`, then move/rotate selected elements, duplicate, delete, and undo (`Cmd/Ctrl+Z`).
- Use the view gizmo to align camera to `X/Y/Z`, lock to `XY/YZ/XZ` plane views, and return to free `3D`.
- Use live alignment guides and snapping while moving elements.
- Hide/show both side panels to maximize canvas space.
- Load demo projects from `src/config/*.json` or import JSON from your computer.
- Save JSON, reload later, and export PNG at custom resolution with optional crop region selection.

## Quick Start

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
npm run preview
```

## Project Structure

- `src/main.js`: UI wiring, panel actions, create/edit flows, export/import interactions
- `src/editor/ArchitectureEditor.js`: scene orchestration, selection, transforms, history, import/export
- `src/editor/schema.js`: JSON schema defaults, normalization, and ID/document utilities
- `src/editor/elements/*`: element implementations (`TensorElement`, `ArrowElement`, `LabelElement`, `FrustumElement`)
- `src/editor/TensorRelationOverlay.js`: parent-kernel-pyramid relation renderer between tensors
- `src/editor/ElementPreview.js`: inspector preview renderer
- `src/config/default-architecture.json`: default starter document
- `src/config/U-NetArchitecture.json`: bundled example architecture
- `docs/ARCHITECTURE.md`: technical architecture reference

## JSON Document Shape

- `scene`: global scene/camera metadata
- `elements[]`: typed nodes with `id`, `type`, `name`, `transform`, and type-specific `data`

Imports are normalized in `src/editor/schema.js` (defaults, clamping, and schema-safe fallback values).
