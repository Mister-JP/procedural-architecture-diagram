import * as THREE from "three";
import { SceneApp } from "./core/SceneApp.js";
import { ArchitectureEditor } from "./editor/ArchitectureEditor.js";
import { ElementPreview } from "./editor/ElementPreview.js";
import {
  ELEMENT_TYPES,
  createDefaultElement,
  normalizeDocument
} from "./editor/schema.js";
import defaultArchitectureDocument from "./config/default-architecture.json";

const MAX_EXPORT_RESOLUTION = 32768;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function downloadTextFile(content, fileName, mimeType = "application/json") {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function downloadDataUrl(dataUrl, fileName) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function createButton(label, { className = "tool-button", title = "" } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  if (title) {
    button.title = title;
  }
  return button;
}

function normalizeSingleElement(element) {
  return normalizeDocument({ elements: [element] }).elements[0];
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback) {
  return Math.round(toNumber(value, fallback));
}

function clampInteger(value, min, max, fallback = min) {
  const parsed = toInteger(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}

function getTensorChannelCount(tensorData) {
  return Math.max(1, toInteger(tensorData?.dimensions?.channels, 1));
}

function normalizeTensorChannelColorRanges(tensorData) {
  if (!tensorData?.style) {
    return;
  }

  const channelCount = getTensorChannelCount(tensorData);
  const rawRanges = Array.isArray(tensorData.style.channelColorRanges)
    ? tensorData.style.channelColorRanges
    : [];

  tensorData.style.channelColorRanges = rawRanges.map((range) => {
    const lower = clampInteger(range?.minChannel, 1, channelCount, 1);
    const upper = clampInteger(range?.maxChannel, 1, channelCount, channelCount);

    return {
      minChannel: Math.min(lower, upper),
      maxChannel: Math.max(lower, upper),
      color:
        typeof range?.color === "string" && range.color.trim().length > 0
          ? range.color
          : "#2e6cff"
    };
  });
}

function toResolution(value, fallback, min = 64, max = MAX_EXPORT_RESOLUTION) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function setGlobalBackground(color) {
  document.documentElement.style.background = color;
  document.body.style.background = color;
}

function isEditableDomTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function normalizeExportCrop(crop) {
  if (!crop || typeof crop !== "object") {
    return null;
  }

  const parsedX = Number(crop.x);
  const parsedY = Number(crop.y);
  const parsedWidth = Number(crop.width);
  const parsedHeight = Number(crop.height);

  if (
    !Number.isFinite(parsedX) ||
    !Number.isFinite(parsedY) ||
    !Number.isFinite(parsedWidth) ||
    !Number.isFinite(parsedHeight)
  ) {
    return null;
  }

  const x = clamp01(parsedX);
  const y = clamp01(parsedY);
  const width = Math.min(1 - x, Math.max(0, parsedWidth));
  const height = Math.min(1 - y, Math.max(0, parsedHeight));

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function getCanvasViewportRect() {
  return app.renderer.domElement.getBoundingClientRect();
}

function resolveAspectLockedSelectionRect({
  startX,
  startY,
  currentX,
  currentY,
  bounds,
  aspect
}) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const dx = currentX - startX;
  const dy = currentY - startY;
  const signX = dx >= 0 ? 1 : -1;
  const signY = dy >= 0 ? 1 : -1;

  let width = Math.abs(dx);
  let height = Math.abs(dy);

  if (width <= 0 && height <= 0) {
    width = 1;
    height = 1 / safeAspect;
  } else if (width / Math.max(height, 1e-6) > safeAspect) {
    height = width / safeAspect;
  } else {
    width = height * safeAspect;
  }

  const maxWidth = signX > 0 ? bounds.right - startX : startX - bounds.left;
  const maxHeight = signY > 0 ? bounds.bottom - startY : startY - bounds.top;
  const scale = Math.min(1, maxWidth / Math.max(width, 1e-6), maxHeight / Math.max(height, 1e-6));

  width *= scale;
  height *= scale;

  const x = signX > 0 ? startX : startX - width;
  const y = signY > 0 ? startY : startY - height;

  return { x, y, width, height };
}

function drawExportSelectionBox(rect) {
  if (!exportSelectionBox) {
    return;
  }

  if (!rect || rect.width <= 0 || rect.height <= 0) {
    exportSelectionBox.hidden = true;
    return;
  }

  exportSelectionBox.hidden = false;
  exportSelectionBox.style.left = `${rect.x}px`;
  exportSelectionBox.style.top = `${rect.y}px`;
  exportSelectionBox.style.width = `${rect.width}px`;
  exportSelectionBox.style.height = `${rect.height}px`;
}

function updateExportSelectionVisuals() {
  if (!exportSelectionOverlay) {
    return;
  }

  exportSelectionOverlay.classList.toggle("active", uiState.exportSelectionMode);
  if (exportSelectionHint) {
    exportSelectionHint.hidden = !uiState.exportSelectionMode;
  }

  if (exportSelectionDragState?.previewRect) {
    drawExportSelectionBox(exportSelectionDragState.previewRect);
    return;
  }

  const rect = getCanvasViewportRect();
  const crop = uiState.exportCrop;

  if (!crop) {
    drawExportSelectionBox(null);
    return;
  }

  drawExportSelectionBox({
    x: rect.left + crop.x * rect.width,
    y: rect.top + crop.y * rect.height,
    width: crop.width * rect.width,
    height: crop.height * rect.height
  });
}

function updateExportRegionUi() {
  if (!exportRegionStatus) {
    return;
  }

  if (uiState.exportCrop) {
    const widthPercent = Math.round(uiState.exportCrop.width * 100);
    const heightPercent = Math.round(uiState.exportCrop.height * 100);
    const cropAspect = uiState.exportCrop.width / Math.max(1e-6, uiState.exportCrop.height);
    const exportAspect = uiState.exportResolution.width / Math.max(1, uiState.exportResolution.height);
    const aspectDelta = Math.abs(cropAspect - exportAspect) / Math.max(cropAspect, exportAspect, 1e-6);
    exportRegionStatus.textContent =
      aspectDelta > 0.02
        ? `Selected (${widthPercent}% x ${heightPercent}%) - reselect after aspect change`
        : `Selected (${widthPercent}% x ${heightPercent}%)`;
  } else {
    exportRegionStatus.textContent = "Full camera view";
  }

  if (selectExportRegionButton) {
    selectExportRegionButton.classList.toggle("active", uiState.exportSelectionMode);
    selectExportRegionButton.textContent = uiState.exportSelectionMode
      ? "Cancel Select"
      : "Select Region";
  }

  if (clearExportRegionButton) {
    clearExportRegionButton.disabled = !uiState.exportCrop;
  }
}

function setExportCrop(crop) {
  uiState.exportCrop = normalizeExportCrop(crop);
  updateExportRegionUi();
  updateExportSelectionVisuals();
}

function setExportSelectionMode(enabled) {
  uiState.exportSelectionMode = Boolean(enabled);
  if (!uiState.exportSelectionMode && exportSelectionDragState) {
    if (
      exportSelectionOverlay &&
      Number.isFinite(exportSelectionDragState.pointerId) &&
      exportSelectionOverlay.hasPointerCapture(exportSelectionDragState.pointerId)
    ) {
      exportSelectionOverlay.releasePointerCapture(exportSelectionDragState.pointerId);
    }
    exportSelectionDragState = null;
  }
  updateExportRegionUi();
  updateExportSelectionVisuals();
}

const startingDocument = normalizeDocument(defaultArchitectureDocument);
const initialCameraPosition = startingDocument.scene.cameraPosition;

const app = new SceneApp({
  background: startingDocument.scene.background,
  cameraPosition: new THREE.Vector3(
    initialCameraPosition[0],
    initialCameraPosition[1],
    initialCameraPosition[2]
  )
});

setGlobalBackground(startingDocument.scene.background);

const initialExportResolution = {
  width: Math.max(64, Math.round(window.innerWidth)),
  height: Math.max(64, Math.round(window.innerHeight))
};

const uiState = {
  inspectorMode: "create",
  draftElement: createDefaultElement(ELEMENT_TYPES.tensor),
  selectedElement: null,
  holdCreateModeOnNextSelection: false,
  curveHandleEnabled: false,
  kernelHandleEnabled: false,
  kernelHandleTargetSourceId: null,
  latestDocument: clone(startingDocument),
  exportResolution: initialExportResolution,
  exportCrop: null,
  exportSelectionMode: false
};

let duplicateButton;
let undoButton;
let moveModeButton;
let rotateModeButton;
let curveHandleStatus;
let rightPanel;
let rightPanelShowButton;
let inspectorTitle;
let inspectorSubtitle;
let inspectorFields;
let inspectorActionButton;
let inspectorDeleteButton;
let preview;
let importInput;
let backgroundInput;
let viewModeStatus;
let viewPlaneButtons = {};
let exportRegionStatus;
let selectExportRegionButton;
let clearExportRegionButton;
let exportSelectionOverlay;
let exportSelectionBox;
let exportSelectionHint;
let exportSelectionDragState = null;

function applyTransformModeButtonState(mode) {
  const isMove = mode === "translate";
  moveModeButton.classList.toggle("active", isMove);
  rotateModeButton.classList.toggle("active", !isMove);
}

function applyUndoButtonState(editor) {
  if (!undoButton) {
    return;
  }
  undoButton.disabled = !editor.canUndo();
}

function syncViewPlaneControls(editor) {
  const activePlane = editor.getViewPlane();

  for (const [plane, button] of Object.entries(viewPlaneButtons)) {
    button.classList.toggle("active", activePlane === plane);
  }

  if (viewModeStatus) {
    viewModeStatus.textContent = activePlane ? `${activePlane} plane` : "3D free";
  }
}

function disableCurveHandleEditing(editor) {
  uiState.curveHandleEnabled = false;
  uiState.kernelHandleEnabled = false;
  uiState.kernelHandleTargetSourceId = null;
  editor.setCurveHandleEnabled(false);
  editor.setKernelHandleEnabled(false);
  editor.setKernelHandleTargetSourceId(null);
  if (curveHandleStatus) {
    curveHandleStatus.textContent = "Direct handle: Off";
  }
}

function syncKernelHandleTargetSelection(editor, tensorId) {
  const options = editor.getKernelPlacementOptions(tensorId);
  const optionIds = new Set(options.map((option) => option.value));
  let targetSourceId = uiState.kernelHandleTargetSourceId;

  if (!targetSourceId || !optionIds.has(targetSourceId)) {
    targetSourceId = options.length === 1 ? options[0].value : null;
  }

  uiState.kernelHandleTargetSourceId = targetSourceId;
  editor.setKernelHandleTargetSourceId(targetSourceId);

  return {
    options,
    targetSourceId
  };
}

function syncDirectHandleStatus(editor) {
  if (!curveHandleStatus) {
    return;
  }

  const isEdit = uiState.inspectorMode === "edit";
  const isArrow = isEdit && uiState.draftElement.type === ELEMENT_TYPES.arrow;
  const isTensor = isEdit && uiState.draftElement.type === ELEMENT_TYPES.tensor;
  const kernelPlacement = isTensor
    ? syncKernelHandleTargetSelection(editor, uiState.draftElement.id)
    : { options: [], targetSourceId: null };
  const canMoveKernel = isTensor && kernelPlacement.options.length > 0;

  curveHandleStatus.hidden = !(isArrow || canMoveKernel);

  if (isArrow) {
    curveHandleStatus.textContent = uiState.curveHandleEnabled ? "Curve handle: On" : "Curve handle: Off";
    return;
  }

  if (canMoveKernel) {
    const selectedKernelOption = kernelPlacement.options.find(
      (option) => option.value === kernelPlacement.targetSourceId
    );
    const selectedKernelSuffix = selectedKernelOption ? ` (${selectedKernelOption.label})` : "";
    curveHandleStatus.textContent = uiState.kernelHandleEnabled
      ? `Kernel handle: On${selectedKernelSuffix}`
      : `Kernel handle: Off${selectedKernelSuffix}`;
  }
}

function setDraftElement(nextElement) {
  uiState.draftElement = normalizeSingleElement(nextElement);
  preview.setElementConfig(uiState.draftElement);
}

function openCreateInspector(type, editor) {
  disableCurveHandleEditing(editor);
  uiState.inspectorMode = "create";
  const draft = createDefaultElement(type);
  draft.transform.position = editor.getInsertionPosition(false);
  draft.transform.rotation = [0, 0, 0];
  setDraftElement(draft);
  renderInspector(editor);
  showRightPanel();
}

function openEditInspector(elementConfig, editor, { preserveHandles = false } = {}) {
  if (!preserveHandles) {
    disableCurveHandleEditing(editor);
  }
  uiState.inspectorMode = "edit";
  setDraftElement(clone(elementConfig));
  if (elementConfig?.type === ELEMENT_TYPES.tensor) {
    syncKernelHandleTargetSelection(editor, elementConfig.id);
  }
  renderInspector(editor);
  showRightPanel();
}

function createFieldRow(labelText) {
  const row = document.createElement("label");
  row.className = "field-row";

  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = labelText;
  row.appendChild(label);

  return row;
}

function addTextField(container, { label, value, onInput, placeholder = "" }) {
  const row = createFieldRow(label);
  const input = document.createElement("input");
  input.className = "field-input";
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));
  row.appendChild(input);
  container.appendChild(row);
  return input;
}

