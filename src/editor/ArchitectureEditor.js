import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  createDefaultDocument,
  createElementId,
  duplicateElementConfig,
  normalizeDocument
} from "./schema.js";
import { createElementInstance } from "./elements/ElementFactory.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeElementConfig(config) {
  return normalizeDocument({ elements: [config] }).elements[0];
}

function resolveElementIdFromIntersection(object) {
  let current = object;
  while (current) {
    if (current.userData?.elementId) {
      return current.userData.elementId;
    }
    current = current.parent;
  }
  return null;
}

function resolveBestElementIdFromIntersections(intersections) {
  let best = null;

  for (const hit of intersections) {
    const elementId = resolveElementIdFromIntersection(hit.object);
    if (!elementId) {
      continue;
    }

    const renderOrder = hit.object.renderOrder ?? 0;
    if (
      !best ||
      renderOrder > best.renderOrder ||
      (renderOrder === best.renderOrder && hit.distance < best.distance)
    ) {
      best = {
        elementId,
        renderOrder,
        distance: hit.distance
      };
    }
  }

  return best?.elementId ?? null;
}

export class ArchitectureEditor {
  constructor({ app, onSelectionChange, onDocumentChange }) {
    this.app = app;
    this.onSelectionChange = onSelectionChange;
    this.onDocumentChange = onDocumentChange;

    this.document = createDefaultDocument();
    this.elements = new Map();
    this.selectedId = null;
    this.transformMode = "translate";
    this.curveHandleEnabled = false;
    this.isDraggingTransform = false;

    this.rootGroup = new THREE.Group();
    this.app.add(this.rootGroup);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.selectionHelper = null;
    this.createCurveHandle();
    this.setupTransformControls();
    this.setupSelectionEvents();

    this.loadDocument(createDefaultDocument(), { selectFirst: true, emitDocumentChange: false });
  }

