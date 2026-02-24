import * as THREE from "three";
import { SceneApp } from "./core/SceneApp.js";
import { TensorVolume } from "./core/TensorVolume.js";
import { ConvolutionStageVisualization } from "./core/ConvolutionStageVisualization.js";
import { createLabelSprite } from "./core/label-utils.js";
import { getAxisSpan } from "./core/tensor-math.js";
import { PIPELINE_CONFIG, SCENE_CONFIG, SHARED_VOXEL_GEOMETRY } from "./config/pipeline-config.js";

const PROPORTIONAL_SPACING_FACTOR = 0.4;
const DEFAULT_BORDER_COLOR = "#111111";

function toHexColor(colorValue) {
  return `#${new THREE.Color(colorValue).getHexString()}`;
}

function createTensorVolume({ shape, upperLeft, channelColor }) {
  return new TensorVolume({
    shape,
    upperLeft,
    channelColor,
    ...SHARED_VOXEL_GEOMETRY
  });
}

function createOutputUpperLeft(inputVolume, stage, outputShape) {
  const xOffset = stage.xOffsetFromInput ?? 0;
  const yOffset = stage.yOffsetFromInput ?? 0;
  const zOffset = stage.zOffsetFromInput ?? 0;

  const outputWidth = outputShape[2];
  const outputHeight = outputShape[1];
  const outputChannels = outputShape[0];
  const outputWidthSpan = getAxisSpan(outputWidth, inputVolume.pixelSize, inputVolume.gap);
  const outputHeightSpan = getAxisSpan(outputHeight, inputVolume.pixelSize, inputVolume.gap);
  const outputDepthSpan = getAxisSpan(outputChannels, inputVolume.pixelDepth, inputVolume.layerGap);
  const alignedUpperLeftX = inputVolume.getCenterX() - outputWidthSpan * 0.5;
  const inputHeightSpan = inputVolume.getHeightSpan();
  const inputDepthSpan = inputVolume.getDepthSpan();
  const proportionalYSpan = (inputHeightSpan * 0.5 + outputHeightSpan * 0.5) * PROPORTIONAL_SPACING_FACTOR;
  const proportionalZSpan = (inputDepthSpan * 0.5 + outputDepthSpan * 0.5) * PROPORTIONAL_SPACING_FACTOR;

  const outputCenterY =
    yOffset === 0
      ? inputVolume.getCenterY()
      : inputVolume.getCenterY() +
        Math.sign(yOffset) * (proportionalYSpan + Math.abs(yOffset));

  const outputCenterZ =
    zOffset === 0
      ? inputVolume.getCenterZ()
      : inputVolume.getCenterZ() +
        Math.sign(zOffset) * (proportionalZSpan + Math.abs(zOffset));

  const centeredUpperLeftY = outputCenterY + outputHeightSpan * 0.5;
  const centeredUpperLeftZ = outputCenterZ + outputDepthSpan * 0.5;

  return new THREE.Vector3(
    (stage.alignCenterXWithInput ? alignedUpperLeftX : inputVolume.upperLeft.x) + xOffset,
    centeredUpperLeftY,
    centeredUpperLeftZ
  );
}

function normalizeConvolutionStage(stageConfig, inputVolume) {
  const outputChannels =
    stageConfig.outputChannels ??
    stageConfig.outputShape?.[0] ??
    stageConfig.kernelCount ??
    stageConfig.filterCount;

  if (outputChannels == null) {
    throw new Error("Each stage must define outputChannels, outputShape[0], or kernelCount/filterCount.");
  }

  const outputShape = stageConfig.outputShape ?? [outputChannels, inputVolume.height, inputVolume.width];
  const isSpatialDownsampleByHalf =
    outputShape[1] * 2 === inputVolume.height &&
    outputShape[2] * 2 === inputVolume.width;

  return {
    outputShape,
    kernelSize: stageConfig.kernelSize ?? 3,
    kernelCount: stageConfig.kernelCount ?? stageConfig.filterCount ?? outputChannels,
    kernelLayoutMode: stageConfig.kernelLayoutMode ?? stageConfig.kernelDisplayMode ?? "bank",
    outputChannelColor: stageConfig.outputChannelColor ?? stageConfig.outputColor,
    kernelColor: stageConfig.kernelColor ?? stageConfig.filterColor,
    showStageVisualization: stageConfig.showStageVisualization !== false,
    alignCenterXWithInput: stageConfig.alignCenterXWithInput ?? false,
    xOffsetFromInput: stageConfig.xOffsetFromInput ?? 0,
    yOffsetFromInput: stageConfig.yOffsetFromInput ?? 0,
    zOffsetFromInput: stageConfig.zOffsetFromInput ?? 75,
    isSpatialDownsampleByHalf
  };
}

