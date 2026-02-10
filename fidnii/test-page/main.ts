// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { Niivue, SLICE_TYPE } from "@niivue/niivue";
import { fromNgffZarr } from "@fideus-labs/ngff-zarr/browser";
import { OMEZarrNVImage } from "@fideus-labs/fidnii";

declare global {
  interface Window {
    image: OMEZarrNVImage;
    nv: Niivue;
    nv2: Niivue;
  }
}

const DATA_URL = "https://ome-zarr-scivis.s3.us-east-1.amazonaws.com/v0.5/96x2/beechnut.ome.zarr";

// DOM elements — info panel
const statusEl = document.getElementById("status")!;
const numLevelsEl = document.getElementById("num-levels")!;
const currentLevelEl = document.getElementById("current-level")!;
const targetLevelEl = document.getElementById("target-level")!;
const boundsXEl = document.getElementById("bounds-x")!;
const boundsYEl = document.getElementById("bounds-y")!;
const boundsZEl = document.getElementById("bounds-z")!;
const clipPlaneCountEl = document.getElementById("clip-plane-count")!;

// DOM elements — controls
const maxpixelsSlider = document.getElementById("maxpixels") as HTMLInputElement;
const maxpixelsValueEl = document.getElementById("maxpixels-value")!;
const reloadBtn = document.getElementById("reload")!;
const resetClipPlanesBtn = document.getElementById("reset-clip-planes")!;
const sliceTypeSelect = document.getElementById("slice-type") as HTMLSelectElement;
const slabLevelEl = document.getElementById("slab-level")!;
const slabRangeEl = document.getElementById("slab-range")!;
const gl2LabelEl = document.getElementById("gl2-label")!;
const viewportAwareCheckbox = document.getElementById("viewport-aware") as HTMLInputElement;

// Clip plane sliders (6 axis-aligned)
const sliders = {
  xmin: document.getElementById("xmin") as HTMLInputElement,
  xmax: document.getElementById("xmax") as HTMLInputElement,
  ymin: document.getElementById("ymin") as HTMLInputElement,
  ymax: document.getElementById("ymax") as HTMLInputElement,
  zmin: document.getElementById("zmin") as HTMLInputElement,
  zmax: document.getElementById("zmax") as HTMLInputElement,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBounds(min: number, max: number): string {
  const range = Math.abs(max - min);
  const decimals = range < 1 ? 6 : 2;
  return `[${min.toFixed(decimals)}, ${max.toFixed(decimals)}]`;
}

/** Configure all 6 slider ranges from the volume bounds and reset to extremes. */
function configureSlidersFromBounds(bounds: { min: number[]; max: number[] }): void {
  const axes: Array<{ min: string; max: string; axis: number; isMax: boolean }> = [
    { min: "xmin", max: "xmax", axis: 0, isMax: false },
    { min: "xmin", max: "xmax", axis: 0, isMax: true },
    { min: "ymin", max: "ymax", axis: 1, isMax: false },
    { min: "ymin", max: "ymax", axis: 1, isMax: true },
    { min: "zmin", max: "zmax", axis: 2, isMax: false },
    { min: "zmin", max: "zmax", axis: 2, isMax: true },
  ];

  for (const { axis, isMax } of axes) {
    const key = isMax
      ? (["xmax", "ymax", "zmax"] as const)[axis]
      : (["xmin", "ymin", "zmin"] as const)[axis];
    const slider = sliders[key];
    slider.min = String(bounds.min[axis]);
    slider.max = String(bounds.max[axis]);
    // "min" sliders default to their minimum (inactive); "max" sliders default to their maximum (inactive)
    slider.value = isMax ? String(bounds.max[axis]) : String(bounds.min[axis]);
    slider.step = "any";
  }
}

/** Build clip planes array from the current slider positions. */
function buildClipPlanesFromSliders(bounds: { min: number[]; max: number[] }): Array<{
  point: [number, number, number];
  normal: [number, number, number];
}> {
  const planes: Array<{ point: [number, number, number]; normal: [number, number, number] }> = [];

  const center: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];

  // Tolerance: slider must move meaningfully away from the extreme to activate
  const eps = [
    (bounds.max[0] - bounds.min[0]) * 1e-6,
    (bounds.max[1] - bounds.min[1]) * 1e-6,
    (bounds.max[2] - bounds.min[2]) * 1e-6,
  ];

  // xmin — clips from below on X, normal +X
  const xminVal = parseFloat(sliders.xmin.value);
  if (xminVal > bounds.min[0] + eps[0]) {
    planes.push({ point: [xminVal, center[1], center[2]], normal: [1, 0, 0] });
  }

  // xmax — clips from above on X, normal -X
  const xmaxVal = parseFloat(sliders.xmax.value);
  if (xmaxVal < bounds.max[0] - eps[0]) {
    planes.push({ point: [xmaxVal, center[1], center[2]], normal: [-1, 0, 0] });
  }

  // ymin — clips from below on Y, normal +Y
  const yminVal = parseFloat(sliders.ymin.value);
  if (yminVal > bounds.min[1] + eps[1]) {
    planes.push({ point: [center[0], yminVal, center[2]], normal: [0, 1, 0] });
  }

  // ymax — clips from above on Y, normal -Y
  const ymaxVal = parseFloat(sliders.ymax.value);
  if (ymaxVal < bounds.max[1] - eps[1]) {
    planes.push({ point: [center[0], ymaxVal, center[2]], normal: [0, -1, 0] });
  }

  // zmin — clips from below on Z, normal +Z
  const zminVal = parseFloat(sliders.zmin.value);
  if (zminVal > bounds.min[2] + eps[2]) {
    planes.push({ point: [center[0], center[1], zminVal], normal: [0, 0, 1] });
  }

  // zmax — clips from above on Z, normal -Z
  const zmaxVal = parseFloat(sliders.zmax.value);
  if (zmaxVal < bounds.max[2] - eps[2]) {
    planes.push({ point: [center[0], center[1], zmaxVal], normal: [0, 0, -1] });
  }

  return planes;
}

