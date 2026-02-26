import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const DEFAULT_CAMERA_NEAR = 0.05;
const DEFAULT_CAMERA_FAR = 60000;
const MAX_CAMERA_FAR = 500000;
const MIN_CAMERA_FAR = 30000;
const MAX_ORBIT_DISTANCE = 120000;
const DEFAULT_EXPORT_TILE_SIZE = 2048;
const MAX_EXPORT_TILE_SIZE = 8192;

/**
 * Small app shell that owns renderer, scene, camera, controls and resize loop.
 */
export class SceneApp {
  /**
   * @param {object} options - Scene app options.
   * @param {HTMLElement} [options.container=document.body] - DOM mount point.
   * @param {number} [options.background=0x0f1624] - Scene background color.
   * @param {THREE.Vector3} [options.cameraPosition] - Initial camera position.
   */
  constructor({
    container = document.body,
    background = 0x0f1624,
    cameraPosition = new THREE.Vector3(0, 0, 260)
  } = {}) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      DEFAULT_CAMERA_NEAR,
      DEFAULT_CAMERA_FAR
    );
    this.camera.position.copy(cameraPosition);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.zoomSpeed = 0.75;
    this.controls.maxDistance = MAX_ORBIT_DISTANCE;
    this.syncCameraClipping({ force: true });

    this.addDefaultLights();
    this.setBackground(background, false);

    this.onResize = this.onResize.bind(this);
    window.addEventListener("resize", this.onResize);
  }

  addDefaultLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.05));

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(60, 80, 120);
    this.scene.add(keyLight);
  }

  add(...objects) {
    for (const object of objects) {
      this.scene.add(object);
    }
  }

  start() {
    const animate = () => {
      this.controls.update();
      this.syncCameraClipping();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(animate);
    };

    animate();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  renderFrame() {
    this.controls.update();
    this.syncCameraClipping();
    this.renderer.render(this.scene, this.camera);
  }

  syncCameraClipping({ force = false, maxObjectSize = 0 } = {}) {
    const distance = this.camera.position.distanceTo(this.controls.target);
    const safeDistance = Number.isFinite(distance) ? Math.max(distance, 1) : 1;

    const desiredNear = THREE.MathUtils.clamp(safeDistance / 5000, DEFAULT_CAMERA_NEAR, 8);
    const desiredFar = THREE.MathUtils.clamp(
      Math.max(DEFAULT_CAMERA_FAR, MIN_CAMERA_FAR, safeDistance * 40 + maxObjectSize * 8),
      MIN_CAMERA_FAR,
      MAX_CAMERA_FAR
    );

    const nearEpsilon = Math.max(0.005, this.camera.near * 0.08);
    const farEpsilon = Math.max(30, this.camera.far * 0.015);

    if (
      force ||
      Math.abs(this.camera.near - desiredNear) > nearEpsilon ||
      Math.abs(this.camera.far - desiredFar) > farEpsilon
    ) {
      this.camera.near = desiredNear;
      this.camera.far = desiredFar;
      this.camera.updateProjectionMatrix();
    }
  }

  setBackground(background, render = true) {
    if (background == null) {
      this.scene.background = null;
      this.renderer.setClearAlpha(0);
    } else {
      const color = new THREE.Color(background);
      this.scene.background = color;
      this.renderer.setClearColor(color, 1);
    }

    if (render) {
      this.renderFrame();
    }
  }

  frameObject(target, padding = 1.25) {
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) {
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z);

    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const fitHeightDistance = (maxSize * 0.5) / Math.tan(halfFov);
    const fitWidthDistance = fitHeightDistance / this.camera.aspect;
    const distance = padding * Math.max(fitHeightDistance, fitWidthDistance, size.z);

    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center.clone().add(direction.multiplyScalar(distance)));
    this.syncCameraClipping({ force: true, maxObjectSize: maxSize });
    this.controls.update();
    this.renderFrame();
  }

  exportRaster(formatOrOptions = "png", quality = 0.92) {
    const options =
      typeof formatOrOptions === "object" && formatOrOptions !== null
        ? formatOrOptions
        : { format: formatOrOptions, quality };

    const format = options.format ?? "png";
    const exportQuality = options.quality ?? 0.92;
    const width = Number.isFinite(options.width) ? Math.max(1, Math.round(options.width)) : null;
    const height = Number.isFinite(options.height) ? Math.max(1, Math.round(options.height)) : null;
    const tiled = options.tiled;
    const crop = this.normalizeExportCrop(options.crop);
    const requestedTileSize = Number.isFinite(options.tileSize)
      ? Math.max(1, Math.round(options.tileSize))
      : null;

    const mimeType =
      format === "jpeg" || format === "jpg" ? "image/jpeg" : "image/png";

    if (!width || !height) {
      this.renderFrame();
      if (mimeType === "image/jpeg") {
        return this.renderer.domElement.toDataURL(mimeType, exportQuality);
      }
      return this.renderer.domElement.toDataURL(mimeType);
    }

    const currentViewportSize = this.renderer.getSize(new THREE.Vector2());
    const projectionWindow = this.resolveProjectionWindow({
      outputWidth: width,
      outputHeight: height,
      viewportWidth: currentViewportSize.x,
      viewportHeight: currentViewportSize.y,
      crop
    });

    const maxRenderDimension = this.getMaxRenderDimension();
    const tileSize = Math.min(
      width,
      height,
      maxRenderDimension,
      requestedTileSize ?? DEFAULT_EXPORT_TILE_SIZE,
      MAX_EXPORT_TILE_SIZE
    );
    const autoTileDimensionThreshold = Math.min(maxRenderDimension, DEFAULT_EXPORT_TILE_SIZE * 2);

    const shouldUseTiledPngExport =
      mimeType === "image/png" &&
      tileSize > 0 &&
      (
        tiled === true ||
        (
          tiled !== false &&
          (
            width > maxRenderDimension ||
            height > maxRenderDimension ||
            width > autoTileDimensionThreshold ||
            height > autoTileDimensionThreshold
          )
        )
      );

    if (shouldUseTiledPngExport) {
      return this.exportRasterTiledPng({
        width,
        height,
        tileSize,
        projectionWindow
      });
    }

    const previousSize = this.renderer.getSize(new THREE.Vector2());
    const previousPixelRatio = this.renderer.getPixelRatio();
    const previousAspect = this.camera.aspect;
    const previousView = this.camera.view ? { ...this.camera.view } : null;

    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = projectionWindow.fullWidth / projectionWindow.fullHeight;
      this.camera.setViewOffset(
        projectionWindow.fullWidth,
        projectionWindow.fullHeight,
        projectionWindow.offsetX,
        projectionWindow.offsetY,
        projectionWindow.width,
        projectionWindow.height
      );
      this.camera.updateProjectionMatrix();

      this.controls.update();
      this.renderer.render(this.scene, this.camera);

      if (mimeType === "image/jpeg") {
        return this.renderer.domElement.toDataURL(mimeType, exportQuality);
      }
      return this.renderer.domElement.toDataURL(mimeType);
    } finally {
      this.renderer.setPixelRatio(previousPixelRatio);
      this.renderer.setSize(previousSize.x, previousSize.y, false);
      this.camera.aspect = previousAspect;
      this.restoreCameraView(previousView);
      this.camera.updateProjectionMatrix();
      this.renderFrame();
    }
  }

  normalizeExportCrop(crop) {
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

    const x = THREE.MathUtils.clamp(parsedX, 0, 1);
    const y = THREE.MathUtils.clamp(parsedY, 0, 1);
    const width = THREE.MathUtils.clamp(parsedWidth, 0, 1 - x);
    const height = THREE.MathUtils.clamp(parsedHeight, 0, 1 - y);

    if (width <= 0 || height <= 0) {
      return null;
    }

    return { x, y, width, height };
  }

  resolveProjectionWindow({
    outputWidth,
    outputHeight,
    viewportWidth,
    viewportHeight,
    crop
  }) {
    if (!crop) {
      return {
        fullWidth: outputWidth,
        fullHeight: outputHeight,
        offsetX: 0,
        offsetY: 0,
        width: outputWidth,
        height: outputHeight
      };
    }

    const fullWidth = Math.max(1, Number.isFinite(viewportWidth) ? viewportWidth : outputWidth);
    const fullHeight = Math.max(1, Number.isFinite(viewportHeight) ? viewportHeight : outputHeight);

    const offsetX = crop.x * fullWidth;
    const offsetY = crop.y * fullHeight;
    const width = Math.max(1e-6, crop.width * fullWidth);
    const height = Math.max(1e-6, crop.height * fullHeight);

    return {
      fullWidth,
      fullHeight,
      offsetX,
      offsetY,
      width,
      height
    };
  }

  resolveProjectionWindowTile({
    projectionWindow,
    outputWidth,
    outputHeight,
    tileOffsetX,
    tileOffsetY,
    tileWidth,
    tileHeight
  }) {
    const scaleX = projectionWindow.width / outputWidth;
    const scaleY = projectionWindow.height / outputHeight;

    return {
      fullWidth: projectionWindow.fullWidth,
      fullHeight: projectionWindow.fullHeight,
      offsetX: projectionWindow.offsetX + tileOffsetX * scaleX,
      offsetY: projectionWindow.offsetY + tileOffsetY * scaleY,
      width: Math.max(1e-6, tileWidth * scaleX),
      height: Math.max(1e-6, tileHeight * scaleY)
    };
  }

  getMaxRenderDimension() {
    const fallback = 4096;
    const context = this.renderer.getContext();
    if (!context) {
      return fallback;
    }

    const maxTextureSize = this.renderer.capabilities?.maxTextureSize ?? fallback;
    const maxRenderBufferSize = context.getParameter(context.MAX_RENDERBUFFER_SIZE) ?? fallback;
    const maxViewportDims = context.getParameter(context.MAX_VIEWPORT_DIMS);
    const maxViewportWidth = Array.isArray(maxViewportDims) || ArrayBuffer.isView(maxViewportDims)
      ? maxViewportDims[0]
      : fallback;
    const maxViewportHeight = Array.isArray(maxViewportDims) || ArrayBuffer.isView(maxViewportDims)
      ? maxViewportDims[1]
      : fallback;

    const safeValue = Math.min(
      maxTextureSize,
      maxRenderBufferSize,
      maxViewportWidth,
      maxViewportHeight
    );

    return Number.isFinite(safeValue) && safeValue > 0 ? Math.floor(safeValue) : fallback;
  }

  restoreCameraView(previousView) {
    if (!previousView?.enabled) {
      this.camera.clearViewOffset();
      return;
    }

    this.camera.setViewOffset(
      previousView.fullWidth,
      previousView.fullHeight,
      previousView.offsetX,
      previousView.offsetY,
      previousView.width,
      previousView.height
    );
  }

  exportRasterTiledPng({ width, height, tileSize, projectionWindow }) {
    const previousSize = this.renderer.getSize(new THREE.Vector2());
    const previousPixelRatio = this.renderer.getPixelRatio();
    const previousAspect = this.camera.aspect;
    const previousView = this.camera.view ? { ...this.camera.view } : null;

    const stitchedCanvas = document.createElement("canvas");
    stitchedCanvas.width = width;
    stitchedCanvas.height = height;

    if (stitchedCanvas.width !== width || stitchedCanvas.height !== height) {
      throw new Error(
        `Requested export resolution ${width}x${height} exceeds this browser's 2D canvas limits.`
      );
    }

    const stitchedContext = stitchedCanvas.getContext("2d", { alpha: true });
    if (!stitchedContext) {
      throw new Error("Unable to allocate 2D canvas context for tiled export.");
    }

    try {
      this.renderer.setPixelRatio(1);
      this.camera.aspect = projectionWindow.fullWidth / projectionWindow.fullHeight;
      this.camera.updateProjectionMatrix();

      this.controls.update();
      this.syncCameraClipping();

      for (let yOffset = 0; yOffset < height; yOffset += tileSize) {
        const tileHeight = Math.min(tileSize, height - yOffset);

        for (let xOffset = 0; xOffset < width; xOffset += tileSize) {
          const tileWidth = Math.min(tileSize, width - xOffset);
          const tileProjectionWindow = this.resolveProjectionWindowTile({
            projectionWindow,
            outputWidth: width,
            outputHeight: height,
            tileOffsetX: xOffset,
            tileOffsetY: yOffset,
            tileWidth,
            tileHeight
          });

          this.renderer.setSize(tileWidth, tileHeight, false);
          this.camera.setViewOffset(
            tileProjectionWindow.fullWidth,
            tileProjectionWindow.fullHeight,
            tileProjectionWindow.offsetX,
            tileProjectionWindow.offsetY,
            tileProjectionWindow.width,
            tileProjectionWindow.height
          );

          this.renderer.render(this.scene, this.camera);
          stitchedContext.drawImage(
            this.renderer.domElement,
            0,
            0,
            tileWidth,
            tileHeight,
            xOffset,
            yOffset,
            tileWidth,
            tileHeight
          );
        }
      }

      this.camera.clearViewOffset();
      return stitchedCanvas.toDataURL("image/png");
    } finally {
      this.restoreCameraView(previousView);
      this.renderer.setPixelRatio(previousPixelRatio);
      this.renderer.setSize(previousSize.x, previousSize.y, false);
      this.camera.aspect = previousAspect;
      this.camera.updateProjectionMatrix();
      this.renderFrame();
    }
  }
}