  createCurveHandle() {
    this.curveHandle = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffcc00,
        transparent: true,
        opacity: 0.9,
        depthTest: false
      })
    );
    this.curveHandle.visible = false;
    this.curveHandle.userData.isCurveHandle = true;
    this.app.add(this.curveHandle);
  }

  setupTransformControls() {
    this.transformControls = new TransformControls(this.app.camera, this.app.renderer.domElement);
    this.transformControls.setMode(this.transformMode);
    this.transformControls.setSize(0.85);
    this.transformControlsHelper = this.transformControls.getHelper();

    this.transformControls.addEventListener("dragging-changed", (event) => {
      this.isDraggingTransform = event.value;
      this.app.controls.enabled = !event.value;
    });

    this.transformControls.addEventListener("objectChange", () => {
      this.handleTransformObjectChange();
    });

    this.transformControls.addEventListener("change", () => {
      if (this.selectionHelper) {
        this.selectionHelper.update();
      }
      this.app.renderFrame();
    });

    this.app.add(this.transformControlsHelper);
  }

  setupSelectionEvents() {
    this.onPointerDown = this.onPointerDown.bind(this);
    this.app.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
  }

  destroy() {
    this.app.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.clearElements();
    this.transformControls.detach();
    this.app.scene.remove(this.transformControlsHelper);
    this.transformControls.dispose();
    this.app.scene.remove(this.curveHandle);
  }

  onPointerDown(event) {
    const activeTransformAxis = this.transformControls.axis;
    if (this.isDraggingTransform || typeof activeTransformAxis === "string") {
      return;
    }

    const rect = this.app.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.app.camera);
    const intersections = this.raycaster.intersectObjects(this.rootGroup.children, true);

    if (intersections.length === 0) {
      this.selectElement(null);
      return;
    }

    const elementId = resolveBestElementIdFromIntersections(intersections);
    this.selectElement(elementId);
  }

  loadDocument(rawDocument, { selectFirst = false, emitDocumentChange = true } = {}) {
    const normalized = normalizeDocument(rawDocument);

    this.document = {
      version: normalized.version,
      scene: clone(normalized.scene),
      elements: []
    };

    this.clearElements();

    for (const elementConfig of normalized.elements) {
      this.addElementInstance(elementConfig, { select: false, emitDocumentChange: false });
    }

    this.app.setBackground(this.document.scene.background, false);
    this.app.camera.position.set(...this.document.scene.cameraPosition);
    this.app.controls.target.set(0, 0, 0);
    this.app.controls.update();

    if (selectFirst) {
      const first = this.elements.keys().next().value ?? null;
      this.selectElement(first, { emitSelection: true });
    } else {
      this.selectElement(null, { emitSelection: true });
    }

    this.app.renderFrame();

    if (emitDocumentChange) {
      this.emitDocumentChange();
    }
  }

  clearElements() {
    for (const element of this.elements.values()) {
      element.dispose();
    }
    this.elements.clear();

    if (this.selectionHelper) {
      this.app.scene.remove(this.selectionHelper);
      this.selectionHelper.geometry?.dispose();
      this.selectionHelper.material?.dispose();
      this.selectionHelper = null;
    }

    this.transformControls.detach();
    this.curveHandle.visible = false;
    this.selectedId = null;
  }

  addElementInstance(elementConfig, { select = true, emitDocumentChange = true } = {}) {
    const normalized = sanitizeElementConfig(elementConfig);

    let nextId = normalized.id;
    while (this.elements.has(nextId)) {
      nextId = createElementId(normalized.type);
    }
    normalized.id = nextId;

    const instance = createElementInstance(normalized);
    this.elements.set(normalized.id, instance);
    this.rootGroup.add(instance.group);

    if (select) {
      this.selectElement(normalized.id);
    }

    if (emitDocumentChange) {
      this.emitDocumentChange();
    }

    this.app.renderFrame();
    return normalized.id;
  }

  createElementFromTemplate(templateConfig, { offsetBySelection = true } = {}) {
    const nextConfig = clone(templateConfig);
    nextConfig.id = createElementId(nextConfig.type);

    const insertion = this.getInsertionPosition(offsetBySelection);
    nextConfig.transform = nextConfig.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0] };
    nextConfig.transform.position = insertion;
    nextConfig.transform.rotation = nextConfig.transform.rotation ?? [0, 0, 0];

    return this.addElementInstance(nextConfig, { select: true, emitDocumentChange: true });
  }

  getInsertionPosition(offsetBySelection = true) {
    if (offsetBySelection && this.selectedId && this.elements.has(this.selectedId)) {
      const selected = this.elements.get(this.selectedId);
      return [
        selected.group.position.x + 14,
        selected.group.position.y + 10,
        selected.group.position.z
      ];
    }

    return [this.app.controls.target.x, this.app.controls.target.y, this.app.controls.target.z];
  }

  updateSelectedElement(nextConfig) {
    if (!this.selectedId || !this.elements.has(this.selectedId)) {
      return null;
    }

    const current = this.elements.get(this.selectedId);
    const merged = {
      ...clone(current.toDocumentElement()),
      ...clone(nextConfig),
      id: this.selectedId,
      type: current.type,
      transform: clone(current.toDocumentElement().transform)
    };

    const normalized = sanitizeElementConfig(merged);
    normalized.id = this.selectedId;
    normalized.transform = merged.transform;

    current.update(normalized);
    this.refreshSelectionVisualization();
    this.emitDocumentChange();
    this.app.renderFrame();
    return normalized;
  }

  selectElement(elementId, { emitSelection = true } = {}) {
    if (elementId && !this.elements.has(elementId)) {
      elementId = null;
    }

    this.selectedId = elementId;
    this.refreshSelectionVisualization();

    if (emitSelection) {
      this.emitSelectionChange();
    }

    this.app.renderFrame();
  }

  refreshSelectionVisualization() {
    if (this.selectionHelper) {
      this.app.scene.remove(this.selectionHelper);
      this.selectionHelper.geometry?.dispose();
      this.selectionHelper.material?.dispose();
      this.selectionHelper = null;
    }

    const selected = this.getSelectedElement();
    if (!selected) {
      this.transformControls.detach();
      this.curveHandle.visible = false;
      return;
    }

    this.selectionHelper = new THREE.BoxHelper(selected.group, 0x9cd8ff);
    this.app.add(this.selectionHelper);

    if (this.curveHandleEnabled && selected.isCurved && selected.isCurved()) {
      this.attachCurveHandle(selected);
    } else {
      this.detachCurveHandle();
      this.transformControls.attach(selected.group);
      this.transformControls.setMode(this.transformMode);
    }
  }

  attachCurveHandle(curvedArrowElement) {
    const worldControlPoint = curvedArrowElement.getControlPointWorld();
    if (!worldControlPoint) {
      this.detachCurveHandle();
      return;
    }

    this.curveHandle.visible = true;
    this.curveHandle.position.copy(worldControlPoint);
    this.transformControls.attach(this.curveHandle);
    this.transformControls.setMode("translate");
  }

  detachCurveHandle() {
    this.curveHandle.visible = false;
  }

  setCurveHandleEnabled(enabled) {
    this.curveHandleEnabled = enabled;
    this.refreshSelectionVisualization();
  }

  setTransformMode(mode) {
    this.transformMode = mode === "rotate" ? "rotate" : "translate";

    if (!(this.curveHandleEnabled && this.getSelectedElement()?.isCurved?.())) {
      this.transformControls.setMode(this.transformMode);
    }
  }

  duplicateSelected() {
    const selected = this.getSelectedElement();
    if (!selected) {
      return null;
    }

    const duplicated = duplicateElementConfig(selected.toDocumentElement());
    return this.addElementInstance(duplicated, { select: true, emitDocumentChange: true });
  }

  deleteSelectedElement() {
    if (!this.selectedId || !this.elements.has(this.selectedId)) {
      return false;
    }

    const targetId = this.selectedId;
    const targetElement = this.elements.get(targetId);
    targetElement.dispose();
    this.elements.delete(targetId);

    this.selectElement(null, { emitSelection: true });
    this.emitDocumentChange();
    this.app.renderFrame();
    return true;
  }

  getSelectedElement() {
    if (!this.selectedId) {
      return null;
    }
    return this.elements.get(this.selectedId) ?? null;
  }

  getSelectedElementConfig() {
    const selected = this.getSelectedElement();
    return selected ? selected.toDocumentElement() : null;
  }

  handleTransformObjectChange() {
    const selected = this.getSelectedElement();
    if (!selected) {
      return;
    }

    const attachedObject = this.transformControls.object;
    if (!attachedObject) {
      return;
    }

    if (attachedObject === this.curveHandle && this.curveHandleEnabled && selected.isCurved?.()) {
      selected.setControlPointFromWorld(this.curveHandle.getWorldPosition(new THREE.Vector3()));
      this.curveHandle.position.copy(selected.getControlPointWorld());
      if (this.selectionHelper) {
        this.selectionHelper.update();
      }
      this.emitDocumentChange();
      this.emitSelectionChange();
      return;
    }

    if (attachedObject === selected.group) {
      selected.syncTransformFromGroup();
      if (this.selectionHelper) {
        this.selectionHelper.update();
      }
      this.emitDocumentChange();
      this.emitSelectionChange();
    }
  }

  setBackground(backgroundColor) {
    this.document.scene.background = backgroundColor;
    this.app.setBackground(backgroundColor, true);
    this.emitDocumentChange();
  }

  fitView() {
    if (this.rootGroup.children.length === 0) {
      return;
    }
    this.app.frameObject(this.rootGroup, 1.25);
  }

  exportDocument() {
    const exported = {
      version: 1,
      scene: {
        background: this.document.scene.background,
        cameraPosition: [this.app.camera.position.x, this.app.camera.position.y, this.app.camera.position.z]
      },
      elements: []
    };

    for (const element of this.elements.values()) {
      exported.elements.push(element.toDocumentElement());
    }

    return exported;
  }

  exportImage({
    format = "png",
    quality = 0.92,
    width = null,
    height = null,
    includeEditorOverlays = false
  } = {}) {
    if (includeEditorOverlays) {
      return this.app.exportRaster({ format, quality, width, height });
    }

    const previousState = {
      transformControlsHelperVisible: this.transformControlsHelper.visible,
      curveHandleVisible: this.curveHandle.visible,
      selectionHelperVisible: this.selectionHelper ? this.selectionHelper.visible : null
    };

    this.transformControlsHelper.visible = false;
    this.curveHandle.visible = false;
    if (this.selectionHelper) {
      this.selectionHelper.visible = false;
    }

    try {
      return this.app.exportRaster({ format, quality, width, height });
    } finally {
      this.transformControlsHelper.visible = previousState.transformControlsHelperVisible;
      this.curveHandle.visible = previousState.curveHandleVisible;
      if (this.selectionHelper && previousState.selectionHelperVisible != null) {
        this.selectionHelper.visible = previousState.selectionHelperVisible;
      }
      this.app.renderFrame();
    }
  }

  emitSelectionChange() {
    if (!this.onSelectionChange) {
      return;
    }
    this.onSelectionChange(this.getSelectedElementConfig());
  }

  emitDocumentChange() {
    if (!this.onDocumentChange) {
      return;
    }
    this.onDocumentChange(this.exportDocument());
  }
}
