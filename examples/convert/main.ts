/**
 * Convert to OME-Zarr - Main UI module
 */

import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/option/option.js";
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";
import "@awesome.me/webawesome/dist/components/select/select.js";

import { Niivue } from "@niivue/niivue";
import { OMEZarrNVImage } from "@fideus-labs/fidnii";
import {
  type ConversionProgress,
  type ConversionResult,
  convertToOmeZarr,
  downloadFile,
  formatFileSize,
  getMultiscalesInfo,
} from "./converter.ts";

// DOM Elements
const dropZone = document.getElementById("drop-zone") as HTMLDivElement;
const browseBtn = document.getElementById("browse-btn") as HTMLElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const fileInfo = document.getElementById("file-info") as HTMLDivElement;
const convertBtn = document.getElementById("convert-btn") as HTMLElement;
const downloadBtn = document.getElementById("download-btn") as HTMLElement;
const progressContainer = document.getElementById(
  "progress-container",
) as HTMLDivElement;
const progressBar = document.getElementById("progress-bar") as HTMLElement;
const progressText = document.getElementById("progress-text") as HTMLElement;
const placeholder = document.getElementById("placeholder") as HTMLDivElement;
const canvas = document.getElementById("gl") as HTMLCanvasElement;
const multiscalesCard = document.getElementById(
  "multiscales-card",
) as HTMLElement;
const multiscalesTable = document.getElementById(
  "multiscales-table",
) as HTMLTableElement;

// Settings inputs
const chunkSizeInput = document.getElementById(
  "chunk-size",
) as HTMLInputElement;
const scaleLevelsInput = document.getElementById(
  "scale-levels",
) as HTMLInputElement;
const colormapSelect = document.getElementById("colormap") as HTMLSelectElement;
const opacityInput = document.getElementById("opacity") as HTMLInputElement;

// State
let selectedFile: File | null = null;
let lastResult: ConversionResult | null = null;
let nv: Niivue | null = null;

// Initialize NiiVue
function initNiivue(): void {
  if (nv) return;

  nv = new Niivue({
    show3Dcrosshair: true,
    backColor: [0, 0, 0, 1],
  });
  nv.attachToCanvas(canvas);
}

// File handling
function handleFile(file: File): void {
  selectedFile = file;
  fileInfo.textContent = `${file.name} (${formatFileSize(file.size)})`;
  convertBtn.removeAttribute("disabled");
  downloadBtn.classList.add("hidden");
  lastResult = null;

  // Reset multiscales table
  multiscalesCard.classList.add("hidden");
}

// Drag and drop
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    handleFile(files[0]);
  }
});

// Browse button
browseBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  const files = fileInput.files;
  if (files && files.length > 0) {
    handleFile(files[0]);
  }
});

// Progress handling
function updateProgress(progress: ConversionProgress): void {
  progressBar.setAttribute("value", String(progress.percent));
  progressText.textContent = progress.message;
}

// Preview with NiiVue
async function showPreview(result: ConversionResult): Promise<void> {
  initNiivue();
  if (!nv) return;

  placeholder.style.display = "none";

  // Get settings
  const colormap = (colormapSelect as unknown as { value: string }).value ||
    "gray";
  const opacity = parseFloat(
    (opacityInput as unknown as { value: string }).value || "1.0",
  );

  // Create NVImage from multiscales
  const image = await OMEZarrNVImage.create({
    multiscales: result.multiscales,
    niivue: nv,
    autoLoad: false,
  });

  // Clear existing volumes and add new one
  nv.volumes = [];
  nv.addVolume(image);
  await image.populateVolume();

  // Apply settings AFTER data is loaded to avoid calMinMax() running on placeholder data
  image.colormap = colormap;
  image.opacity = opacity;
}

// Update multiscales table
function updateMultiscalesTable(result: ConversionResult): void {
  const info = getMultiscalesInfo(result.multiscales);
  const tbody = multiscalesTable.querySelector(
    "tbody",
  ) as HTMLTableSectionElement;
  tbody.innerHTML = "";

  for (const scale of info) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${scale.level}</td>
      <td class="mono">${scale.path}</td>
      <td class="mono">${scale.shape}</td>
      <td class="mono">${scale.chunks}</td>
      <td>${scale.size}</td>
    `;
    tbody.appendChild(row);
  }

  multiscalesCard.classList.remove("hidden");
}

// Convert button
convertBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  // Disable convert button during conversion
  convertBtn.setAttribute("disabled", "");
  progressContainer.classList.add("visible");

  try {
    const options = {
      chunkSize: parseInt(
        (chunkSizeInput as unknown as { value: string }).value || "64",
        10,
      ),
      scaleLevels: parseInt(
        (scaleLevelsInput as unknown as { value: string }).value || "0",
        10,
      ),
    };

    lastResult = await convertToOmeZarr(selectedFile, options, updateProgress);

    // Show preview
    await showPreview(lastResult);

    // Update table
    updateMultiscalesTable(lastResult);

    // Auto-download
    downloadFile(lastResult.ozxData, lastResult.filename);

    // Enable download again button
    downloadBtn.classList.remove("hidden");
  } catch (error) {
    console.error("Conversion failed:", error);
    progressText.textContent = `Error: ${
      error instanceof Error ? error.message : String(error)
    }`;
  } finally {
    convertBtn.removeAttribute("disabled");
  }
});

// Download again button
downloadBtn.addEventListener("click", () => {
  if (lastResult) {
    downloadFile(lastResult.ozxData, lastResult.filename);
  }
});

// Settings change handlers for live preview updates
colormapSelect.addEventListener("wa-change", async () => {
  if (lastResult && nv && nv.volumes.length > 0) {
    const colormap = (colormapSelect as unknown as { value: string }).value ||
      "gray";
    nv.volumes[0].colormap = colormap;
    nv.updateGLVolume();
  }
});

opacityInput.addEventListener("wa-change", async () => {
  if (lastResult && nv && nv.volumes.length > 0) {
    const opacity = parseFloat(
      (opacityInput as unknown as { value: string }).value || "1.0",
    );
    nv.volumes[0].opacity = opacity;
    nv.updateGLVolume();
  }
});
