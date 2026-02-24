# Neural Architecture Editor (Three.js)

Interactive Three.js editor for composing neural-network style diagrams from reusable primitives and storing the full architecture as JSON.

## What You Can Do

- Create and style core elements:
  - `Tensor` volumes (shape, voxel geometry, color gradient, opacity, border)
  - `Arrow` connectors (`3d`, `2d`, `dotted`, `curved`)
  - `Label` nodes (text, font, size, text/background/border styling)
- Move and rotate any selected element in canvas.
- Re-open and edit any element by clicking it.
- Duplicate selected elements.
- Undo recent edits with `Cmd/Ctrl+Z` or the Undo button.
- Toggle (hide/show) both side panels to maximize canvas space.
- Export the complete architecture to JSON and import it later.

## Project Structure

- `src/main.js`: app entrypoint, panel UI wiring, create/edit flows
- `src/editor/ArchitectureEditor.js`: selection, transforms, lifecycle, import/export
- `src/editor/schema.js`: JSON schema defaults + normalization
- `src/editor/elements/*`: OOP element implementations (`BaseElement`, `TensorElement`, `ArrowElement`, `LabelElement`)
- `src/editor/ElementPreview.js`: right-panel preview renderer
- `src/config/default-architecture.json`: default loaded architecture document
- `docs/EDITOR_REFACTOR_PLAN.md`: refactor design and OO plan

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

## JSON Document

The editor persists architecture as a JSON document:

- `scene`: global visual state (`background`, `cameraPosition`)
- `elements[]`: typed nodes with `transform` + type-specific `data`

Document parsing is resilient: import is normalized with defaults and numeric bounds in `src/editor/schema.js`.
