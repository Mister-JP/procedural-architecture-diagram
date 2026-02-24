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

function setGlobalBackground(color) {
  document.documentElement.style.background = color;
  document.body.style.background = color;
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

const uiState = {
  inspectorMode: "create",
  draftElement: createDefaultElement(ELEMENT_TYPES.tensor),
  selectedElement: null,
  holdCreateModeOnNextSelection: false,
  curveHandleEnabled: false,
  latestDocument: clone(startingDocument)
};

let duplicateButton;
let moveModeButton;
let rotateModeButton;
let curveHandleStatus;
let rightPanel;
let rightPanelShowButton;
let inspectorTitle;
let inspectorSubtitle;
let inspectorFields;
let inspectorActionButton;
let preview;
let importInput;

function applyTransformModeButtonState(mode) {
  const isMove = mode === "translate";
  moveModeButton.classList.toggle("active", isMove);
  rotateModeButton.classList.toggle("active", !isMove);
}

function disableCurveHandleEditing(editor) {
  uiState.curveHandleEnabled = false;
  editor.setCurveHandleEnabled(false);
  if (curveHandleStatus) {
    curveHandleStatus.textContent = "Curve handle: Off";
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

function openEditInspector(elementConfig, editor) {
  disableCurveHandleEditing(editor);
  uiState.inspectorMode = "edit";
  setDraftElement(clone(elementConfig));
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

function addNumberField(
  container,
  { label, value, min = -99999, max = 99999, step = 1, onInput, integer = false }
) {
  const row = createFieldRow(label);
  const input = document.createElement("input");
  input.className = "field-input";
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
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

function renderTensorInspector(editor) {
  const tensor = uiState.draftElement.data;

  addSectionTitle(inspectorFields, "Structure");
  addNumberField(inspectorFields, {
    label: "Channels",
    value: tensor.shape[0],
    min: 1,
    max: 512,
    step: 1,
    integer: true,
    onInput: (value) => {
      uiState.draftElement.data.shape[0] = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Height",
    value: tensor.shape[1],
    min: 1,
    max: 512,
    step: 1,
    integer: true,
    onInput: (value) => {
      uiState.draftElement.data.shape[1] = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Width",
    value: tensor.shape[2],
    min: 1,
    max: 512,
    step: 1,
    integer: true,
    onInput: (value) => {
      uiState.draftElement.data.shape[2] = value;
      syncDraftAndPreview(editor);
    }
  });

  addSectionTitle(inspectorFields, "Voxel Geometry");
  addNumberField(inspectorFields, {
    label: "Pixel Size",
    value: tensor.voxel.pixelSize,
    min: 0.2,
    max: 20,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.voxel.pixelSize = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Pixel Depth",
    value: tensor.voxel.pixelDepth,
    min: 0.1,
    max: 20,
    step: 0.1,
    onInput: (value) => {
      uiState.draftElement.data.voxel.pixelDepth = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "XY Gap",
    value: tensor.voxel.gap,
    min: 0,
    max: 12,
    step: 0.05,
    onInput: (value) => {
      uiState.draftElement.data.voxel.gap = value;
      syncDraftAndPreview(editor);
    }
  });
  addNumberField(inspectorFields, {
    label: "Layer Gap",
    value: tensor.voxel.layerGap,
    min: 0,
    max: 12,
    step: 0.05,
    onInput: (value) => {
      uiState.draftElement.data.voxel.layerGap = value;
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
    max: 3000,
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
  } else {
    renderLabelInspector(editor);
  }

  curveHandleStatus.hidden = !(
    uiState.inspectorMode === "edit" && uiState.draftElement.type === ELEMENT_TYPES.arrow
  );

  inspectorActionButton.textContent = isCreate ? "Add To Canvas" : "Apply Changes";
  inspectorActionButton.classList.toggle("create-action", isCreate);
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
    uiState.selectedElement = selectedElement;
    if (duplicateButton) {
      duplicateButton.disabled = !selectedElement;
    }

    if (uiState.holdCreateModeOnNextSelection) {
      uiState.holdCreateModeOnNextSelection = false;
      return;
    }

    if (selectedElement && preview && inspectorFields && editor) {
      openEditInspector(selectedElement, editor);
    }
  },
  onDocumentChange: (documentConfig) => {
    uiState.latestDocument = clone(documentConfig);
    setGlobalBackground(documentConfig.scene.background);
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

duplicateButton = createButton("Duplicate Selected");
duplicateButton.disabled = true;
duplicateButton.addEventListener("click", () => {
  editor.duplicateSelected();
});
duplicateButton.disabled = !editor.getSelectedElement();

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
const backgroundInput = document.createElement("input");
backgroundInput.className = "field-input color-input";
backgroundInput.type = "color";
backgroundInput.value = startingDocument.scene.background;
backgroundInput.addEventListener("input", () => {
  editor.setBackground(backgroundInput.value);
});
backgroundRow.appendChild(backgroundInput);
sceneSection.append(sceneHeading, backgroundRow);

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

fileActions.append(exportJsonButton, importJsonButton);

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
    editor.loadDocument(normalized, { selectFirst: true, emitDocumentChange: true });
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
  "Click an element in canvas to edit. Use Move/Rotate to reposition selected objects.";

leftPanel.append(
  leftHeader,
  createTensorButton,
  createArrowButton,
  createLabelButton,
  duplicateButton,
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

rightPanel.append(
  rightHeader,
  previewContainer,
  curveHandleStatus,
  inspectorFields,
  inspectorActionButton
);

rightPanelShowButton = createButton("Show Inspector", { className: "panel-show-button" });
rightPanelShowButton.hidden = true;
rightPanelShowButton.addEventListener("click", showRightPanel);

rightDock.append(rightPanel, rightPanelShowButton);

document.body.append(leftDock, rightDock, importInput);

preview = new ElementPreview(previewViewport);
openCreateInspector(ELEMENT_TYPES.tensor, editor);
app.start();