function createTensorDimensionLabels(tensorVolume) {
  const group = new THREE.Group();

  const widthSpan = tensorVolume.getWidthSpan();
  const heightSpan = tensorVolume.getHeightSpan();
  const depthSpan = tensorVolume.getDepthSpan();
  const labelOffset = Math.max(1.5, tensorVolume.pixelSize * 1.8);
  const labelScale = Math.max(3.3, tensorVolume.pixelSize * 3.8);
  const frontOffsetZ = Math.max(0.2, tensorVolume.pixelDepth * 0.35);

  const widthLabel = createLabelSprite(`${tensorVolume.width}`, {
    scaleHeight: labelScale
  });
  widthLabel.position.set(
    tensorVolume.upperLeft.x + widthSpan * 0.5,
    tensorVolume.upperLeft.y + labelOffset,
    tensorVolume.upperLeft.z + frontOffsetZ
  );

  const heightLabel = createLabelSprite(`${tensorVolume.height}`, {
    scaleHeight: labelScale
  });
  heightLabel.position.set(
    tensorVolume.upperLeft.x - labelOffset,
    tensorVolume.upperLeft.y - heightSpan * 0.5,
    tensorVolume.upperLeft.z + frontOffsetZ
  );

  const depthLabel = createLabelSprite(`${tensorVolume.channels}`, {
    scaleHeight: labelScale
  });
  depthLabel.position.set(
    tensorVolume.upperLeft.x - labelOffset * 0.45,
    tensorVolume.upperLeft.y + labelOffset * 0.7,
    tensorVolume.upperLeft.z - depthSpan * 0.5
  );

  group.add(widthLabel, heightLabel, depthLabel);
  return group;
}

function buildPipeline(app) {
  const pipelineGroup = new THREE.Group();
  const stageVisualizations = [];
  const tensorVolumes = [];
  const dimensionLabelGroups = [];

  const inputVolume = createTensorVolume({
    shape: PIPELINE_CONFIG.input.shape,
    upperLeft: PIPELINE_CONFIG.input.upperLeft,
    channelColor: PIPELINE_CONFIG.input.channelColor
  });

  pipelineGroup.add(inputVolume.object3d);
  tensorVolumes.push(inputVolume);

  const inputLabels = createTensorDimensionLabels(inputVolume);
  pipelineGroup.add(inputLabels);
  dimensionLabelGroups.push(inputLabels);

  let currentInputVolume = inputVolume;

  for (const stageConfig of PIPELINE_CONFIG.stages) {
    const stage = normalizeConvolutionStage(stageConfig, currentInputVolume);
    const outputShape = stage.outputShape;

    const outputVolume = createTensorVolume({
      shape: outputShape,
      upperLeft: createOutputUpperLeft(currentInputVolume, stage, outputShape),
      channelColor: stage.outputChannelColor
    });

    pipelineGroup.add(outputVolume.object3d);
    tensorVolumes.push(outputVolume);

    const outputLabels = createTensorDimensionLabels(outputVolume);
    pipelineGroup.add(outputLabels);
    dimensionLabelGroups.push(outputLabels);

    if (stage.showStageVisualization) {
      const stageVisualization = new ConvolutionStageVisualization({
        inputVolume: currentInputVolume,
        outputVolume,
        kernelSize: stage.kernelSize,
        kernelCount: stage.kernelCount,
        kernelLayoutMode: stage.kernelLayoutMode,
        highlightKernelAtInputPatch: true,
        showHighlightConnections: true,
        showDiagramTransition: stage.isSpatialDownsampleByHalf,
        diagramTransitionLabel: "Strided Convolution",
        kernelColor: stage.kernelColor
      });

      pipelineGroup.add(stageVisualization.object3d);
      stageVisualizations.push(stageVisualization);
      tensorVolumes.push(...stageVisualization.getKernelVolumes());
    }

    currentInputVolume = outputVolume;
  }

  app.add(pipelineGroup);

  return {
    pipelineGroup,
    stageVisualizations,
    tensorVolumes,
    dimensionLabelGroups,
    inputVolume
  };
}

