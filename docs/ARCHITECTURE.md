# Architecture Guide

## Overview
The app is now a JSON-driven editor rather than a hardcoded CNN pipeline renderer.

Core modules:
- `src/core/SceneApp.js`: renderer/camera/controls shell.
- `src/editor/ArchitectureEditor.js`: scene element orchestration, selection, transform controls, import/export.
- `src/editor/schema.js`: normalized document schema and defaults.
- `src/editor/elements/BaseElement.js`: common element lifecycle contract.
- `src/editor/elements/TensorElement.js`: tensor cuboid element built on `TensorVolume`.
- `src/editor/TensorRelationOverlay.js`: renders parent-kernel-pyramid convolution relations between tensors.
- `src/editor/elements/ArrowElement.js`: 3D/2D/dotted/curved arrows.
- `src/editor/elements/LabelElement.js`: configurable sprite labels.
- `src/editor/ElementPreview.js`: inspector-side preview renderer.

## OOP Design Decisions
- Single responsibility:
  - Scene lifecycle in `SceneApp`.
  - Editing orchestration in `ArchitectureEditor`.
  - Geometry/rendering in per-element classes.
- Composition over inheritance:
  - Editor composes polymorphic element instances via factory + base contract.
- Encapsulation:
  - Element internals own geometry construction and serialization boundaries.

## Data Contract
- Source of truth is a versioned JSON document (`scene` + `elements[]`).
- Every element has:
  - `id`
  - `type` (`tensor`, `arrow`, `label`)
  - `name`
  - `transform` (`position`, `rotation`)
  - `data` (type-specific payload)
- Tensor data uses a shape-first model:
  - `dimensions`: `{ height, width, channels }`
  - `scale`: per-axis world units (`height`, `width`, `channel`)
  - `convolution`: relation metadata (`parentTensorId`, kernel tensor, pyramid settings)
- `schema.js` normalizes imports, clamps invalid values, and injects defaults.

## Interaction Model
- Raycast click selection resolves owning element IDs from scene nodes.
- `TransformControls` provides translate/rotate manipulation of selected elements.
- Curved arrows expose an optional in-canvas control handle for control-point editing.
- Convolution overlays are non-selectable scene decorations derived from tensor relations.

## Extendability
- Add a new element type by:
  1. Defining defaults/normalization in `schema.js`.
  2. Creating a new `*Element` class extending `BaseElement`.
  3. Registering it in `ElementFactory.js`.
  4. Adding inspector controls in `main.js`.
