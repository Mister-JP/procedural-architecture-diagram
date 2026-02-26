# Architecture Guide

## Overview

The app is a JSON-driven Three.js editor for neural-network diagram composition. The source of truth is a normalized document (`scene` + `elements[]`) that can be edited interactively, saved, loaded, and exported as image output.

## Core Modules

- `src/main.js`: app bootstrap, panel UI wiring, create/edit flows, load/save/export actions, and view gizmo controls.
- `src/core/SceneApp.js`: renderer/camera/orbit-controls shell and raster export support.
- `src/editor/ArchitectureEditor.js`: document lifecycle, element instance management, selection, transforms, undo history, and scene overlays.
- `src/editor/schema.js`: default document factory, per-type defaults, normalization/clamping, and element/document helpers.
- `src/editor/elements/BaseElement.js`: common lifecycle contract for all element types.
- `src/editor/elements/ElementFactory.js`: maps element config to concrete element class.
- `src/editor/elements/TensorElement.js`: tensor volumes and tensor label rendering.
- `src/editor/TensorRelationOverlay.js`: kernel + pyramid projection overlays for tensor-to-tensor convolution relationships.
- `src/editor/elements/ArrowElement.js`: `3d`, `2d`, `dotted`, and `curved` arrows.
- `src/editor/elements/LabelElement.js`: styled text labels.
- `src/editor/elements/FrustumElement.js`: frustum geometry with fill/border style controls.
- `src/editor/ElementPreview.js`: isolated inspector preview renderer.

## Data Contract

- Document format is versioned (`DOCUMENT_VERSION` in `schema.js`).
- Top-level keys:
  - `scene` (`background`, `cameraPosition`, `cameraTarget`)
  - `elements[]`
- Every element contains:
  - `id`
  - `type` (`tensor`, `arrow`, `label`, `frustum`)
  - `name`
  - `transform` (`position`, `rotation`)
  - `data` (type-specific payload)
- `schema.js` is the normalization boundary:
  - clamps numeric ranges
  - sanitizes color/vector inputs
  - enforces defaults
  - guarantees IDs

## Interaction Model

- Selection uses raycasting and resolves owning `elementId` from intersected scene nodes.
- `Shift+Click` toggles multi-selection.
- `TransformControls` drives translate/rotate workflows.
- Double-clicking a rotate axis snaps rotation to 90-degree increments.
- Move mode provides temporary alignment guides and snapping against other selected/non-selected element anchors.
- View gizmo supports axis alignment (`X`, `Y`, `Z`) and plane locking (`XY`, `YZ`, `XZ`) with restore back to free 3D view.
- Curved arrows expose an optional direct control handle.
- Tensor convolution kernels can expose an interactive kernel handle for offset editing.

## Import/Export

- JSON save/load uses normalized document round-tripping.
- Load flow supports:
  - bundled demos from `src/config/*.json`
  - user-provided JSON files
- Image export supports:
  - PNG output
  - configurable resolution
  - optional crop selection region (aspect-ratio aware drag selection)

## Extendability

To add a new element type:

1. Define defaults + normalization in `src/editor/schema.js`.
2. Implement a new `*Element` class extending `BaseElement`.
3. Register it in `src/editor/elements/ElementFactory.js`.
4. Add inspector controls and create/edit flow wiring in `src/main.js`.