function triggerDownloadFromDataUrl(dataUrl, fileName) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function triggerDownloadFromBlob(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function exportSvg(app) {
  const width = app.renderer.domElement.width;
  const height = app.renderer.domElement.height;
  const pngDataUrl = app.exportRaster("png");
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${pngDataUrl}" width="${width}" height="${height}" />
</svg>`;
  const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  triggerDownloadFromBlob(blob, "cnn-diagram.svg");
}

function setupControls(app, pipeline) {
  const panel = document.createElement("div");
  panel.className = "controls-panel";

  const kernelToggleButton = document.createElement("button");
  kernelToggleButton.className = "control-button";
  kernelToggleButton.type = "button";
  kernelToggleButton.textContent = "Hide Kernels";

  const diagramModeButton = document.createElement("button");
  diagramModeButton.className = "control-button";
  diagramModeButton.type = "button";
  diagramModeButton.textContent = "Enable Diagram Mode";

  const labelToggleButton = document.createElement("button");
  labelToggleButton.className = "control-button";
  labelToggleButton.type = "button";
  labelToggleButton.textContent = "Hide Dimension Labels";

  const appearanceSection = document.createElement("div");
  appearanceSection.className = "control-section";

  const backgroundRow = document.createElement("label");
  backgroundRow.className = "control-row";
  const backgroundLabel = document.createElement("span");
  backgroundLabel.className = "control-label";
  backgroundLabel.textContent = "Background";
  const backgroundModeSelect = document.createElement("select");
  backgroundModeSelect.className = "control-input";
  backgroundModeSelect.innerHTML = `
    <option value="solid">Color</option>
    <option value="none">None</option>
  `;
  const backgroundColorInput = document.createElement("input");
  backgroundColorInput.className = "control-input color-input";
  backgroundColorInput.type = "color";
  backgroundColorInput.value = toHexColor(SCENE_CONFIG.background);
  backgroundRow.append(backgroundLabel, backgroundModeSelect, backgroundColorInput);

  const borderRow = document.createElement("label");
  borderRow.className = "control-row";
  const borderLabel = document.createElement("span");
  borderLabel.className = "control-label";
  borderLabel.textContent = "Pixel Border";
  const borderModeSelect = document.createElement("select");
  borderModeSelect.className = "control-input";
  borderModeSelect.innerHTML = `
    <option value="color">Color</option>
    <option value="none">None</option>
  `;
  const borderColorInput = document.createElement("input");
  borderColorInput.className = "control-input color-input";
  borderColorInput.type = "color";
  borderColorInput.value = DEFAULT_BORDER_COLOR;
  borderRow.append(borderLabel, borderModeSelect, borderColorInput);

  const opacityRow = document.createElement("label");
  opacityRow.className = "control-row";
  const opacityLabel = document.createElement("span");
  opacityLabel.className = "control-label";
  opacityLabel.textContent = "Pixel Opacity";
  const opacityRangeInput = document.createElement("input");
  opacityRangeInput.className = "control-input slider-input";
  opacityRangeInput.type = "range";
  opacityRangeInput.min = "0";
  opacityRangeInput.max = "1";
  opacityRangeInput.step = "0.05";
  opacityRangeInput.value = "1";
  const opacityValue = document.createElement("span");
  opacityValue.className = "control-value";
  opacityValue.textContent = "100%";
  opacityRow.append(opacityLabel, opacityRangeInput, opacityValue);

  const inputOpacityRow = document.createElement("label");
  inputOpacityRow.className = "control-row";
  const inputOpacityLabel = document.createElement("span");
  inputOpacityLabel.className = "control-label";
  inputOpacityLabel.textContent = "Input Opacity";
  const inputOpacityRangeInput = document.createElement("input");
  inputOpacityRangeInput.className = "control-input slider-input";
  inputOpacityRangeInput.type = "range";
  inputOpacityRangeInput.min = "0";
  inputOpacityRangeInput.max = "1";
  inputOpacityRangeInput.step = "0.05";
  inputOpacityRangeInput.value = "1";
  const inputOpacityValue = document.createElement("span");
  inputOpacityValue.className = "control-value";
  inputOpacityValue.textContent = "100%";
  inputOpacityRow.append(inputOpacityLabel, inputOpacityRangeInput, inputOpacityValue);

  appearanceSection.append(backgroundRow, borderRow, opacityRow, inputOpacityRow);

  const prepareExportButton = document.createElement("button");
  prepareExportButton.className = "control-button";
  prepareExportButton.type = "button";
  prepareExportButton.textContent = "Export";

  const exportRow = document.createElement("div");
  exportRow.className = "export-row";
  exportRow.hidden = true;

  const exportPngButton = document.createElement("button");
  exportPngButton.className = "control-button secondary";
  exportPngButton.type = "button";
  exportPngButton.textContent = "PNG";

  const exportJpegButton = document.createElement("button");
  exportJpegButton.className = "control-button secondary";
  exportJpegButton.type = "button";
  exportJpegButton.textContent = "JPEG";

  const exportSvgButton = document.createElement("button");
  exportSvgButton.className = "control-button secondary";
  exportSvgButton.type = "button";
  exportSvgButton.textContent = "SVG";

  exportRow.append(exportPngButton, exportJpegButton, exportSvgButton);

  const helperText = document.createElement("p");
  helperText.className = "controls-helper";
  helperText.textContent =
    "Click Export, adjust camera angle/zoom, then choose PNG, JPEG, or SVG.";

  panel.append(
    kernelToggleButton,
    diagramModeButton,
    labelToggleButton,
    appearanceSection,
    prepareExportButton,
    exportRow,
    helperText
  );
  document.body.appendChild(panel);

  let kernelsVisible = true;
  let diagramMode = false;
  let labelsVisible = true;
  let exportPrepared = false;

  function applyStageDisplay() {
    for (const stageVisualization of pipeline.stageVisualizations) {
      stageVisualization.setKernelVisibility(kernelsVisible);
      stageVisualization.setDiagramMode(diagramMode);
    }
  }

  function applyLabelVisibility() {
    for (const labelGroup of pipeline.dimensionLabelGroups) {
      labelGroup.visible = labelsVisible;
    }
  }

  function applyBackgroundStyle() {
    const isNone = backgroundModeSelect.value === "none";
    backgroundColorInput.disabled = isNone;
    app.setBackground(isNone ? null : backgroundColorInput.value, false);
    document.documentElement.style.background = isNone ? "transparent" : backgroundColorInput.value;
    document.body.style.background = isNone ? "transparent" : backgroundColorInput.value;
  }

  function applyVoxelStyles() {
    const borderColor = borderModeSelect.value === "none" ? null : borderColorInput.value;
    const voxelOpacity = Number(opacityRangeInput.value);
    const inputOpacity = Number(inputOpacityRangeInput.value);
    opacityValue.textContent = `${Math.round(voxelOpacity * 100)}%`;
    inputOpacityValue.textContent = `${Math.round(inputOpacity * 100)}%`;

    for (const tensorVolume of pipeline.tensorVolumes) {
      tensorVolume.setFillOpacity(voxelOpacity);
      tensorVolume.setEdgeColor(borderColor);
      tensorVolume.setEdgeOpacity(1);
    }
    pipeline.inputVolume.setFillOpacity(inputOpacity);
  }

  function renderAfterControlChange() {
    applyStageDisplay();
    applyLabelVisibility();
    applyBackgroundStyle();
    applyVoxelStyles();
    app.renderFrame();
  }

  kernelToggleButton.addEventListener("click", () => {
    kernelsVisible = !kernelsVisible;
    kernelToggleButton.textContent = kernelsVisible ? "Hide Kernels" : "Show Kernels";
    renderAfterControlChange();
  });

  diagramModeButton.addEventListener("click", () => {
    diagramMode = !diagramMode;
    diagramModeButton.textContent = diagramMode ? "Disable Diagram Mode" : "Enable Diagram Mode";
    renderAfterControlChange();
  });

  labelToggleButton.addEventListener("click", () => {
    labelsVisible = !labelsVisible;
    labelToggleButton.textContent = labelsVisible
      ? "Hide Dimension Labels"
      : "Show Dimension Labels";
    renderAfterControlChange();
  });

  backgroundModeSelect.addEventListener("change", renderAfterControlChange);
  backgroundColorInput.addEventListener("input", renderAfterControlChange);
  borderModeSelect.addEventListener("change", renderAfterControlChange);
  borderColorInput.addEventListener("input", renderAfterControlChange);
  opacityRangeInput.addEventListener("input", renderAfterControlChange);
  inputOpacityRangeInput.addEventListener("input", renderAfterControlChange);

  prepareExportButton.addEventListener("click", () => {
    exportPrepared = !exportPrepared;
    exportRow.hidden = !exportPrepared;
    prepareExportButton.textContent = exportPrepared ? "Close Export" : "Export";
    if (exportPrepared) {
      app.frameObject(pipeline.pipelineGroup, 1.4);
    }
  });

  exportPngButton.addEventListener("click", () => {
    const dataUrl = app.exportRaster("png");
    triggerDownloadFromDataUrl(dataUrl, "cnn-diagram.png");
  });

  exportJpegButton.addEventListener("click", () => {
    const dataUrl = app.exportRaster("jpeg", 0.95);
    triggerDownloadFromDataUrl(dataUrl, "cnn-diagram.jpg");
  });

  exportSvgButton.addEventListener("click", () => {
    exportSvg(app);
  });

  renderAfterControlChange();
}

const app = new SceneApp({
  background: SCENE_CONFIG.background,
  cameraPosition: SCENE_CONFIG.cameraPosition
});

const pipeline = buildPipeline(app);
setupControls(app, pipeline);
app.frameObject(pipeline.pipelineGroup, 1.35);
app.start();
