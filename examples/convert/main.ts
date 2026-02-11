/**
 * Convert to OME-Zarr - Main UI module
 */

import "@awesome.me/webawesome/dist/components/button/button.js"
import "@awesome.me/webawesome/dist/components/card/card.js"
import "@awesome.me/webawesome/dist/components/input/input.js"
import "@awesome.me/webawesome/dist/components/option/option.js"
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js"
import "@awesome.me/webawesome/dist/components/select/select.js"
import "@awesome.me/webawesome/dist/components/slider/slider.js"

import { Niivue, SLICE_TYPE } from "@niivue/niivue"
import { OMEZarrNVImage } from "@fideus-labs/fidnii"
import {
  type ConversionProgress,
  type ConversionResult,
  convertToOmeZarr,
  downloadFile,
  formatFileSize,
  getMultiscalesInfo,
  Methods,
} from "./converter.ts"
import type { Multiscales } from "@fideus-labs/ngff-zarr"

// Color scheme: follow the browser/OS preference
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function applyColorScheme(prefersDark: boolean): void {
  document.documentElement.classList.toggle("wa-dark", prefersDark)
}

applyColorScheme(darkQuery.matches);
darkQuery.addEventListener("change", (e) => applyColorScheme(e.matches));

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
) as HTMLInputElement
const methodSelect = document.getElementById("method") as HTMLSelectElement
const colormapSelect = document.getElementById("colormap") as HTMLSelectElement
const sliceTypeSelect = document.getElementById(
  "slice-type",
) as HTMLSelectElement
const opacitySlider = document.getElementById("opacity") as HTMLInputElement
const silhouetteSlider = document.getElementById(
  "silhouette",
) as HTMLInputElement

// State
let selectedFile: File | null = null
let lastResult: ConversionResult | null = null
let nv: Niivue | null = null

// Slice type string-to-enum mapping
const SLICE_TYPE_MAP: Record<string, SLICE_TYPE> = {
  axial: SLICE_TYPE.AXIAL,
  coronal: SLICE_TYPE.CORONAL,
  sagittal: SLICE_TYPE.SAGITTAL,
  multiplanar: SLICE_TYPE.MULTIPLANAR,
  render: SLICE_TYPE.RENDER,
}

/** Check whether the volume has a "z" spatial axis. */
function is3DVolume(multiscales: Multiscales): boolean {
  return multiscales.metadata.axes.some(
    (a) => a.name === "z" && a.type === "space",
  )
}

/** Read both sliders and push gradient settings into NiiVue. */
async function updateGradientSettings(): Promise<void> {
  if (!nv) return
  const opacity = parseFloat(
    (opacitySlider as unknown as { value: string }).value || "0.5",
  )
  const silhouette = parseFloat(
    (silhouetteSlider as unknown as { value: string }).value || "0",
  )
  await nv.setGradientOpacity(opacity, silhouette)
}

// Initialize NiiVue
function initNiivue(): void {
  if (nv) return

  nv = new Niivue({
    show3Dcrosshair: true,
    backColor: [0, 0, 0, 1],
  })
  nv.attachToCanvas(canvas)
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

/** Enable or disable the 3D-only preview controls. */
function set3DControlsEnabled(enabled: boolean): void {
  const controls = [opacitySlider, silhouetteSlider, sliceTypeSelect]
  for (const el of controls) {
    if (enabled) {
      el.removeAttribute("disabled")
    } else {
      el.setAttribute("disabled", "")
    }
  }
}

// Preview with NiiVue
async function showPreview(result: ConversionResult): Promise<void> {
  initNiivue()
  if (!nv) return

  placeholder.style.display = "none"

  const volumeIs3D = is3DVolume(result.multiscales)

  // Get colormap setting
  const colormap = (colormapSelect as unknown as { value: string }).value ||
    "gray"

  // Create NVImage from multiscales
  const image = await OMEZarrNVImage.create({
    multiscales: result.multiscales,
    niivue: nv,
    autoLoad: false,
  })

  // Clear existing volumes and add new one
  nv.volumes = []
  nv.addVolume(image)
  await image.populateVolume()

  // Apply colormap AFTER data is loaded to avoid calMinMax() on placeholder data
  image.colormap = colormap

  if (volumeIs3D) {
    set3DControlsEnabled(true)

    // Default to multiplanar for 3D volumes
    const sliceTypeStr =
      (sliceTypeSelect as unknown as { value: string }).value || "multiplanar"
    const sliceType = SLICE_TYPE_MAP[sliceTypeStr] ?? SLICE_TYPE.MULTIPLANAR

    // Set hero fraction BEFORE setSliceType so it takes effect on first draw
    nv.opts.heroImageFraction =
      sliceType === SLICE_TYPE.MULTIPLANAR ? 0.6 : 0
    nv.setSliceType(sliceType)
    await updateGradientSettings()
    nv.updateGLVolume()
  } else {
    set3DControlsEnabled(false)

    // 2D images: axial view, no gradient effects
    nv.opts.heroImageFraction = 0
    nv.setSliceType(SLICE_TYPE.AXIAL)
    await nv.setGradientOpacity(0, 0)
    nv.updateGLVolume()
  }
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
        (chunkSizeInput as unknown as { value: string }).value || "96",
        10,
      ),
      method: (
        (methodSelect as unknown as { value: string }).value ||
          "itkwasm_gaussian"
      ) as Methods,
    }

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

opacitySlider.addEventListener("input", () => {
  if (lastResult && nv && nv.volumes.length > 0) {
    updateGradientSettings()
  }
})

silhouetteSlider.addEventListener("input", () => {
  if (lastResult && nv && nv.volumes.length > 0) {
    updateGradientSettings()
  }
})

sliceTypeSelect.addEventListener("wa-change", () => {
  if (lastResult && nv && nv.volumes.length > 0) {
    const sliceTypeStr =
      (sliceTypeSelect as unknown as { value: string }).value || "multiplanar"
    const sliceType = SLICE_TYPE_MAP[sliceTypeStr] ?? SLICE_TYPE.MULTIPLANAR
    nv.setSliceType(sliceType)
    nv.opts.heroImageFraction =
      sliceType === SLICE_TYPE.MULTIPLANAR ? 0.6 : 0
    nv.updateGLVolume()
  }
})