function addReadOnlyField(container, { label, value }) {
  const row = createFieldRow(label);
  const input = document.createElement("input");
  input.className = "field-input";
  input.type = "text";
  input.value = value;
  input.readOnly = true;
  row.appendChild(input);
  container.appendChild(row);
  return input;
}

function addNumberField(
  container,
  { label, value, min = null, max = null, step = 1, onInput, integer = false }
) {
  const row = createFieldRow(label);
  const input = document.createElement("input");
  input.className = "field-input";
  input.type = "number";
  if (Number.isFinite(min)) {
    input.min = String(min);
  }
  if (Number.isFinite(max)) {
    input.max = String(max);
  }
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    const parsed = toNumber(input.value, value);
    onInput(integer ? Math.round(parsed) : parsed);
  });
  row.appendChild(input);
  container.appendChild(row);
  return input;
}

function addColorField(container, { label, value, onInput }) {
  const row = createFieldRow(label);
  const input = document.createElement("input");
  input.className = "field-input color-input";
  input.type = "color";
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  row.appendChild(input);
  container.appendChild(row);
  return input;
}

function addSelectField(container, { label, value, options, onInput }) {
  const row = createFieldRow(label);
  const input = document.createElement("select");
  input.className = "field-input";

  for (const optionData of options) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    input.appendChild(option);
  }

  input.value = value;
  input.addEventListener("change", () => onInput(input.value));

  row.appendChild(input);
  container.appendChild(row);
  return input;
}

function addToggleField(container, { label, value, onInput }) {
  const row = createFieldRow(label);
  row.classList.add("toggle-row");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(value);
  input.addEventListener("change", () => onInput(input.checked));
  row.appendChild(input);
  container.appendChild(row);
  return input;
}

function addRangeField(container, { label, value, min, max, step, suffix = "", onInput }) {
  const row = createFieldRow(label);
  row.classList.add("range-row");

  const range = document.createElement("input");
  range.className = "field-input range-input";
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);

  const valueChip = document.createElement("span");
  valueChip.className = "range-value";
  valueChip.textContent = `${Math.round(value * 100) / 100}${suffix}`;

  range.addEventListener("input", () => {
    const parsed = toNumber(range.value, value);
    valueChip.textContent = `${Math.round(parsed * 100) / 100}${suffix}`;
    onInput(parsed);
  });

  row.append(range, valueChip);
  container.appendChild(row);
  return range;
}

