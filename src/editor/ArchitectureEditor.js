import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  createDefaultDocument,
  createElementId,
  duplicateElementConfig,
  normalizeDocument
} from "./schema.js";
import { createElementInstance } from "./elements/ElementFactory.js";
import { TensorRelationOverlay } from "./TensorRelationOverlay.js";

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

const ROTATION_AXIS_SET = new Set(["X", "Y", "Z"]);
const RIGHT_ANGLE_RADIANS = Math.PI * 0.5;
const ROTATE_DOUBLE_CLICK_WINDOW_MS = 340;
const ALIGNMENT_SNAP_THRESHOLD = 2;
const UNDO_HISTORY_LIMIT = 120;
const AXIS_KEYS = ["x", "y", "z"];
const ANCHOR_TYPES = ["min", "center", "max"];

const VIEW_AXIS_PRESETS = {
  X: { direction: [1, 0, 0], up: [0, 0, 1] },
  Y: { direction: [0, 1, 0], up: [0, 0, 1] },
  Z: { direction: [0, 0, 1], up: [0, 1, 0] }
};

const VIEW_PLANE_PRESETS = {
  XY: { direction: [0, 0, 1], up: [0, 1, 0], lockedAxis: "z" },
  YZ: { direction: [1, 0, 0], up: [0, 0, 1], lockedAxis: "x" },
  XZ: { direction: [0, 1, 0], up: [0, 0, 1], lockedAxis: "y" }
};

function snapAngleToRightAngle(angle) {
  const snapped = Math.round(angle / RIGHT_ANGLE_RADIANS) * RIGHT_ANGLE_RADIANS;
  return THREE.MathUtils.euclideanModulo(snapped + Math.PI, Math.PI * 2) - Math.PI;
}

function toVector3(values) {
  return new THREE.Vector3(values[0], values[1], values[2]);
}

function arraysEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export class ArchitectureEditor {
  constructor({ app, onSelectionChange, onDocumentChange, onHistoryChange }) {
    this.app = app;
    this.onSelectionChange = onSelectionChange;
    this.onDocumentChange = onDocumentChange;
    this.onHistoryChange = onHistoryChange;

    this.document = createDefaultDocument();
    this.elements = new Map();
    this.selectedId = null;
    this.selectedIds = new Set();
    this.transformMode = "translate";
    this.curveHandleEnabled = false;
    this.kernelHandleEnabled = false;
    this.kernelHandleTargetSourceId = null;
    this.isDraggingTransform = false;
    this.lastRotateAxisPointerDown = { axis: null, at: 0 };
    this.dragSession = null;
    this.activePlane = null;
    this.saved3DView = null;
    this.alignmentSnapThreshold = ALIGNMENT_SNAP_THRESHOLD;
    this.undoStack = [];
    this.isRestoringHistory = false;
    this.transformUndoCaptured = false;

    this.rootGroup = new THREE.Group();
    this.app.add(this.rootGroup);
    this.tensorRelationOverlay = new TensorRelationOverlay();
    this.app.add(this.tensorRelationOverlay.group);
    this.alignmentGuidesGroup = new THREE.Group();
    this.alignmentGuidesGroup.visible = false;
    this.app.add(this.alignmentGuidesGroup);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.selectionHelpers = [];
    this.createCurveHandle();
    this.createKernelHandle();
    this.setupTransformControls();
    this.setupSelectionEvents();

    this.loadDocument(createDefaultDocument(), { selectFirst: true, emitDocumentChange: false });
    this.emitHistoryChange();
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

  createKernelHandle() {
    this.kernelHandle = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 2.2, 2.2),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.9,
        depthTest: false
      })
    );
    this.kernelHandle.visible = false;
    this.kernelHandle.userData.isKernelHandle = true;
    this.app.add(this.kernelHandle);
  }

  setupTransformControls() {
    this.transformControls = new TransformControls(this.app.camera, this.app.renderer.domElement);
    this.transformControls.setMode(this.transformMode);
    this.transformControls.setSize(0.85);
    this.transformControlsHelper = this.transformControls.getHelper();

    this.transformControls.addEventListener("dragging-changed", (event) => {
      this.isDraggingTransform = event.value;
      this.app.controls.enabled = !event.value;
      this.handleTransformDraggingChanged(event.value);
    });

    this.transformControls.addEventListener("objectChange", () => {
      this.handleTransformObjectChange();
    });

    this.transformControls.addEventListener("change", () => {
      if (this.selectionHelpers.length > 0) {
        this.updateSelectionHelpers();
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
    this.endTransformDragSession();
    this.clearElements();
    this.transformControls.detach();
    this.app.scene.remove(this.transformControlsHelper);
    this.transformControls.dispose();
    this.app.scene.remove(this.curveHandle);
    this.app.scene.remove(this.kernelHandle);
    this.app.scene.remove(this.alignmentGuidesGroup);
    this.tensorRelationOverlay.dispose();
    this.app.scene.remove(this.tensorRelationOverlay.group);
  }

  onPointerDown(event) {
    const activeTransformAxis = this.transformControls.axis;

    if (this.transformMode === "rotate" && ROTATION_AXIS_SET.has(activeTransformAxis)) {
      this.handleRotateAxisPointerDown(event, activeTransformAxis);
    }

    if (this.isDraggingTransform || typeof activeTransformAxis === "string") {
      return;
    }

    const rect = this.app.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.app.camera);
    const intersections = this.raycaster.intersectObjects(
      [...this.rootGroup.children, this.tensorRelationOverlay.group],
      true
    );
    const shouldToggleSelection = event.shiftKey;

    if (intersections.length === 0) {
      if (!shouldToggleSelection) {
        this.selectElement(null);
      }
      return;
    }

    const elementId = resolveBestElementIdFromIntersections(intersections);
    if (shouldToggleSelection) {
      this.toggleElementSelection(elementId);
    } else {
      this.selectElement(elementId);
    }
  }

  loadDocument(
    rawDocument,
    {
      selectFirst = false,
      selectedId = null,
      selectedIds = null,
      emitDocumentChange = true,
      captureUndo = false,
      preserveCamera = false
    } = {}
  ) {
    if (captureUndo) {
      this.recordUndoSnapshot();
    }

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

    if (!preserveCamera) {
      this.app.camera.position.set(...this.document.scene.cameraPosition);
      this.app.controls.target.set(0, 0, 0);
      this.app.controls.update();
    }

    const normalizedSelectedIds = Array.isArray(selectedIds)
      ? selectedIds.filter((elementId) => this.elements.has(elementId))
      : [];

    if (normalizedSelectedIds.length > 0) {
      const activeId =
        selectedId && normalizedSelectedIds.includes(selectedId)
          ? selectedId
          : normalizedSelectedIds[normalizedSelectedIds.length - 1];
      this.setSelectedIds(normalizedSelectedIds, {
        activeId,
        emitSelection: true
      });
    } else if (selectedId && this.elements.has(selectedId)) {
      this.selectElement(selectedId, { emitSelection: true });
    } else if (selectFirst) {
      const first = this.elements.keys().next().value ?? null;
      this.selectElement(first, { emitSelection: true });
    } else {
      this.selectElement(null, { emitSelection: true });
    }

    this.refreshTensorRelationOverlay();
    this.app.renderFrame();

    if (emitDocumentChange) {
      this.emitDocumentChange();
    }
  }

  clearElements() {
    this.endTransformDragSession();
    for (const element of this.elements.values()) {
      element.dispose();
    }
    this.elements.clear();
    this.disposeSelectionHelpers();

    this.transformControls.detach();
    this.curveHandle.visible = false;
    this.kernelHandle.visible = false;
    this.kernelHandleTargetSourceId = null;
    this.selectedId = null;
    this.selectedIds.clear();
    this.clearAlignmentGuides();
    this.refreshTensorRelationOverlay();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  createHistoryEntry() {
    return {
      document: this.exportDocument(),
      selectedId: this.selectedId,
      selectedIds: this.getSelectedIds()
    };
  }

  historyEntriesEqual(a, b) {
    if (!a || !b) {
      return false;
    }
    const aSelectedIds = Array.isArray(a.selectedIds)
      ? a.selectedIds
      : a.selectedId
        ? [a.selectedId]
        : [];
    const bSelectedIds = Array.isArray(b.selectedIds)
      ? b.selectedIds
      : b.selectedId
        ? [b.selectedId]
        : [];
    if (!arraysEqual(aSelectedIds, bSelectedIds)) {
      return false;
    }
    if ((a.selectedId ?? null) !== (b.selectedId ?? null)) {
      return false;
    }
    return JSON.stringify(a.document) === JSON.stringify(b.document);
  }

  recordUndoSnapshot() {
    if (this.isRestoringHistory) {
      return false;
    }

    const snapshot = this.createHistoryEntry();
    const latest = this.undoStack[this.undoStack.length - 1] ?? null;

    if (this.historyEntriesEqual(snapshot, latest)) {
      return false;
    }

    this.undoStack.push(snapshot);
    if (this.undoStack.length > UNDO_HISTORY_LIMIT) {
      this.undoStack.shift();
    }
    this.emitHistoryChange();
    return true;
  }

  undo() {
    if (!this.canUndo()) {
      return false;
    }

    const previous = this.undoStack.pop();
    this.emitHistoryChange();

    if (!previous) {
      return false;
    }

    this.isRestoringHistory = true;
    try {
      this.loadDocument(previous.document, {
        selectedId: previous.selectedId,
        selectedIds: previous.selectedIds,
        emitDocumentChange: true,
        preserveCamera: true
      });
    } finally {
      this.isRestoringHistory = false;
    }

    return true;
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
    this.recordUndoSnapshot();

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
    const currentDocumentElement = current.toDocumentElement();
    const merged = {
      ...clone(currentDocumentElement),
      ...clone(nextConfig),
      id: this.selectedId,
      type: current.type,
      transform: clone(currentDocumentElement.transform)
    };

    const normalized = sanitizeElementConfig(merged);
    normalized.id = this.selectedId;
    normalized.transform = merged.transform;

    if (JSON.stringify(currentDocumentElement) === JSON.stringify(normalized)) {
      return normalized;
    }

    this.recordUndoSnapshot();

    current.update(normalized);
    this.refreshSelectionVisualization();
    this.emitDocumentChange();
    this.app.renderFrame();
    return normalized;
  }

  getSelectedIds() {
    return Array.from(this.selectedIds);
  }

  setSelectedIds(elementIds, { activeId = null, emitSelection = true } = {}) {
    this.endTransformDragSession();

    const normalizedIds = [];
    const seen = new Set();

    for (const elementId of elementIds ?? []) {
      if (!elementId || !this.elements.has(elementId) || seen.has(elementId)) {
        continue;
      }
      seen.add(elementId);
      normalizedIds.push(elementId);
    }

    let nextSelectedId = activeId && seen.has(activeId) ? activeId : null;
    if (!nextSelectedId) {
      nextSelectedId = normalizedIds[normalizedIds.length - 1] ?? null;
    }

    this.selectedIds = new Set(normalizedIds);
    this.selectedId = nextSelectedId;

    this.refreshSelectionVisualization();

    if (emitSelection) {
      this.emitSelectionChange();
    }

    this.app.renderFrame();
  }

  selectElement(elementId, { emitSelection = true } = {}) {
    if (elementId && !this.elements.has(elementId)) {
      this.setSelectedIds([], { emitSelection });
      return;
    }

    const nextIds = elementId ? [elementId] : [];
    this.setSelectedIds(nextIds, { activeId: elementId, emitSelection });
  }

  toggleElementSelection(elementId, { emitSelection = true } = {}) {
    if (!elementId || !this.elements.has(elementId)) {
      return;
    }

    const nextIds = this.getSelectedIds();
    const existingIndex = nextIds.indexOf(elementId);
    let nextSelectedId = this.selectedId;

    if (existingIndex >= 0) {
      nextIds.splice(existingIndex, 1);
      if (nextSelectedId === elementId) {
        nextSelectedId = nextIds[nextIds.length - 1] ?? null;
      }
    } else {
      nextIds.push(elementId);
      nextSelectedId = elementId;
    }

    this.setSelectedIds(nextIds, { activeId: nextSelectedId, emitSelection });
  }

  disposeSelectionHelpers() {
    for (const helper of this.selectionHelpers) {
      this.app.scene.remove(helper);
      helper.geometry?.dispose();
      helper.material?.dispose();
    }
    this.selectionHelpers = [];
  }

  updateSelectionHelpers() {
    for (const helper of this.selectionHelpers) {
      helper.update();
    }
  }

  refreshSelectionVisualization() {
    this.disposeSelectionHelpers();

    const selectedIds = this.getSelectedIds();
    if (selectedIds.length === 0) {
      this.transformControls.detach();
      this.curveHandle.visible = false;
      this.kernelHandle.visible = false;
      return;
    }

    for (const elementId of selectedIds) {
      const element = this.elements.get(elementId);
      if (!element) {
        continue;
      }

      const helperColor = elementId === this.selectedId ? 0x9cd8ff : 0x6ea4c7;
      const helper = new THREE.BoxHelper(element.group, helperColor);
      this.selectionHelpers.push(helper);
      this.app.add(helper);
    }

    const selected = this.getSelectedElement();
    if (!selected) {
      this.transformControls.detach();
      this.curveHandle.visible = false;
      this.kernelHandle.visible = false;
      return;
    }

    const isSingleSelection = selectedIds.length === 1;
    if (isSingleSelection && this.kernelHandleEnabled && this.attachKernelHandle(selected)) {
      this.detachCurveHandle();
    } else if (isSingleSelection && this.curveHandleEnabled && selected.isCurved && selected.isCurved()) {
      this.detachKernelHandle();
      this.attachCurveHandle(selected);
    } else {
      this.detachCurveHandle();
      this.detachKernelHandle();
      this.transformControls.attach(selected.group);
      this.transformControls.setSpace("world");
      this.transformControls.setMode(this.transformMode);
      this.updateTransformAxisVisibility();
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
    this.transformControls.setSpace("world");
    this.transformControls.setMode("translate");
    this.updateTransformAxisVisibility();
  }

  detachCurveHandle() {
    this.curveHandle.visible = false;
  }

  buildKernelPlacementOption(metadata) {
    const sourceElement = this.elements.get(metadata.sourceId);
    if (!sourceElement) {
      return null;
    }

    const outputElement = this.elements.get(metadata.outputId);
    const sourceName = sourceElement.config?.name || metadata.sourceId;
    const outputName = outputElement?.config?.name || metadata.outputId;
    const branchOrder = sourceElement.config?.data?.convolution?.branchOrder ?? 0;
    const outputSuffix =
      metadata.outputId && metadata.outputId !== metadata.sourceId ? ` -> ${outputName}` : "";

    return {
      value: metadata.sourceId,
      label: `${sourceName}${outputSuffix} (${metadata.sourceId})`,
      sourceId: metadata.sourceId,
      parentId: metadata.parentId,
      outputId: metadata.outputId,
      branchOrder
    };
  }

  getKernelPlacementOptions(elementId = this.selectedId) {
    if (!elementId || !this.elements.has(elementId)) {
      return [];
    }

    const element = this.elements.get(elementId);
    if (!element || element.type !== "tensor") {
      return [];
    }

    const optionBySourceId = new Map();
    const directMetadata = this.tensorRelationOverlay.getKernelRelationMetadata(elementId);
    if (directMetadata) {
      const option = this.buildKernelPlacementOption(directMetadata);
      if (option) {
        optionBySourceId.set(option.sourceId, option);
      }
    }

    const childMetadata = this.tensorRelationOverlay.getKernelRelationMetadataByParent(elementId);
    for (const metadata of childMetadata) {
      const option = this.buildKernelPlacementOption(metadata);
      if (option) {
        optionBySourceId.set(option.sourceId, option);
      }
    }

    return Array.from(optionBySourceId.values()).sort((left, right) => {
      if (left.branchOrder !== right.branchOrder) {
        return left.branchOrder - right.branchOrder;
      }
      return left.label.localeCompare(right.label);
    });
  }

  setKernelHandleTargetSourceId(sourceId) {
    const nextSourceId =
      typeof sourceId === "string" && sourceId.trim().length > 0 ? sourceId.trim() : null;
    if (nextSourceId === this.kernelHandleTargetSourceId) {
      return;
    }

    this.kernelHandleTargetSourceId = nextSourceId;
    if (this.kernelHandleEnabled) {
      this.refreshSelectionVisualization();
    }
  }

  resolveKernelHandleSourceId(tensorElement) {
    if (!tensorElement || tensorElement.type !== "tensor") {
      return null;
    }

    const selectedId = tensorElement.id;
    if (typeof this.kernelHandleTargetSourceId === "string" && this.kernelHandleTargetSourceId.length > 0) {
      const targetedMetadata = this.tensorRelationOverlay.getKernelRelationMetadata(this.kernelHandleTargetSourceId);
      if (
        targetedMetadata &&
        (targetedMetadata.sourceId === selectedId ||
          targetedMetadata.parentId === selectedId ||
          targetedMetadata.outputId === selectedId)
      ) {
        return targetedMetadata.sourceId;
      }
    }

    const directMetadata = this.tensorRelationOverlay.getKernelRelationMetadata(selectedId);
    if (directMetadata) {
      return directMetadata.sourceId;
    }

    const options = this.getKernelPlacementOptions(selectedId);
    if (options.length === 1) {
      return options[0].sourceId;
    }

    return null;
  }

  syncKernelHandlePlacement(tensorElement) {
    const sourceId = this.resolveKernelHandleSourceId(tensorElement);
    if (!sourceId) {
      return false;
    }

    const metadata = this.tensorRelationOverlay.getKernelRelationMetadata(sourceId);
    if (!metadata) {
      return false;
    }

    const parentElement = this.elements.get(metadata.parentId);
    if (!parentElement) {
      return false;
    }

    const kernelWorld = parentElement.group.localToWorld(metadata.kernelCenterLocal.clone());
    const parentQuaternion = parentElement.group.getWorldQuaternion(new THREE.Quaternion());
    this.kernelHandle.position.copy(kernelWorld);
    this.kernelHandle.quaternion.copy(parentQuaternion);
    this.kernelHandle.userData.kernelSourceId = sourceId;
    this.kernelHandleTargetSourceId = sourceId;
    return true;
  }

  attachKernelHandle(tensorElement) {
    if (!this.syncKernelHandlePlacement(tensorElement)) {
      return false;
    }

    this.kernelHandle.visible = true;
    this.transformControls.attach(this.kernelHandle);
    this.transformControls.setSpace("local");
    this.transformControls.setMode("translate");
    this.updateTransformAxisVisibility();
    return true;
  }

  detachKernelHandle() {
    this.kernelHandle.visible = false;
    delete this.kernelHandle.userData.kernelSourceId;
  }

  setCurveHandleEnabled(enabled) {
    this.curveHandleEnabled = enabled;
    if (enabled) {
      this.kernelHandleEnabled = false;
    }
    this.refreshSelectionVisualization();
  }

  setKernelHandleEnabled(enabled) {
    this.kernelHandleEnabled = enabled;
    if (enabled) {
      this.curveHandleEnabled = false;
    }
    this.refreshSelectionVisualization();
  }

  setTransformMode(mode) {
    this.transformMode = mode === "rotate" ? "rotate" : "translate";

    const hasSingleSelection = this.getSelectedIds().length === 1;
    if (!(hasSingleSelection && this.curveHandleEnabled && this.getSelectedElement()?.isCurved?.())) {
      this.transformControls.setMode(this.transformMode);
    }

    this.updateTransformAxisVisibility();
  }

  getViewPlane() {
    return this.activePlane;
  }

  setViewPlane(planeName) {
    const normalizedPlane =
      typeof planeName === "string" ? planeName.trim().toUpperCase() : null;

    if (!normalizedPlane || !VIEW_PLANE_PRESETS[normalizedPlane]) {
      this.clearViewPlane();
      return this.activePlane;
    }

    if (!this.saved3DView) {
      this.saved3DView = {
        cameraPosition: this.app.camera.position.clone(),
        cameraUp: this.app.camera.up.clone(),
        target: this.app.controls.target.clone(),
        controlsEnableRotate: this.app.controls.enableRotate
      };
    }

    this.activePlane = normalizedPlane;
    const preset = VIEW_PLANE_PRESETS[this.activePlane];
    this.alignCameraToDirection(preset.direction, preset.up);
    this.app.controls.enableRotate = false;
    this.updateTransformAxisVisibility();
    this.endTransformDragSession();
    this.app.renderFrame();
    return this.activePlane;
  }

  clearViewPlane() {
    if (!this.activePlane && !this.saved3DView) {
      return;
    }

    this.activePlane = null;

    if (this.saved3DView) {
      this.app.camera.position.copy(this.saved3DView.cameraPosition);
      this.app.camera.up.copy(this.saved3DView.cameraUp);
      this.app.controls.target.copy(this.saved3DView.target);
      this.app.controls.enableRotate = this.saved3DView.controlsEnableRotate;
      this.saved3DView = null;
    } else {
      this.app.controls.enableRotate = true;
    }

    this.updateTransformAxisVisibility();
    this.endTransformDragSession();
    this.app.controls.update();
    this.app.renderFrame();
  }

  alignViewToAxis(axisName) {
    const normalizedAxis =
      typeof axisName === "string" ? axisName.trim().toUpperCase() : null;
    const preset = normalizedAxis ? VIEW_AXIS_PRESETS[normalizedAxis] : null;

    if (!preset) {
      return false;
    }

    if (this.activePlane) {
      this.clearViewPlane();
    }

    this.alignCameraToDirection(preset.direction, preset.up);
    this.app.renderFrame();
    return true;
  }

  alignCameraToDirection(directionValues, upValues) {
    const target = this.app.controls.target.clone();
    const direction = toVector3(directionValues).normalize();
    const distance = Math.max(20, this.app.camera.position.distanceTo(target));

    this.app.camera.position.copy(target).add(direction.multiplyScalar(distance));
    this.app.camera.up.copy(toVector3(upValues).normalize());
    this.app.camera.lookAt(target);
    this.app.controls.update();
  }

  handleRotateAxisPointerDown(event, axis) {
    const now = performance.now();
    const isNativeDoubleClick = event.detail >= 2;
    const isTimedDoubleClick =
      this.lastRotateAxisPointerDown.axis === axis &&
      now - this.lastRotateAxisPointerDown.at <= ROTATE_DOUBLE_CLICK_WINDOW_MS;

    this.lastRotateAxisPointerDown.axis = axis;
    this.lastRotateAxisPointerDown.at = now;

    if (!(isNativeDoubleClick || isTimedDoubleClick)) {
      return;
    }

    this.snapSelectedRotationToAxis(axis);
  }

  snapSelectedRotationToAxis(axis) {
    const selected = this.getSelectedElement();
    if (!selected || this.transformControls.object !== selected.group) {
      return false;
    }

    const axisKey = axis.toLowerCase();
    const currentAngle = selected.group.rotation[axisKey];
    const snappedAngle = snapAngleToRightAngle(currentAngle);

    if (Math.abs(snappedAngle - currentAngle) <= 1e-6) {
      return false;
    }

    this.recordUndoSnapshot();

    selected.group.rotation[axisKey] = snappedAngle;
    selected.syncTransformFromGroup();

    this.updateSelectionHelpers();

    this.emitDocumentChange();
    this.emitSelectionChange();
    this.app.renderFrame();
    return true;
  }

  handleTransformDraggingChanged(isDragging) {
    if (!isDragging) {
      this.transformUndoCaptured = false;
      this.endTransformDragSession();
      return;
    }

    this.transformUndoCaptured = false;

    if (this.transformControls.getMode() !== "translate") {
      return;
    }

    const selected = this.getSelectedElement();
    if (!selected || this.transformControls.object !== selected.group) {
      return;
    }

    this.beginTransformDragSession(selected);
  }

  beginTransformDragSession(selected) {
    const selectedIds = this.getSelectedIds();
    const selectedIdSet = new Set(selectedIds);
    const lockedAxis = this.getLockedAxisForPlane();
    this.dragSession = {
      selectedId: selected.id,
      selectedIds,
      linkedIds: selectedIds.filter((elementId) => elementId !== selected.id),
      lastPrimaryPosition: selected.group.position.clone(),
      lockedAxis,
      lockedAxisValue: lockedAxis ? selected.group.position[lockedAxis] : null,
      otherAnchors: this.collectAlignmentAnchors(selectedIdSet)
    };
    this.clearAlignmentGuides();
  }

  endTransformDragSession() {
    this.dragSession = null;
    this.clearAlignmentGuides();
  }

  getLockedAxisForPlane() {
    if (!this.activePlane) {
      return null;
    }

    return VIEW_PLANE_PRESETS[this.activePlane]?.lockedAxis ?? null;
  }

  updateTransformAxisVisibility() {
    if (this.transformControls.object === this.kernelHandle && this.kernelHandleEnabled) {
      this.transformControls.showX = false;
      this.transformControls.showY = true;
      this.transformControls.showZ = true;
      return;
    }

    const lockedAxis = this.getLockedAxisForPlane();
    this.transformControls.showX = lockedAxis !== "x";
    this.transformControls.showY = lockedAxis !== "y";
    this.transformControls.showZ = lockedAxis !== "z";
  }

  collectAlignmentAnchors(excludedIds = new Set()) {
    const excluded =
      excludedIds instanceof Set ? excludedIds : new Set(excludedIds ? [excludedIds] : []);
    const anchors = {
      x: [],
      y: [],
      z: []
    };

    for (const [elementId, element] of this.elements.entries()) {
      if (excluded.has(elementId)) {
        continue;
      }

      const snapshot = this.getBoundsSnapshot(element.group);
      if (!snapshot) {
        continue;
      }

      for (const axisKey of AXIS_KEYS) {
        for (const type of ANCHOR_TYPES) {
          anchors[axisKey].push({
            elementId,
            type,
            value: snapshot[type][axisKey],
            point: this.createAnchorPoint(snapshot, axisKey, type)
          });
        }
      }
    }

    return anchors;
  }

  getBoundsSnapshot(object) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) {
      return null;
    }

    const center = box.getCenter(new THREE.Vector3());
    return {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      center: { x: center.x, y: center.y, z: center.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z }
    };
  }

  createAnchorPoint(snapshot, axisKey, type) {
    const point = new THREE.Vector3(snapshot.center.x, snapshot.center.y, snapshot.center.z);
    point[axisKey] = snapshot[type][axisKey];
    return point;
  }

  shiftSnapshotAlongAxis(snapshot, axisKey, delta) {
    for (const type of ANCHOR_TYPES) {
      snapshot[type][axisKey] += delta;
    }
  }

  resolveActiveTranslateAxes() {
    const axes = new Set();
    const transformAxis = this.transformControls.axis;

    if (typeof transformAxis !== "string" || transformAxis === "XYZ") {
      axes.add("x");
      axes.add("y");
      axes.add("z");
    } else {
      if (transformAxis.includes("X")) {
        axes.add("x");
      }
      if (transformAxis.includes("Y")) {
        axes.add("y");
      }
      if (transformAxis.includes("Z")) {
        axes.add("z");
      }
    }

    const lockedAxis = this.dragSession?.lockedAxis;
    if (lockedAxis) {
      axes.delete(lockedAxis);
    }

    return axes;
  }

  findBestAxisAlignment(axisKey, snapshot, axisAnchors) {
    if (!axisAnchors || axisAnchors.length === 0) {
      return null;
    }

    const sources = [
      { type: "min", value: snapshot.min[axisKey] },
      { type: "center", value: snapshot.center[axisKey] },
      { type: "max", value: snapshot.max[axisKey] }
    ];

    let best = null;

    for (const source of sources) {
      for (const target of axisAnchors) {
        const delta = target.value - source.value;
        const distance = Math.abs(delta);

        if (distance > this.alignmentSnapThreshold) {
          continue;
        }

        const centerPriority =
          source.type === "center" || target.type === "center" ? 0 : 1;

        if (
          !best ||
          distance < best.distance - 1e-6 ||
          (Math.abs(distance - best.distance) <= 1e-6 &&
            centerPriority < best.centerPriority)
        ) {
          best = {
            delta,
            distance,
            centerPriority,
            selectedType: source.type,
            target
          };
        }
      }
    }

    return best;
  }

  applyTranslationAlignment(selected) {
    if (!this.dragSession || this.dragSession.selectedId !== selected.id) {
      this.clearAlignmentGuides();
      return;
    }

    const snapshot = this.getBoundsSnapshot(selected.group);
    if (!snapshot) {
      this.clearAlignmentGuides();
      return;
    }

    const activeAxes = this.resolveActiveTranslateAxes();
    const guides = [];

    for (const axisKey of AXIS_KEYS) {
      if (!activeAxes.has(axisKey)) {
        continue;
      }

      const match = this.findBestAxisAlignment(
        axisKey,
        snapshot,
        this.dragSession.otherAnchors[axisKey]
      );

      if (!match) {
        continue;
      }

      selected.group.position[axisKey] += match.delta;
      this.shiftSnapshotAlongAxis(snapshot, axisKey, match.delta);

      guides.push({
        type: match.selectedType,
        start: match.target.point,
        end: this.createAnchorPoint(snapshot, axisKey, match.selectedType)
      });
    }

    if (this.dragSession.lockedAxis) {
      const axisKey = this.dragSession.lockedAxis;
      const delta = this.dragSession.lockedAxisValue - selected.group.position[axisKey];
      if (Math.abs(delta) > 1e-9) {
        selected.group.position[axisKey] = this.dragSession.lockedAxisValue;
        this.shiftSnapshotAlongAxis(snapshot, axisKey, delta);
      }
    }

    this.updateAlignmentGuides(guides);
  }

  updateAlignmentGuides(guides) {
    this.clearAlignmentGuides();

    if (!guides.length) {
      return;
    }

    for (const guide of guides) {
      const material = new THREE.LineDashedMaterial({
        color: guide.type === "center" ? 0xffe08d : 0x8dd6ff,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        dashSize: 1.4,
        gapSize: 0.75
      });
      const geometry = new THREE.BufferGeometry().setFromPoints([guide.start, guide.end]);
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      line.renderOrder = 1200;
      line.frustumCulled = false;
      this.alignmentGuidesGroup.add(line);
    }

    this.alignmentGuidesGroup.visible = true;
  }

  clearAlignmentGuides() {
    while (this.alignmentGuidesGroup.children.length > 0) {
      const child = this.alignmentGuidesGroup.children[0];
      this.alignmentGuidesGroup.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
    this.alignmentGuidesGroup.visible = false;
  }

  applyDeltaToLinkedSelection(delta, selectedId) {
    if (!this.dragSession || !Array.isArray(this.dragSession.linkedIds)) {
      return;
    }
    if (delta.lengthSq() <= 1e-12) {
      return;
    }

    for (const elementId of this.dragSession.linkedIds) {
      if (elementId === selectedId) {
        continue;
      }
      const element = this.elements.get(elementId);
      if (!element) {
        continue;
      }
      element.group.position.add(delta);
      element.syncTransformFromGroup();
    }
  }

  duplicateSelected() {
    const selectedIds = this.getSelectedIds();
    if (selectedIds.length === 0) {
      return null;
    }

    this.recordUndoSnapshot();

    const duplicatedIds = [];
    for (const elementId of selectedIds) {
      const selected = this.elements.get(elementId);
      if (!selected) {
        continue;
      }
      const duplicated = duplicateElementConfig(selected.toDocumentElement());
      const duplicatedId = this.addElementInstance(duplicated, {
        select: false,
        emitDocumentChange: false
      });
      if (duplicatedId) {
        duplicatedIds.push(duplicatedId);
      }
    }

    if (duplicatedIds.length === 0) {
      return null;
    }

    const activeId = duplicatedIds[duplicatedIds.length - 1];
    this.setSelectedIds(duplicatedIds, { activeId, emitSelection: true });
    this.emitDocumentChange();
    this.app.renderFrame();
    return activeId;
  }

  deleteSelectedElement() {
    const selectedIds = this.getSelectedIds().filter((elementId) => this.elements.has(elementId));
    if (selectedIds.length === 0) {
      return false;
    }

    this.recordUndoSnapshot();

    for (const targetId of selectedIds) {
      const targetElement = this.elements.get(targetId);
      if (!targetElement) {
        continue;
      }
      targetElement.dispose();
      this.elements.delete(targetId);
    }

    this.setSelectedIds([], { emitSelection: true });
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

    if (this.isDraggingTransform && !this.transformUndoCaptured) {
      const isCurveHandleDrag =
        attachedObject === this.curveHandle && this.curveHandleEnabled && selected.isCurved?.();
      const isElementDrag = attachedObject === selected.group;
      const isKernelHandleDrag = attachedObject === this.kernelHandle && this.kernelHandleEnabled;

      if (isCurveHandleDrag || isElementDrag || isKernelHandleDrag) {
        this.recordUndoSnapshot();
        this.transformUndoCaptured = true;
      }
    }

    if (attachedObject === this.kernelHandle && this.kernelHandleEnabled) {
      if (this.updateKernelOffsetFromHandle()) {
        this.updateSelectionHelpers();
        this.emitDocumentChange();
        this.emitSelectionChange();
      }
      return;
    }

    if (attachedObject === this.curveHandle && this.curveHandleEnabled && selected.isCurved?.()) {
      selected.setControlPointFromWorld(this.curveHandle.getWorldPosition(new THREE.Vector3()));
      this.curveHandle.position.copy(selected.getControlPointWorld());
      this.updateSelectionHelpers();
      this.emitDocumentChange();
      this.emitSelectionChange();
      return;
    }

    if (attachedObject === selected.group) {
      if (this.transformControls.getMode() === "translate") {
        if (this.dragSession?.selectedId === selected.id) {
          const previousPrimaryPosition =
            this.dragSession.lastPrimaryPosition ?? selected.group.position.clone();
          const dragDelta = selected.group.position.clone().sub(previousPrimaryPosition);
          this.applyDeltaToLinkedSelection(dragDelta, selected.id);
        }

        const preAlignmentPosition = selected.group.position.clone();
        this.applyTranslationAlignment(selected);
        const alignmentDelta = selected.group.position.clone().sub(preAlignmentPosition);
        this.applyDeltaToLinkedSelection(alignmentDelta, selected.id);

        if (this.dragSession?.selectedId === selected.id) {
          this.dragSession.lastPrimaryPosition = selected.group.position.clone();
        }
      }

      selected.syncTransformFromGroup();
      this.updateSelectionHelpers();
      this.emitDocumentChange();
      this.emitSelectionChange();
    }
  }

  updateKernelOffsetFromHandle() {
    const sourceId = this.kernelHandle.userData.kernelSourceId;
    if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
      return false;
    }

    const metadata = this.tensorRelationOverlay.getKernelRelationMetadata(sourceId);
    if (!metadata) {
      return false;
    }

    const sourceElement = this.elements.get(sourceId);
    if (!sourceElement || sourceElement.type !== "tensor") {
      return false;
    }

    const parentElement = this.elements.get(metadata.parentId);
    if (!parentElement) {
      return false;
    }

    const kernelConfig = sourceElement.config?.data?.convolution?.kernel;
    if (!kernelConfig) {
      return false;
    }

    const handleWorld = this.kernelHandle.getWorldPosition(new THREE.Vector3());
    const local = parentElement.group.worldToLocal(handleWorld.clone());

    const constrainedLocal = metadata.kernelCenterLocal.clone();
    constrainedLocal[metadata.fixedAxis.axis] = metadata.fixedAxis.value;
    constrainedLocal.y = THREE.MathUtils.clamp(local.y, metadata.movementBounds.y.min, metadata.movementBounds.y.max);
    constrainedLocal.z = THREE.MathUtils.clamp(local.z, metadata.movementBounds.z.min, metadata.movementBounds.z.max);

    const nextOffsetY = constrainedLocal.y - metadata.baseKernelCenterLocal.y;
    const nextOffsetZ = constrainedLocal.z - metadata.baseKernelCenterLocal.z;

    const offset = Array.isArray(kernelConfig.offset) && kernelConfig.offset.length === 3
      ? kernelConfig.offset
      : [0, 0, 0];
    offset[0] = 0;
    offset[1] = nextOffsetY;
    offset[2] = nextOffsetZ;
    kernelConfig.offset = offset;

    const constrainedWorld = parentElement.group.localToWorld(constrainedLocal.clone());
    const parentQuaternion = parentElement.group.getWorldQuaternion(new THREE.Quaternion());
    this.kernelHandle.position.copy(constrainedWorld);
    this.kernelHandle.quaternion.copy(parentQuaternion);

    return true;
  }

  setBackground(backgroundColor) {
    if (this.document.scene.background === backgroundColor) {
      return;
    }

    this.recordUndoSnapshot();
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
    crop = null,
    tiled = undefined,
    tileSize = null,
    includeEditorOverlays = false
  } = {}) {
    if (includeEditorOverlays) {
      return this.app.exportRaster({ format, quality, width, height, crop, tiled, tileSize });
    }

    const previousState = {
      transformControlsHelperVisible: this.transformControlsHelper.visible,
      curveHandleVisible: this.curveHandle.visible,
      kernelHandleVisible: this.kernelHandle.visible,
      selectionHelpersVisible: this.selectionHelpers.map((helper) => helper.visible),
      alignmentGuidesVisible: this.alignmentGuidesGroup.visible
    };

    this.transformControlsHelper.visible = false;
    this.curveHandle.visible = false;
    this.kernelHandle.visible = false;
    for (const helper of this.selectionHelpers) {
      helper.visible = false;
    }
    this.alignmentGuidesGroup.visible = false;

    try {
      return this.app.exportRaster({ format, quality, width, height, crop, tiled, tileSize });
    } finally {
      this.transformControlsHelper.visible = previousState.transformControlsHelperVisible;
      this.curveHandle.visible = previousState.curveHandleVisible;
      this.kernelHandle.visible = previousState.kernelHandleVisible;
      for (let index = 0; index < this.selectionHelpers.length; index += 1) {
        const helper = this.selectionHelpers[index];
        const wasVisible = previousState.selectionHelpersVisible[index];
        if (wasVisible != null) {
          helper.visible = wasVisible;
        }
      }
      this.alignmentGuidesGroup.visible = previousState.alignmentGuidesVisible;
      this.app.renderFrame();
    }
  }

  emitSelectionChange() {
    if (!this.onSelectionChange) {
      return;
    }
    this.onSelectionChange(this.getSelectedElementConfig());
  }

  refreshTensorRelationOverlay() {
    if (!this.tensorRelationOverlay) {
      return;
    }
    this.tensorRelationOverlay.rebuild(this.elements);
    if (this.kernelHandleEnabled && this.kernelHandle.visible) {
      const selected = this.getSelectedElement();
      if (!this.syncKernelHandlePlacement(selected)) {
        this.setKernelHandleEnabled(false);
      }
    }
  }

  emitDocumentChange() {
    this.refreshTensorRelationOverlay();
    if (!this.onDocumentChange) {
      return;
    }
    this.onDocumentChange(this.exportDocument());
  }

  emitHistoryChange() {
    if (!this.onHistoryChange) {
      return;
    }
    this.onHistoryChange({
      canUndo: this.canUndo(),
      undoDepth: this.undoStack.length
    });
  }
}
