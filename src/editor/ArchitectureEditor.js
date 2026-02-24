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

const ROTATION_AXIS_SET = new Set(["X", "Y", "Z"]);
const RIGHT_ANGLE_RADIANS = Math.PI * 0.5;
const ROTATE_DOUBLE_CLICK_WINDOW_MS = 340;
const ALIGNMENT_SNAP_THRESHOLD = 2;
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
    this.lastRotateAxisPointerDown = { axis: null, at: 0 };
    this.dragSession = null;
    this.activePlane = null;
    this.saved3DView = null;
    this.alignmentSnapThreshold = ALIGNMENT_SNAP_THRESHOLD;

    this.rootGroup = new THREE.Group();
    this.app.add(this.rootGroup);
    this.alignmentGuidesGroup = new THREE.Group();
    this.alignmentGuidesGroup.visible = false;
    this.app.add(this.alignmentGuidesGroup);

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
      this.handleTransformDraggingChanged(event.value);
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
    this.endTransformDragSession();
    this.clearElements();
    this.transformControls.detach();
    this.app.scene.remove(this.transformControlsHelper);
    this.transformControls.dispose();
    this.app.scene.remove(this.curveHandle);
    this.app.scene.remove(this.alignmentGuidesGroup);
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
    this.endTransformDragSession();
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
    this.clearAlignmentGuides();
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
    this.endTransformDragSession();
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
    this.transformControls.setMode("translate");
    this.updateTransformAxisVisibility();
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

    selected.group.rotation[axisKey] = snappedAngle;
    selected.syncTransformFromGroup();

    if (this.selectionHelper) {
      this.selectionHelper.update();
    }

    this.emitDocumentChange();
    this.emitSelectionChange();
    this.app.renderFrame();
    return true;
  }

  handleTransformDraggingChanged(isDragging) {
    if (!isDragging) {
      this.endTransformDragSession();
      return;
    }

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
    const lockedAxis = this.getLockedAxisForPlane();
    this.dragSession = {
      selectedId: selected.id,
      lockedAxis,
      lockedAxisValue: lockedAxis ? selected.group.position[lockedAxis] : null,
      otherAnchors: this.collectAlignmentAnchors(selected.id)
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
    const lockedAxis = this.getLockedAxisForPlane();
    this.transformControls.showX = lockedAxis !== "x";
    this.transformControls.showY = lockedAxis !== "y";
    this.transformControls.showZ = lockedAxis !== "z";
  }

  collectAlignmentAnchors(excludedId) {
    const anchors = {
      x: [],
      y: [],
      z: []
    };

    for (const [elementId, element] of this.elements.entries()) {
      if (elementId === excludedId) {
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
      if (this.transformControls.getMode() === "translate") {
        this.applyTranslationAlignment(selected);
      }

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
      selectionHelperVisible: this.selectionHelper ? this.selectionHelper.visible : null,
      alignmentGuidesVisible: this.alignmentGuidesGroup.visible
    };

    this.transformControlsHelper.visible = false;
    this.curveHandle.visible = false;
    if (this.selectionHelper) {
      this.selectionHelper.visible = false;
    }
    this.alignmentGuidesGroup.visible = false;

    try {
      return this.app.exportRaster({ format, quality, width, height });
    } finally {
      this.transformControlsHelper.visible = previousState.transformControlsHelperVisible;
      this.curveHandle.visible = previousState.curveHandleVisible;
      if (this.selectionHelper && previousState.selectionHelperVisible != null) {
        this.selectionHelper.visible = previousState.selectionHelperVisible;
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

  emitDocumentChange() {
    if (!this.onDocumentChange) {
      return;
    }
    this.onDocumentChange(this.exportDocument());
  }
}