/** Apply slider-derived clip planes to the image. */
function applyClipPlanesFromSliders(): void {
  const image = window.image;
  if (!image) return;

  const bounds = image.getVolumeBounds();
  const planes = buildClipPlanesFromSliders(bounds);

  if (planes.length === 0) {
    image.clearClipPlanes();
  } else {
    image.setClipPlanes(planes);
  }

  clipPlaneCountEl.textContent = String(image.getClipPlanes().length);
}

function updateInfoPanel(image: OMEZarrNVImage): void {
  numLevelsEl.textContent = String(image.getNumLevels());
  currentLevelEl.textContent = String(image.getCurrentLevelIndex());
  targetLevelEl.textContent = String(image.getTargetLevelIndex());

  const bounds = image.getVolumeBounds();
  boundsXEl.textContent = formatBounds(bounds.min[0], bounds.max[0]);
  boundsYEl.textContent = formatBounds(bounds.min[1], bounds.max[1]);
  boundsZEl.textContent = formatBounds(bounds.min[2], bounds.max[2]);

  clipPlaneCountEl.textContent = String(image.getClipPlanes().length);

  // Configure slider ranges from volume bounds
  configureSlidersFromBounds(bounds);
}

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

async function loadImage(nv: Niivue, nv2: Niivue, maxPixels: number): Promise<OMEZarrNVImage> {
  statusEl.textContent = "Loading...";

  // Remove existing volumes from both NV instances
  while (nv.volumes.length > 0) {
    nv.removeVolume(nv.volumes[0]);
  }
  while (nv2.volumes.length > 0) {
    nv2.removeVolume(nv2.volumes[0]);
  }

  const multiscales = await fromNgffZarr(DATA_URL);

  const image = await OMEZarrNVImage.create({
    multiscales,
    niivue: nv,
    maxPixels,
    autoLoad: false,
  });

  nv.addVolume(image);

  // Attach the second NV instance for slice-type-aware rendering
  image.attachNiivue(nv2);

  // Listen for populateComplete — fires when all loading finishes
  image.addEventListener("populateComplete", () => {
    statusEl.textContent = "Ready";
    updateInfoPanel(image);
  });

  // Listen for resolutionChange — update level displays during progressive loading
  image.addEventListener("resolutionChange", () => {
    currentLevelEl.textContent = String(image.getCurrentLevelIndex());
    targetLevelEl.textContent = String(image.getTargetLevelIndex());
  });

  // Listen for slab loading events — update slab info display
  image.addEventListener("slabLoadingComplete", (event) => {
    const detail = event.detail;
    const sliceTypeName = SLICE_TYPE[detail.sliceType] ?? String(detail.sliceType);
    slabLevelEl.textContent = `${detail.levelIndex} (${sliceTypeName})`;
    slabRangeEl.textContent = `[${detail.slabStart}, ${detail.slabEnd})`;
  });

  // Start progressive loading
  image.populateVolume().catch((err: unknown) => {
    console.error("[fidnii test-page] populateVolume error:", err);
  });

  return image;
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

// --- Slider: maxpixels ---
maxpixelsSlider.addEventListener("input", () => {
  maxpixelsValueEl.textContent = maxpixelsSlider.value;
});

// --- Clip plane sliders ---
for (const slider of Object.values(sliders)) {
  slider.addEventListener("input", () => {
    applyClipPlanesFromSliders();
  });
}

// --- Reset clip planes ---
resetClipPlanesBtn.addEventListener("click", () => {
  const image = window.image;
  if (!image) return;

  image.clearClipPlanes();
  clipPlaneCountEl.textContent = "0";

  // Reset all sliders to their extremes (inactive position)
  const bounds = image.getVolumeBounds();
  configureSlidersFromBounds(bounds);
});

// --- Slice type selector ---
sliceTypeSelect.addEventListener("change", () => {
  const nv2 = window.nv2;
  if (!nv2) return;

  const value = parseInt(sliceTypeSelect.value, 10);
  nv2.setSliceType(value);

  // Update the canvas label
  const labels: Record<number, string> = {
    [SLICE_TYPE.RENDER]: "Render",
    [SLICE_TYPE.AXIAL]: "Axial",
    [SLICE_TYPE.CORONAL]: "Coronal",
    [SLICE_TYPE.SAGITTAL]: "Sagittal",
    [SLICE_TYPE.MULTIPLANAR]: "Multiplanar",
  };
  gl2LabelEl.textContent = labels[value] ?? "Unknown";
});

// --- Viewport-aware checkbox ---
viewportAwareCheckbox.addEventListener("change", () => {
  const image = window.image;
  if (!image) return;
  image.setViewportAware(viewportAwareCheckbox.checked);
});

// --- Reload button ---
reloadBtn.addEventListener("click", async () => {
  const nv = window.nv;
  const nv2 = window.nv2;
  const maxPixels = parseInt(maxpixelsSlider.value, 10) * 1_000_000;
  const image = await loadImage(nv, nv2, maxPixels);
  window.image = image;
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const canvas = document.getElementById("gl") as HTMLCanvasElement;
  const canvas2 = document.getElementById("gl2") as HTMLCanvasElement;

  // Create primary NV instance (3D render mode)
  const nv = new Niivue({ backColor: [0, 0, 0, 1] });
  await nv.attachToCanvas(canvas);
  nv.setSliceType(nv.sliceTypeRender);

  // Create secondary NV instance (2D slice mode, no crosshairs)
  const nv2 = new Niivue({ backColor: [0, 0, 0, 1], crosshairWidth: 0 });
  await nv2.attachToCanvas(canvas2);
  nv2.setSliceType(nv2.sliceTypeAxial);

  // Sync crosshair between the two NV instances (bidirectional)
  nv.broadcastTo(nv2, { "2d": true, "3d": true });
  nv2.broadcastTo(nv, { "2d": true, "3d": true });

  window.nv = nv;
  window.nv2 = nv2;

  const image = await loadImage(nv, nv2, 4_000_000);
  window.image = image;
}

main();