function addIntegerRangeField(container, { label, value, min, max, onInput }) {
  const row = createFieldRow(label);
  row.classList.add("range-row");

  const resolveMin = typeof min === "function" ? min : () => min;
  const resolveMax = typeof max === "function" ? max : () => max;

  const range = document.createElement("input");
  range.className = "field-input range-input";
  range.type = "range";
  range.step = "1";

  const valueChip = document.createElement("span");
  valueChip.className = "range-value";

  const applyValue = (rawValue, shouldEmit = true) => {
    const resolvedMin = toInteger(resolveMin(), 1);
    const resolvedMax = Math.max(resolvedMin, toInteger(resolveMax(), resolvedMin));
    const nextValue = clampInteger(rawValue, resolvedMin, resolvedMax, value);

    range.min = String(resolvedMin);
    range.max = String(resolvedMax);
    range.value = String(nextValue);
    valueChip.textContent = String(nextValue);

    if (shouldEmit) {
      onInput(nextValue);
    }
  };

  applyValue(value, false);
  range.addEventListener("input", () => applyValue(range.value, true));

  row.append(range, valueChip);
  container.appendChild(row);
  return range;
}

function addSectionTitle(container, title) {
  const heading = document.createElement("h4");
  heading.className = "section-title";
  heading.textContent = title;
  container.appendChild(heading);
}

function syncDraftAndPreview(editor, { applyLiveForEdit = true } = {}) {
  setDraftElement(uiState.draftElement);
  if (applyLiveForEdit && uiState.inspectorMode === "edit") {
    const updated = editor.updateSelectedElement(uiState.draftElement);
    if (updated) {
      uiState.draftElement = clone(updated);
    }
  }
}

function getTensorReferenceOptions({ excludeId = null } = {}) {
  const elements = uiState.latestDocument?.elements ?? [];
  const options = [{ value: "", label: "(None)" }];

  for (const element of elements) {
    if (element.type !== ELEMENT_TYPES.tensor) {
      continue;
    }
    if (excludeId && element.id === excludeId) {
      continue;
    }
    options.push({
      value: element.id,
      label: `${element.name} (${element.id})`
    });
  }

  return options;
}

function withCurrentValueOption(options, value, fallbackLabel = "Custom") {
  if (!value || options.some((option) => option.value === value)) {
    return options;
  }
  return [...options, { value, label: `${fallbackLabel} (${value})` }];
}

