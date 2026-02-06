// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { Niivue } from "@niivue/niivue";
import { fromNgffZarr } from "@fideus-labs/ngff-zarr/browser";
import { OMEZarrNVImage } from "@fideus-labs/fidnii";

declare global {
  interface Window {
    image: OMEZarrNVImage;
    nv: Niivue;
  }
}

const DATA_URL = "https://ome-zarr-scivis.s3.us-east-1.amazonaws.com/v0.5/96x2/beechnut.ome.zarr";

// DOM elements
const statusEl = document.getElementById("status")!;
const numLevelsEl = document.getElementById("num-levels")!;
const boundsXEl = document.getElementById("bounds-x")!;
const boundsYEl = document.getElementById("bounds-y")!;
const boundsZEl = document.getElementById("bounds-z")!;
const maxpixelsSlider = document.getElementById("maxpixels") as HTMLInputElement;
const maxpixelsValueEl = document.getElementById("maxpixels-value")!;
const reloadBtn = document.getElementById("reload")!;
const clipPlaneCountEl = document.getElementById("clip-plane-count")!;
const xminSlider = document.getElementById("xmin") as HTMLInputElement;
const resetClipPlanesBtn = document.getElementById("reset-clip-planes")!;

function formatBounds(min: number, max: number): string {
  // Use enough precision to distinguish small world coordinates
  const range = Math.abs(max - min);
  const decimals = range < 1 ? 6 : 2;
  return `[${min.toFixed(decimals)}, ${max.toFixed(decimals)}]`;
}

function updateInfoPanel(image: OMEZarrNVImage): void {
  numLevelsEl.textContent = String(image.getNumLevels());

  const bounds = image.getVolumeBounds();
  boundsXEl.textContent = formatBounds(bounds.min[0], bounds.max[0]);
  boundsYEl.textContent = formatBounds(bounds.min[1], bounds.max[1]);
  boundsZEl.textContent = formatBounds(bounds.min[2], bounds.max[2]);

  clipPlaneCountEl.textContent = String(image.getClipPlanes().length);

  // Configure xmin slider range based on volume bounds
  xminSlider.min = String(bounds.min[0]);
  xminSlider.max = String(bounds.max[0]);
  xminSlider.value = String(bounds.min[0]);
}

async function loadImage(nv: Niivue, maxPixels: number): Promise<OMEZarrNVImage> {
  statusEl.textContent = "Loading...";

  // Remove existing volumes
  while (nv.volumes.length > 0) {
    nv.removeVolume(nv.volumes[0]);
  }

  const multiscales = await fromNgffZarr(DATA_URL);

  // Use autoLoad: false so we can attach event listener before loading starts
  const image = await OMEZarrNVImage.create({
    multiscales,
    niivue: nv,
    maxPixels,
    autoLoad: false,
  });

  // Manually add to NiiVue and start progressive loading
  nv.addVolume(image);

  // Listen for populateComplete — fires when all loading finishes (even on error)
  image.addEventListener("populateComplete", () => {
    statusEl.textContent = "Ready";
    updateInfoPanel(image);
  });

  // Start progressive loading (fire-and-forget; catch to prevent unhandled rejection)
  image.populateVolume().catch((err: unknown) => {
    console.error("[fidnii test-page] populateVolume error:", err);
  });

  return image;
}

// --- Slider: maxpixels ---
maxpixelsSlider.addEventListener("input", () => {
  maxpixelsValueEl.textContent = maxpixelsSlider.value;
});

// --- X Min clip plane slider ---
xminSlider.addEventListener("input", () => {
  const image = window.image;
  if (!image) return;

  const bounds = image.getVolumeBounds();
  const xmin = parseFloat(xminSlider.value);

  // If slider is at the volume minimum, clear clip planes
  if (xmin <= bounds.min[0]) {
    image.clearClipPlanes();
    clipPlaneCountEl.textContent = "0";
    return;
  }

  // Create a clip plane at the slider position
  const centerY = (bounds.min[1] + bounds.max[1]) / 2;
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2;

  image.setClipPlanes([
    { point: [xmin, centerY, centerZ], normal: [1, 0, 0] as [number, number, number] },
  ]);

  clipPlaneCountEl.textContent = String(image.getClipPlanes().length);
});

// --- Reset clip planes ---
resetClipPlanesBtn.addEventListener("click", () => {
  const image = window.image;
  if (!image) return;

  image.clearClipPlanes();
  clipPlaneCountEl.textContent = "0";

  // Reset xmin slider to minimum
  const bounds = image.getVolumeBounds();
  xminSlider.value = String(bounds.min[0]);
});

// --- Reload button ---
reloadBtn.addEventListener("click", async () => {
  const nv = window.nv;
  const maxPixels = parseInt(maxpixelsSlider.value, 10) * 1_000_000;
  const image = await loadImage(nv, maxPixels);
  window.image = image;
});

// --- Main ---
async function main() {
  const canvas = document.getElementById("gl") as HTMLCanvasElement;

  const nv = new Niivue({ backColor: [0, 0, 0, 1] });
  await nv.attachToCanvas(canvas);
  nv.setSliceType(nv.sliceTypeRender);

  window.nv = nv;

  const image = await loadImage(nv, 4_000_000);
  window.image = image;
}

main();