function renderTensorInspector(editor) {
  const tensor = uiState.draftElement.data;
  const currentTensorId = uiState.draftElement.id;
  normalizeTensorChannelColorRanges(tensor);

  addSectionTitle(inspectorFields, "Structure");
  addReadOnlyField(inspectorFields, {
    label: "Tensor Id",
    value: currentTensorId
  });
  addNumberField(inspectorFields, {
    label: "Channels (X)",
    value: tensor.dimensions.channels,
    min: 1,
    max: 512,
    step: 1,
    integer: true,
    onInput: (value) => {
      uiState.draftElement.data.dimensions.channels = value;
      normalizeTensorChannelColorRanges(uiState.draftElement.data);
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Height (Y)",
    value: tensor.dimensions.height,
    min: 1,
    max: 512,
    step: 1,
    integer: true,
    onInput: (value) => {
      uiState.draftElement.data.dimensions.height = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Width (Z)",
    value: tensor.dimensions.width,
    min: 1,
    max: 512,
    step: 1,
    integer: true,
    onInput: (value) => {
      uiState.draftElement.data.dimensions.width = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Tensor Scale");
  addNumberField(inspectorFields, {
    label: "Height Unit",
    value: tensor.scale.height,
    min: 0.1,
    max: 80,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.scale.height = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Width Unit",
    value: tensor.scale.width,
    min: 0.1,
    max: 80,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.scale.width = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Channel Unit",
    value: tensor.scale.channel,
    min: 0.1,
    max: 80,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.scale.channel = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Appearance");
  addColorField(inspectorFields, {
    label: "Start Color",
    value: tensor.style.startColor,
    onInput: (value) => {
      uiState.draftElement.data.style.startColor = value;
      syncDraftAndPreview(editor);
    }
  });
  addColorField(inspectorFields, {
    label: "End Color",
    value: tensor.style.endColor,
    onInput: (value) => {
      uiState.draftElement.data.style.endColor = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Channel Axis Colors");
  const getChannelCount = () => getTensorChannelCount(uiState.draftElement.data);
  const channelColorRanges = tensor.style.channelColorRanges;

  for (let index = 0; index < channelColorRanges.length; index += 1) {
    addColorField(inspectorFields, {
      label: `Range ${index + 1} Color`,
      value: channelColorRanges[index].color,
      onInput: (value) => {
        const currentRange = uiState.draftElement.data.style.channelColorRanges[index];
        if (!currentRange) {
          return;
        }
        currentRange.color = value;
        syncDraftAndPreview(editor);
      }
    });

    addIntegerRangeField(inspectorFields, {
      label: `Range ${index + 1} Min`,
      value: channelColorRanges[index].minChannel,
      min: 1,
      max: () => {
        const currentRange = uiState.draftElement.data.style.channelColorRanges[index];
        return currentRange ? Math.min(getChannelCount(), currentRange.maxChannel) : getChannelCount();
      },
      onInput: (value) => {
        const currentRange = uiState.draftElement.data.style.channelColorRanges[index];
        if (!currentRange) {
          return;
        }
        currentRange.minChannel = value;
        normalizeTensorChannelColorRanges(uiState.draftElement.data);
        syncDraftAndPreview(editor);
      }
    });

    addIntegerRangeField(inspectorFields, {
      label: `Range ${index + 1} Max`,
      value: channelColorRanges[index].maxChannel,
      min: () => {
        const currentRange = uiState.draftElement.data.style.channelColorRanges[index];
        return currentRange ? currentRange.minChannel : 1;
      },
      max: () => getChannelCount(),
      onInput: (value) => {
        const currentRange = uiState.draftElement.data.style.channelColorRanges[index];
        if (!currentRange) {
          return;
        }
        currentRange.maxChannel = value;
        normalizeTensorChannelColorRanges(uiState.draftElement.data);
        syncDraftAndPreview(editor);
      }
    });

    const removeRow = createFieldRow(`Range ${index + 1}`);
    const removeButton = createButton("Remove Range", { className: "field-action" });
    removeButton.addEventListener("click", () => {
      uiState.draftElement.data.style.channelColorRanges.splice(index, 1);
      normalizeTensorChannelColorRanges(uiState.draftElement.data);
      syncDraftAndPreview(editor);
      renderInspector(editor);
    });
    removeRow.appendChild(removeButton);
    inspectorFields.appendChild(removeRow);
  }

  const addRangeRow = createFieldRow("Add Range");
  const addRangeButton = createButton("Add Channel Range", { className: "field-action" });
  addRangeButton.addEventListener("click", () => {
    const channelCount = getChannelCount();
    uiState.draftElement.data.style.channelColorRanges.push({
      minChannel: 1,
      maxChannel: channelCount,
      color: "#2e6cff"
    });
    normalizeTensorChannelColorRanges(uiState.draftElement.data);
    syncDraftAndPreview(editor);
    renderInspector(editor);
  });
  addRangeRow.appendChild(addRangeButton);
  inspectorFields.appendChild(addRangeRow);

  addRangeField(inspectorFields, {
    label: "Fill Opacity",
    value: tensor.style.fillOpacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.style.fillOpacity = value;
      syncDraftAndPreview(editor);
    }
  });
  addColorField(inspectorFields, {
    label: "Border Color",
    value: tensor.style.borderColor,
    onInput: (value) => {
      uiState.draftElement.data.style.borderColor = value;
      syncDraftAndPreview(editor);
    }
  });
  addRangeField(inspectorFields, {
    label: "Border Opacity",
    value: tensor.style.borderOpacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.style.borderOpacity = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Shape Labels");
  addToggleField(inspectorFields, {
    label: "Show Labels",
    value: tensor.labels.enabled,
    onInput: (value) => {
      uiState.draftElement.data.labels.enabled = value;
      syncDraftAndPreview(editor);
    }
  });
  addColorField(inspectorFields, {
    label: "Label Text",
    value: tensor.labels.textColor,
    onInput: (value) => {
      uiState.draftElement.data.labels.textColor = value;
      syncDraftAndPreview(editor);
    }
  });
  addRangeField(inspectorFields, {
    label: "Label Opacity",
    value: tensor.labels.textOpacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.labels.textOpacity = value;
      syncDraftAndPreview(editor);
    }
  });
  addColorField(inspectorFields, {
    label: "Label BG",
    value: tensor.labels.backgroundColor,
    onInput: (value) => {
      uiState.draftElement.data.labels.backgroundColor = value;
      syncDraftAndPreview(editor);
    }
  });
  addRangeField(inspectorFields, {
    label: "Label BG Opacity",
    value: tensor.labels.backgroundOpacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.labels.backgroundOpacity = value;
      syncDraftAndPreview(editor);
    }
  });
  addColorField(inspectorFields, {
    label: "Label Border",
    value: tensor.labels.borderColor,
    onInput: (value) => {
      uiState.draftElement.data.labels.borderColor = value;
      syncDraftAndPreview(editor);
    }
  });
  addRangeField(inspectorFields, {
    label: "Label Border Opacity",
    value: tensor.labels.borderOpacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.labels.borderOpacity = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Label Scale",
    value: tensor.labels.scaleHeight,
    min: 0.4,
    max: 30,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.labels.scaleHeight = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Tensor References");
  const parentOptions = withCurrentValueOption(
    getTensorReferenceOptions({ excludeId: currentTensorId }),
    tensor.convolution.parentTensorId,
    "Parent"
  );
  addSelectField(inspectorFields, {
    label: "Parent Tensor",
    value: tensor.convolution.parentTensorId,
    options: parentOptions,
    onInput: (value) => {
      uiState.draftElement.data.convolution.parentTensorId = value;
      syncDraftAndPreview(editor);
    }
  });
  const targetOptions = withCurrentValueOption(
    getTensorReferenceOptions(),
    tensor.convolution.targetTensorId,
    "Target"
  );
  addSelectField(inspectorFields, {
    label: "Pyramid Target",
    value: tensor.convolution.targetTensorId,
    options: targetOptions,
    onInput: (value) => {
      uiState.draftElement.data.convolution.targetTensorId = value;
      syncDraftAndPreview(editor);
    }
  });
  addTextField(inspectorFields, {
    label: "Parent Id (manual)",
    value: tensor.convolution.parentTensorId,
    placeholder: "tensor-id",
    onInput: (value) => {
      uiState.draftElement.data.convolution.parentTensorId = value.trim();
      syncDraftAndPreview(editor);
    }
  });
  addTextField(inspectorFields, {
    label: "Target Id (manual)",
    value: tensor.convolution.targetTensorId,
    placeholder: "tensor-id",
    onInput: (value) => {
      uiState.draftElement.data.convolution.targetTensorId = value.trim();
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Branch Order",
    value: tensor.convolution.branchOrder,
    min: 0,
    max: 24,
    step: 1,
    integer: true,
    onInput: (value) => {
      uiState.draftElement.data.convolution.branchOrder = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Branch Spacing",
    value: tensor.convolution.layout.branchSpacing,
    min: 0,
    max: 4,
    step: 0.05,
    onInput: (value) => {
      uiState.draftElement.data.convolution.layout.branchSpacing = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Branch Offset X",
    value: tensor.convolution.layout.branchOffset[0],
    min: -500,
    max: 500,
    step: 0.25,
    onInput: (value) => {
      uiState.draftElement.data.convolution.layout.branchOffset[0] = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Branch Offset Y",
    value: tensor.convolution.layout.branchOffset[1],
    min: -500,
    max: 500,
    step: 0.25,
    onInput: (value) => {
      uiState.draftElement.data.convolution.layout.branchOffset[1] = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Branch Offset Z",
    value: tensor.convolution.layout.branchOffset[2],
    min: -500,
    max: 500,
    step: 0.25,
    onInput: (value) => {
      uiState.draftElement.data.convolution.layout.branchOffset[2] = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Parent Kernel");
  addNumberField(inspectorFields, {
    label: "Kernel Height",
    value: tensor.convolution.kernel.height,
    min: 1,
    max: 512,
    step: 1,
    integer: true,
    onInput: (value) => {
      uiState.draftElement.data.convolution.kernel.height = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Kernel Width",
    value: tensor.convolution.kernel.width,
    min: 1,
    max: 512,
    step: 1,
    integer: true,
    onInput: (value) => {
      uiState.draftElement.data.convolution.kernel.width = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Kernel Channels",
    value: tensor.convolution.kernel.channels ?? 0,
    min: 0,
    max: 4096,
    step: 1,
    integer: true,
    onInput: (value) => {
      uiState.draftElement.data.convolution.kernel.channels = value <= 0 ? null : value;
      syncDraftAndPreview(editor);
    }
  });
  if (uiState.inspectorMode === "edit") {
    const kernelPlacement = syncKernelHandleTargetSelection(editor, currentTensorId);
    if (kernelPlacement.options.length > 1) {
      addSelectField(inspectorFields, {
        label: "Kernel To Move",
        value: kernelPlacement.targetSourceId ?? "",
        options: [
          { value: "", label: "(Select kernel)" },
          ...kernelPlacement.options.map((option) => ({
            value: option.value,
            label: option.label
          }))
        ],
        onInput: (value) => {
          uiState.kernelHandleTargetSourceId = value || null;
          editor.setKernelHandleTargetSourceId(uiState.kernelHandleTargetSourceId);
          if (!uiState.kernelHandleTargetSourceId && uiState.kernelHandleEnabled) {
            uiState.kernelHandleEnabled = false;
            editor.setKernelHandleEnabled(false);
          }
          renderInspector(editor);
        }
      });
    }

    const kernelMoveRow = createFieldRow("Canvas Kernel Move");
    const kernelMoveButton = createButton(
      uiState.kernelHandleEnabled ? "Disable Handle" : "Enable Handle",
      { className: "field-action" }
    );
    const canMoveKernel = Boolean(
      kernelPlacement.options.length > 0 && uiState.kernelHandleTargetSourceId
    );
    kernelMoveButton.disabled = !canMoveKernel;
    kernelMoveButton.addEventListener("click", () => {
      const nextEnabled = !uiState.kernelHandleEnabled;
      if (nextEnabled && !uiState.kernelHandleTargetSourceId) {
        return;
      }
      uiState.kernelHandleEnabled = nextEnabled;
      uiState.curveHandleEnabled = false;
      editor.setCurveHandleEnabled(false);
      editor.setKernelHandleTargetSourceId(uiState.kernelHandleTargetSourceId);
      editor.setKernelHandleEnabled(nextEnabled);
      syncDirectHandleStatus(editor);
      kernelMoveButton.textContent = nextEnabled ? "Disable Handle" : "Enable Handle";
    });
    kernelMoveRow.appendChild(kernelMoveButton);
    inspectorFields.appendChild(kernelMoveRow);
  }
  addColorField(inspectorFields, {
    label: "Kernel Color",
    value: tensor.convolution.kernel.color,
    onInput: (value) => {
      uiState.draftElement.data.convolution.kernel.color = value;
      syncDraftAndPreview(editor);
    }
  });
  addRangeField(inspectorFields, {
    label: "Kernel Opacity",
    value: tensor.convolution.kernel.opacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.convolution.kernel.opacity = value;
      syncDraftAndPreview(editor);
    }
  });
  addColorField(inspectorFields, {
    label: "Kernel Border",
    value: tensor.convolution.kernel.borderColor,
    onInput: (value) => {
      uiState.draftElement.data.convolution.kernel.borderColor = value;
      syncDraftAndPreview(editor);
    }
  });
  addRangeField(inspectorFields, {
    label: "Kernel Border Opacity",
    value: tensor.convolution.kernel.borderOpacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.convolution.kernel.borderOpacity = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Kernel Label Scale",
    value: tensor.convolution.kernel.labelScaleHeight,
    min: 0.3,
    max: 40,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.convolution.kernel.labelScaleHeight = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Convolution Pyramid");
  addColorField(inspectorFields, {
    label: "Pyramid Color",
    value: tensor.convolution.pyramid.color,
    onInput: (value) => {
      uiState.draftElement.data.convolution.pyramid.color = value;
      syncDraftAndPreview(editor);
    }
  });
  addRangeField(inspectorFields, {
    label: "Pyramid Opacity",
    value: tensor.convolution.pyramid.opacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.convolution.pyramid.opacity = value;
      syncDraftAndPreview(editor);
    }
  });
  addColorField(inspectorFields, {
    label: "Pyramid Border",
    value: tensor.convolution.pyramid.borderColor,
    onInput: (value) => {
      uiState.draftElement.data.convolution.pyramid.borderColor = value;
      syncDraftAndPreview(editor);
    }
  });
  addRangeField(inspectorFields, {
    label: "Pyramid Border Opacity",
    value: tensor.convolution.pyramid.borderOpacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.convolution.pyramid.borderOpacity = value;
      syncDraftAndPreview(editor);
    }
  });
}

function renderArrowInspector(editor) {
  const arrow = uiState.draftElement.data;

  addSectionTitle(inspectorFields, "Type");
  addSelectField(inspectorFields, {
    label: "Arrow Kind",
    value: arrow.arrowType,
    options: [
      { value: "3d", label: "3D Arrow" },
      { value: "2d", label: "2D Arrow" },
      { value: "dotted", label: "Dotted Arrow" },
      { value: "curved", label: "Curved Arrow" }
    ],
    onInput: (value) => {
      uiState.draftElement.data.arrowType = value;
      disableCurveHandleEditing(editor);
      syncDraftAndPreview(editor);
      renderInspector(editor);
    }
  });

  addSectionTitle(inspectorFields, "Geometry");
  addNumberField(inspectorFields, {
    label: "Length",
    value: arrow.length,
    min: 4,
    step: 0.5,
    onInput: (value) => {
      uiState.draftElement.data.length = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Thickness",
    value: arrow.thickness,
    min: 0.1,
    max: 60,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.thickness = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Head Length",
    value: arrow.headLength,
    min: 0.3,
    max: 400,
    step: 0.2,
    onInput: (value) => {
      uiState.draftElement.data.headLength = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Head Width",
    value: arrow.headWidth,
    min: 0.3,
    max: 400,
    step: 0.2,
    onInput: (value) => {
      uiState.draftElement.data.headWidth = value;
      syncDraftAndPreview(editor);
    }
  });

  if (arrow.arrowType === "dotted") {
    addNumberField(inspectorFields, {
      label: "Dash Size",
      value: arrow.dashSize,
      min: 0.1,
      max: 100,
      step: 0.1,
      onInput: (value) => {
        uiState.draftElement.data.dashSize = value;
        syncDraftAndPreview(editor);
      }
    });

    addNumberField(inspectorFields, {
      label: "Gap Size",
      value: arrow.gapSize,
      min: 0.1,
      max: 100,
      step: 0.1,
      onInput: (value) => {
        uiState.draftElement.data.gapSize = value;
        syncDraftAndPreview(editor);
      }
    });
  }

  if (arrow.arrowType === "curved") {
    addSectionTitle(inspectorFields, "Curve Control");

    addNumberField(inspectorFields, {
      label: "Control X",
      value: arrow.controlPoint[0],
      min: -500,
      max: 500,
      step: 0.5,
      onInput: (value) => {
        uiState.draftElement.data.controlPoint[0] = value;
        syncDraftAndPreview(editor);
      }
    });

    addNumberField(inspectorFields, {
      label: "Control Y",
      value: arrow.controlPoint[1],
      min: -500,
      max: 500,
      step: 0.5,
      onInput: (value) => {
        uiState.draftElement.data.controlPoint[1] = value;
        syncDraftAndPreview(editor);
      }
    });

    addNumberField(inspectorFields, {
      label: "Control Z",
      value: arrow.controlPoint[2],
      min: -500,
      max: 500,
      step: 0.5,
      onInput: (value) => {
        uiState.draftElement.data.controlPoint[2] = value;
        syncDraftAndPreview(editor);
      }
    });

    if (uiState.inspectorMode === "edit") {
      const row = createFieldRow("Canvas Curve Edit");
      const button = createButton("Toggle Handle", { className: "field-action" });
      button.addEventListener("click", () => {
        uiState.curveHandleEnabled = !uiState.curveHandleEnabled;
        uiState.kernelHandleEnabled = false;
        editor.setKernelHandleEnabled(false);
        editor.setCurveHandleEnabled(uiState.curveHandleEnabled);
        curveHandleStatus.textContent = uiState.curveHandleEnabled
          ? "Curve handle: On"
          : "Curve handle: Off";
      });
      row.appendChild(button);
      inspectorFields.appendChild(row);
    }
  }

  addSectionTitle(inspectorFields, "Appearance");
  addColorField(inspectorFields, {
    label: "Color",
    value: arrow.color,
    onInput: (value) => {
      uiState.draftElement.data.color = value;
      syncDraftAndPreview(editor);
    }
  });
  addRangeField(inspectorFields, {
    label: "Opacity",
    value: arrow.opacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.opacity = value;
      syncDraftAndPreview(editor);
    }
  });
}

function renderFrustumInspector(editor) {
  const frustum = uiState.draftElement.data;

  addSectionTitle(inspectorFields, "Geometry");
  addNumberField(inspectorFields, {
    label: "Top Size",
    value: frustum.topSize,
    min: 0.2,
    max: 2000,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.topSize = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Bottom Size",
    value: frustum.bottomSize,
    min: 0.2,
    max: 2000,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.bottomSize = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Length",
    value: frustum.length,
    min: 0.2,
    max: 2000,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.length = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Appearance");
  addColorField(inspectorFields, {
    label: "Color",
    value: frustum.color,
    onInput: (value) => {
      uiState.draftElement.data.color = value;
      syncDraftAndPreview(editor);
    }
  });
  addRangeField(inspectorFields, {
    label: "Opacity",
    value: frustum.opacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.opacity = value;
      syncDraftAndPreview(editor);
    }
  });
  addColorField(inspectorFields, {
    label: "Border Color",
    value: frustum.borderColor,
    onInput: (value) => {
      uiState.draftElement.data.borderColor = value;
      syncDraftAndPreview(editor);
    }
  });
  addRangeField(inspectorFields, {
    label: "Border Opacity",
    value: frustum.borderOpacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.borderOpacity = value;
      syncDraftAndPreview(editor);
    }
  });
}

function renderLabelInspector(editor) {
  const label = uiState.draftElement.data;

  addSectionTitle(inspectorFields, "Content");
  addTextField(inspectorFields, {
    label: "Text",
    value: label.text,
    onInput: (value) => {
      uiState.draftElement.data.text = value;
      syncDraftAndPreview(editor);
    }
  });

  addSelectField(inspectorFields, {
    label: "Font",
    value: label.fontFamily,
    options: [
      { value: "Arial", label: "Arial" },
      { value: "Helvetica", label: "Helvetica" },
      { value: "Georgia", label: "Georgia" },
      { value: "Courier New", label: "Courier New" },
      { value: "Verdana", label: "Verdana" },
      { value: "Trebuchet MS", label: "Trebuchet MS" }
    ],
    onInput: (value) => {
      uiState.draftElement.data.fontFamily = value;
      syncDraftAndPreview(editor);
    }
  });

  addNumberField(inspectorFields, {
    label: "Font Size",
    value: label.fontSize,
    min: 8,
    max: 180,
    step: 1,
    onInput: (value) => {
      uiState.draftElement.data.fontSize = value;
      syncDraftAndPreview(editor);
    }
  });

  addNumberField(inspectorFields, {
    label: "Scale Height",
    value: label.scaleHeight,
    min: 0.1,
    max: 120,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.scaleHeight = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Text Style");
  addColorField(inspectorFields, {
    label: "Text Color",
    value: label.textColor,
    onInput: (value) => {
      uiState.draftElement.data.textColor = value;
      syncDraftAndPreview(editor);
    }
  });

  addRangeField(inspectorFields, {
    label: "Text Opacity",
    value: label.textOpacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.textOpacity = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Background");
  addColorField(inspectorFields, {
    label: "Background",
    value: label.backgroundColor,
    onInput: (value) => {
      uiState.draftElement.data.backgroundColor = value;
      syncDraftAndPreview(editor);
    }
  });

  addRangeField(inspectorFields, {
    label: "Background Opacity",
    value: label.backgroundOpacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.backgroundOpacity = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Border");
  addColorField(inspectorFields, {
    label: "Border Color",
    value: label.borderColor,
    onInput: (value) => {
      uiState.draftElement.data.borderColor = value;
      syncDraftAndPreview(editor);
    }
  });

  addRangeField(inspectorFields, {
    label: "Border Opacity",
    value: label.borderOpacity,
    min: 0,
    max: 1,
    step: 0.01,
    onInput: (value) => {
      uiState.draftElement.data.borderOpacity = value;
      syncDraftAndPreview(editor);
    }
  });

  addNumberField(inspectorFields, {
    label: "Border Width",
    value: label.borderWidth,
    min: 0,
    max: 30,
    step: 0.2,
    onInput: (value) => {
      uiState.draftElement.data.borderWidth = value;
      syncDraftAndPreview(editor);
    }
  });

  addNumberField(inspectorFields, {
    label: "Padding",
    value: label.padding,
    min: 0,
    max: 90,
    step: 1,
    onInput: (value) => {
      uiState.draftElement.data.padding = value;
      syncDraftAndPreview(editor);
    }
  });
}

function renderInspector(editor) {
  inspectorFields.innerHTML = "";

  const isCreate = uiState.inspectorMode === "create";
  const isEdit = !isCreate;
  inspectorTitle.textContent = isCreate ? "Create Element" : "Edit Element";
  inspectorSubtitle.textContent = isCreate
    ? "Configure and add reusable building blocks"
    : "Update the selected object";

  addTextField(inspectorFields, {
    label: "Name",
    value: uiState.draftElement.name,
    onInput: (value) => {
      uiState.draftElement.name = value;
      syncDraftAndPreview(editor);
    }
  });

  if (uiState.draftElement.type === ELEMENT_TYPES.tensor) {
    renderTensorInspector(editor);
  } else if (uiState.draftElement.type === ELEMENT_TYPES.arrow) {
    renderArrowInspector(editor);
  } else if (uiState.draftElement.type === ELEMENT_TYPES.frustum) {
    renderFrustumInspector(editor);
  } else {
    renderLabelInspector(editor);
  }

  syncDirectHandleStatus(editor);

  inspectorActionButton.textContent = isCreate ? "Add To Canvas" : "Apply Changes";
  inspectorActionButton.classList.toggle("create-action", isCreate);
  inspectorDeleteButton.hidden = !isEdit;
  inspectorDeleteButton.disabled = !isEdit;
  preview.setElementConfig(uiState.draftElement);
}

function hideRightPanel() {
  rightPanel.classList.add("panel-hidden");
  rightPanelShowButton.hidden = false;
}

function showRightPanel() {
  rightPanel.classList.remove("panel-hidden");
  rightPanelShowButton.hidden = true;
}

let editor = null;

editor = new ArchitectureEditor({
  app,
  onSelectionChange: (selectedElement) => {
    const previousSelectedId = uiState.selectedElement?.id ?? null;
    uiState.selectedElement = selectedElement;
    if (duplicateButton) {
      duplicateButton.disabled = !selectedElement;
    }

    if (uiState.holdCreateModeOnNextSelection) {
      uiState.holdCreateModeOnNextSelection = false;
      return;
    }

    if (selectedElement && preview && inspectorFields && editor) {
      openEditInspector(selectedElement, editor, {
        preserveHandles: previousSelectedId === selectedElement.id
      });
    }
  },
  onDocumentChange: (documentConfig) => {
    uiState.latestDocument = clone(documentConfig);
    setGlobalBackground(documentConfig.scene.background);
    if (backgroundInput) {
      backgroundInput.value = documentConfig.scene.background;
    }
  },
  onHistoryChange: () => {
    applyUndoButtonState(editor);
  }
});

editor.loadDocument(startingDocument, { selectFirst: true, emitDocumentChange: true });
editor.fitView();

const leftDock = document.createElement("div");
leftDock.className = "left-dock";

const leftPanel = document.createElement("aside");
leftPanel.className = "tool-panel";

const leftHeader = document.createElement("div");
leftHeader.className = "panel-header";

const leftTitle = document.createElement("h2");
leftTitle.className = "panel-title";
leftTitle.textContent = "Architecture Tools";

const leftHideButton = createButton("Hide", { className: "panel-toggle" });
leftHideButton.addEventListener("click", () => {
  leftPanel.classList.add("panel-hidden");
  leftShowButton.hidden = false;
});

leftHeader.append(leftTitle, leftHideButton);

const createTensorButton = createButton("[] Create Tensor", {
  title: "Create a tensor volume"
});
createTensorButton.addEventListener("click", () => openCreateInspector(ELEMENT_TYPES.tensor, editor));

const createArrowButton = createButton("-> Create Arrow", {
  title: "Create an arrow connector"
});
createArrowButton.addEventListener("click", () => openCreateInspector(ELEMENT_TYPES.arrow, editor));

const createLabelButton = createButton("T Create Label", {
  title: "Create a label"
});
createLabelButton.addEventListener("click", () => openCreateInspector(ELEMENT_TYPES.label, editor));

const createFrustumButton = createButton("[] Create Frustum", {
  title: "Create a truncated square pyramid"
});
createFrustumButton.addEventListener("click", () => openCreateInspector(ELEMENT_TYPES.frustum, editor));

duplicateButton = createButton("Duplicate Selected");
duplicateButton.disabled = true;
duplicateButton.addEventListener("click", () => {
  editor.duplicateSelected();
});
duplicateButton.disabled = !editor.getSelectedElement();

undoButton = createButton("Undo (Cmd/Ctrl+Z)");
undoButton.disabled = true;
undoButton.addEventListener("click", () => {
  editor.undo();
});
applyUndoButtonState(editor);

const transformSection = document.createElement("div");
transformSection.className = "button-row";

moveModeButton = createButton("Move", { className: "tool-button compact" });
moveModeButton.addEventListener("click", () => {
  disableCurveHandleEditing(editor);
  editor.setTransformMode("translate");
  applyTransformModeButtonState("translate");
});

rotateModeButton = createButton("Rotate", { className: "tool-button compact" });
rotateModeButton.addEventListener("click", () => {
  disableCurveHandleEditing(editor);
  editor.setTransformMode("rotate");
  applyTransformModeButtonState("rotate");
});

transformSection.append(moveModeButton, rotateModeButton);
applyTransformModeButtonState("translate");

const fitViewButton = createButton("Fit View");
fitViewButton.addEventListener("click", () => editor.fitView());

const sceneSection = document.createElement("div");
sceneSection.className = "panel-section";

const sceneHeading = document.createElement("h3");
sceneHeading.className = "section-title";
sceneHeading.textContent = "Scene";

const backgroundRow = createFieldRow("Background");
backgroundInput = document.createElement("input");
backgroundInput.className = "field-input color-input";
backgroundInput.type = "color";
backgroundInput.value = startingDocument.scene.background;
backgroundInput.addEventListener("input", () => {
  editor.setBackground(backgroundInput.value);
});
backgroundRow.appendChild(backgroundInput);

const exportResolutionRow = createFieldRow("Export Size");
const exportResolutionControls = document.createElement("div");
exportResolutionControls.className = "export-resolution-controls";

const exportWidthInput = document.createElement("input");
exportWidthInput.className = "field-input";
exportWidthInput.type = "number";
exportWidthInput.min = "64";
exportWidthInput.max = String(MAX_EXPORT_RESOLUTION);
exportWidthInput.step = "1";
exportWidthInput.value = String(uiState.exportResolution.width);
exportWidthInput.title = "Export width in pixels";

const exportResolutionSeparator = document.createElement("span");
exportResolutionSeparator.className = "export-resolution-separator";
exportResolutionSeparator.textContent = "x";

const exportHeightInput = document.createElement("input");
exportHeightInput.className = "field-input";
exportHeightInput.type = "number";
exportHeightInput.min = "64";
exportHeightInput.max = String(MAX_EXPORT_RESOLUTION);
exportHeightInput.step = "1";
exportHeightInput.value = String(uiState.exportResolution.height);
exportHeightInput.title = "Export height in pixels";

const syncExportResolutionState = () => {
  const width = toResolution(exportWidthInput.value, uiState.exportResolution.width);
  const height = toResolution(exportHeightInput.value, uiState.exportResolution.height);
  uiState.exportResolution = { width, height };
  exportWidthInput.value = String(width);
  exportHeightInput.value = String(height);
};

exportWidthInput.addEventListener("change", syncExportResolutionState);
exportHeightInput.addEventListener("change", syncExportResolutionState);

exportResolutionControls.append(
  exportWidthInput,
  exportResolutionSeparator,
  exportHeightInput
);
exportResolutionRow.appendChild(exportResolutionControls);

const exportRegionRow = createFieldRow("Export Region");
const exportRegionControls = document.createElement("div");
exportRegionControls.className = "export-region-controls";

selectExportRegionButton = createButton("Select Region", {
  className: "tool-button compact",
  title: "Draw an export crop region on the canvas"
});
selectExportRegionButton.addEventListener("click", () => {
  syncExportResolutionState();
  setExportSelectionMode(!uiState.exportSelectionMode);
});

clearExportRegionButton = createButton("Clear", { className: "tool-button compact" });
clearExportRegionButton.addEventListener("click", () => {
  setExportSelectionMode(false);
  setExportCrop(null);
});

exportRegionStatus = document.createElement("p");
exportRegionStatus.className = "export-region-status";
exportRegionStatus.textContent = "Full camera view";

exportRegionControls.append(
  selectExportRegionButton,
  clearExportRegionButton,
  exportRegionStatus
);
exportRegionRow.appendChild(exportRegionControls);

sceneSection.append(sceneHeading, backgroundRow, exportResolutionRow, exportRegionRow);

const fileActions = document.createElement("div");
fileActions.className = "button-row";

const exportJsonButton = createButton("Export JSON", { className: "tool-button compact" });
exportJsonButton.addEventListener("click", () => {
  const exported = editor.exportDocument();
  downloadTextFile(JSON.stringify(exported, null, 2), "architecture.json", "application/json");
});

const importJsonButton = createButton("Import JSON", { className: "tool-button compact" });
importJsonButton.addEventListener("click", () => {
  importInput.click();
});

const exportImageButton = createButton("Export PNG", { className: "tool-button compact full-row" });
exportImageButton.title = "Export current camera view as PNG";
exportImageButton.addEventListener("click", () => {
  try {
    syncExportResolutionState();
    const { width, height } = uiState.exportResolution;
    const dataUrl = editor.exportImage({
      format: "png",
      width,
      height,
      crop: uiState.exportCrop ? { ...uiState.exportCrop } : null
    });
    downloadDataUrl(dataUrl, "architecture-view.png");
  } catch (error) {
    window.alert(`Unable to export PNG: ${error.message}`);
  }
});

fileActions.append(exportJsonButton, importJsonButton, exportImageButton);

importInput = document.createElement("input");
importInput.type = "file";
importInput.accept = "application/json,.json";
importInput.hidden = true;
importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const normalized = normalizeDocument(parsed);
    editor.loadDocument(normalized, { selectFirst: true, emitDocumentChange: true, captureUndo: true });
    backgroundInput.value = normalized.scene.background;
    setGlobalBackground(normalized.scene.background);
  } catch (error) {
    window.alert(`Unable to import JSON: ${error.message}`);
  } finally {
    importInput.value = "";
  }
});

const leftHelp = document.createElement("p");
leftHelp.className = "panel-help";
leftHelp.textContent =
  "Shift+click to multi-select. Undo with Cmd/Ctrl+Z. Double-click a rotate axis to snap 90°. Move mode shows temporary alignment guides and snapping.";

leftPanel.append(
  leftHeader,
  createTensorButton,
  createArrowButton,
  createLabelButton,
  createFrustumButton,
  duplicateButton,
  undoButton,
  transformSection,
  fitViewButton,
  sceneSection,
  fileActions,
  leftHelp
);

const leftShowButton = createButton("Show Tools", { className: "panel-show-button" });
leftShowButton.hidden = true;
leftShowButton.addEventListener("click", () => {
  leftPanel.classList.remove("panel-hidden");
  leftShowButton.hidden = true;
});

leftDock.append(leftPanel, leftShowButton);

const rightDock = document.createElement("div");
rightDock.className = "right-dock";

rightPanel = document.createElement("aside");
rightPanel.className = "inspector-panel";

const rightHeader = document.createElement("div");
rightHeader.className = "panel-header";

const rightHeaderText = document.createElement("div");
rightHeaderText.className = "header-stack";

inspectorTitle = document.createElement("h2");
inspectorTitle.className = "panel-title";
inspectorTitle.textContent = "Create Element";

inspectorSubtitle = document.createElement("p");
inspectorSubtitle.className = "panel-subtitle";
inspectorSubtitle.textContent = "Configure and add reusable building blocks";

rightHeaderText.append(inspectorTitle, inspectorSubtitle);

const rightHideButton = createButton("Hide", { className: "panel-toggle" });
rightHideButton.addEventListener("click", hideRightPanel);

rightHeader.append(rightHeaderText, rightHideButton);

const previewContainer = document.createElement("div");
previewContainer.className = "preview-container";

const previewLabel = document.createElement("p");
previewLabel.className = "preview-label";
previewLabel.textContent = "Live Preview";

const previewViewport = document.createElement("div");
previewViewport.className = "preview-viewport";
previewContainer.append(previewLabel, previewViewport);

inspectorFields = document.createElement("div");
inspectorFields.className = "inspector-fields";

curveHandleStatus = document.createElement("p");
curveHandleStatus.className = "curve-status";
curveHandleStatus.textContent = "Curve handle: Off";
curveHandleStatus.hidden = true;

inspectorActionButton = createButton("Add To Canvas", { className: "tool-button inspector-action" });
inspectorActionButton.addEventListener("click", () => {
  if (uiState.inspectorMode === "create") {
    uiState.holdCreateModeOnNextSelection = true;
    const createdId = editor.createElementFromTemplate(uiState.draftElement, {
      offsetBySelection: true
    });

    if (!createdId) {
      uiState.holdCreateModeOnNextSelection = false;
    }
  } else {
    const updated = editor.updateSelectedElement(uiState.draftElement);
    if (updated) {
      uiState.draftElement = clone(updated);
      preview.setElementConfig(uiState.draftElement);
    }
  }
});

inspectorDeleteButton = createButton("Remove From Canvas", {
  className: "tool-button inspector-delete"
});
inspectorDeleteButton.hidden = true;
inspectorDeleteButton.addEventListener("click", () => {
  if (uiState.inspectorMode !== "edit") {
    return;
  }

  disableCurveHandleEditing(editor);
  const deleted = editor.deleteSelectedElement();
  if (deleted) {
    uiState.selectedElement = null;
    openCreateInspector(uiState.draftElement.type, editor);
  }
});

rightPanel.append(
  rightHeader,
  previewContainer,
  curveHandleStatus,
  inspectorFields,
  inspectorActionButton,
  inspectorDeleteButton
);

rightPanelShowButton = createButton("Show Inspector", { className: "panel-show-button" });
rightPanelShowButton.hidden = true;
rightPanelShowButton.addEventListener("click", showRightPanel);

rightDock.append(rightPanel, rightPanelShowButton);

const viewGizmo = document.createElement("section");
viewGizmo.className = "view-gizmo";

const viewGizmoHeader = document.createElement("div");
viewGizmoHeader.className = "view-gizmo-header";

const viewGizmoTitle = document.createElement("p");
viewGizmoTitle.className = "view-gizmo-title";
viewGizmoTitle.textContent = "View Gizmo";

viewModeStatus = document.createElement("p");
viewModeStatus.className = "view-gizmo-status";
viewModeStatus.textContent = "3D free";

viewGizmoHeader.append(viewGizmoTitle, viewModeStatus);

const axisButtonRow = document.createElement("div");
axisButtonRow.className = "view-gizmo-row";

const alignXButton = createButton("X", { className: "view-gizmo-button" });
const alignYButton = createButton("Y", { className: "view-gizmo-button" });
const alignZButton = createButton("Z", { className: "view-gizmo-button" });

alignXButton.addEventListener("click", () => {
  editor.alignViewToAxis("X");
  syncViewPlaneControls(editor);
});
alignYButton.addEventListener("click", () => {
  editor.alignViewToAxis("Y");
  syncViewPlaneControls(editor);
});
alignZButton.addEventListener("click", () => {
  editor.alignViewToAxis("Z");
  syncViewPlaneControls(editor);
});

axisButtonRow.append(alignXButton, alignYButton, alignZButton);

const planeButtonRow = document.createElement("div");
planeButtonRow.className = "view-gizmo-row";

const xyPlaneButton = createButton("XY", { className: "view-gizmo-button" });
const yzPlaneButton = createButton("YZ", { className: "view-gizmo-button" });
const xzPlaneButton = createButton("XZ", { className: "view-gizmo-button" });

viewPlaneButtons = {
  XY: xyPlaneButton,
  YZ: yzPlaneButton,
  XZ: xzPlaneButton
};

for (const [plane, button] of Object.entries(viewPlaneButtons)) {
  button.addEventListener("click", () => {
    if (editor.getViewPlane() === plane) {
      editor.clearViewPlane();
    } else {
      editor.setViewPlane(plane);
    }
    syncViewPlaneControls(editor);
  });
}

planeButtonRow.append(xyPlaneButton, yzPlaneButton, xzPlaneButton);

const clearPlaneButton = createButton("3D", {
  className: "view-gizmo-button view-gizmo-button-accent"
});
clearPlaneButton.addEventListener("click", () => {
  editor.clearViewPlane();
  syncViewPlaneControls(editor);
});

viewGizmo.append(viewGizmoHeader, axisButtonRow, planeButtonRow, clearPlaneButton);

syncViewPlaneControls(editor);

exportSelectionOverlay = document.createElement("div");
exportSelectionOverlay.className = "export-selection-overlay";

exportSelectionBox = document.createElement("div");
exportSelectionBox.className = "export-selection-box";
exportSelectionBox.hidden = true;

exportSelectionHint = document.createElement("p");
exportSelectionHint.className = "export-selection-hint";
exportSelectionHint.textContent = "Drag on canvas to choose export region (locked to export aspect ratio)";
exportSelectionHint.hidden = true;

exportSelectionOverlay.append(exportSelectionBox, exportSelectionHint);
exportSelectionOverlay.addEventListener("pointerdown", (event) => {
  if (!uiState.exportSelectionMode || event.button !== 0) {
    return;
  }

  const bounds = getCanvasViewportRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  ) {
    return;
  }

  event.preventDefault();

  const startX = Math.min(bounds.right, Math.max(bounds.left, event.clientX));
  const startY = Math.min(bounds.bottom, Math.max(bounds.top, event.clientY));

  exportSelectionDragState = {
    pointerId: event.pointerId,
    bounds,
    startX,
    startY,
    previewRect: { x: startX, y: startY, width: 1, height: 1 }
  };

  exportSelectionOverlay.setPointerCapture(event.pointerId);
  updateExportSelectionVisuals();
});

exportSelectionOverlay.addEventListener("pointermove", (event) => {
  if (
    !uiState.exportSelectionMode ||
    !exportSelectionDragState ||
    event.pointerId !== exportSelectionDragState.pointerId
  ) {
    return;
  }

  event.preventDefault();

  const bounds = exportSelectionDragState.bounds;
  const currentX = Math.min(bounds.right, Math.max(bounds.left, event.clientX));
  const currentY = Math.min(bounds.bottom, Math.max(bounds.top, event.clientY));
  const aspect = uiState.exportResolution.width / Math.max(1, uiState.exportResolution.height);

  exportSelectionDragState.previewRect = resolveAspectLockedSelectionRect({
    startX: exportSelectionDragState.startX,
    startY: exportSelectionDragState.startY,
    currentX,
    currentY,
    bounds,
    aspect
  });

  updateExportSelectionVisuals();
});

exportSelectionOverlay.addEventListener("pointerup", (event) => {
  if (!exportSelectionDragState || event.pointerId !== exportSelectionDragState.pointerId) {
    return;
  }

  event.preventDefault();

  const dragState = exportSelectionDragState;
  const selectedRect = dragState.previewRect;
  setExportSelectionMode(false);

  if (!selectedRect || selectedRect.width < 8 || selectedRect.height < 8) {
    return;
  }

  setExportCrop({
    x: (selectedRect.x - dragState.bounds.left) / dragState.bounds.width,
    y: (selectedRect.y - dragState.bounds.top) / dragState.bounds.height,
    width: selectedRect.width / dragState.bounds.width,
    height: selectedRect.height / dragState.bounds.height
  });
});

exportSelectionOverlay.addEventListener("pointercancel", (event) => {
  if (!exportSelectionDragState || event.pointerId !== exportSelectionDragState.pointerId) {
    return;
  }

  event.preventDefault();
  setExportSelectionMode(false);
});

document.body.append(leftDock, rightDock, viewGizmo, importInput, exportSelectionOverlay);

preview = new ElementPreview(previewViewport);
openCreateInspector(ELEMENT_TYPES.tensor, editor);
setExportCrop(null);
setExportSelectionMode(false);
app.start();

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && uiState.exportSelectionMode) {
    setExportSelectionMode(false);
    return;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  const isUndoKey = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && key === "z";

  if (!isUndoKey || isEditableDomTarget(event.target)) {
    return;
  }

  if (editor.undo()) {
    event.preventDefault();
  }
});

window.addEventListener("resize", () => {
  updateExportSelectionVisuals();
});
