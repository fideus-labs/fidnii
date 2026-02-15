/**
 * Image Converter - Main UI module
 */

import "@awesome.me/webawesome/dist/components/button/button.js"
import "@awesome.me/webawesome/dist/components/card/card.js"
import "@awesome.me/webawesome/dist/components/input/input.js"
import "@awesome.me/webawesome/dist/components/option/option.js"
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js"
import "@awesome.me/webawesome/dist/components/select/select.js"
import "@awesome.me/webawesome/dist/components/slider/slider.js"

import { getChannelInfo, OMEZarrNVImage } from "@fideus-labs/fidnii"
import type { Multiscales } from "@fideus-labs/ngff-zarr"
import { Niivue, SLICE_TYPE } from "@niivue/niivue"

import {
  type ConversionProgress,
  type ConversionResult,
  convertImage,
  downloadFile,
  exportMultiscales,
  fetchImageFile,
  formatFileSize,
  getMultiscalesInfo,
  isOmeZarrUrl,
  loadOmeZarrUrl,
  Methods,
  OUTPUT_FORMAT_LABELS,
  OUTPUT_FORMATS,
  type OutputFormat,
} from "./converter.ts"

// Color scheme: follow the browser/OS preference
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)")

function applyColorScheme(prefersDark: boolean): void {
  document.documentElement.classList.toggle("wa-dark", prefersDark)
}

applyColorScheme(darkQuery.matches)
darkQuery.addEventListener("change", (e) => applyColorScheme(e.matches))

// DOM Elements
const dropZone = document.getElementById("drop-zone") as HTMLDivElement
const browseBtn = document.getElementById("browse-btn") as HTMLElement
const fileInput = document.getElementById("file-input") as HTMLInputElement
const fileInfo = document.getElementById("file-info") as HTMLDivElement
const convertBtn = document.getElementById("convert-btn") as HTMLElement
const progressContainer = document.getElementById(
  "progress-container",
) as HTMLDivElement
const progressBar = document.getElementById("progress-bar") as HTMLElement
const progressText = document.getElementById("progress-text") as HTMLElement
const placeholder = document.getElementById("placeholder") as HTMLDivElement
const canvas = document.getElementById("gl") as HTMLCanvasElement
const multiscalesCard = document.getElementById(
  "multiscales-card",
) as HTMLElement
const multiscalesTable = document.getElementById(
  "multiscales-table",
) as HTMLTableElement

// URL input elements
const urlInput = document.getElementById("url-input") as HTMLInputElement
const urlLoadBtn = document.getElementById("url-load-btn") as HTMLElement

// Settings inputs
const outputFormatSelect = document.getElementById(
  "output-format",
) as HTMLSelectElement
const chunkSizeInput = document.getElementById("chunk-size") as HTMLInputElement
const methodSelect = document.getElementById("method") as HTMLSelectElement
const colormapSelect = document.getElementById("colormap") as HTMLSelectElement
const sliceTypeSelect = document.getElementById(
  "slice-type",
) as HTMLSelectElement
const opacitySlider = document.getElementById("opacity") as HTMLInputElement
const silhouetteSlider = document.getElementById(
  "silhouette",
) as HTMLInputElement

/** File extensions that are known to produce 2D (single-slice) images. */
const IMAGE_2D_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".bmp",
  ".gif",
  ".tif",
  ".tiff",
  ".webp",
  ".svg",
])

const DEFAULT_CHUNK_SIZE_2D = "256"
const DEFAULT_CHUNK_SIZE_3D = "96"

// State
let selectedFile: File | null = null
let lastResult: ConversionResult | null = null
/** Multiscales loaded directly from an OME-Zarr URL (no conversion). */
let loadedMultiscales: Multiscales | null = null
/** Base name derived from the OME-Zarr URL (for output filenames). */
let loadedName = ""
let nv: Niivue | null = null
let currentImage: OMEZarrNVImage | null = null

// Slice type string-to-enum mapping
const SLICE_TYPE_MAP: Record<string, SLICE_TYPE> = {
  axial: SLICE_TYPE.AXIAL,
  coronal: SLICE_TYPE.CORONAL,
  sagittal: SLICE_TYPE.SAGITTAL,
  multiplanar: SLICE_TYPE.MULTIPLANAR,
  render: SLICE_TYPE.RENDER,
}

// Populate output format select from the canonical list
for (const format of OUTPUT_FORMATS) {
  const option = document.createElement("wa-option")
  option.setAttribute("value", format)
  option.textContent = OUTPUT_FORMAT_LABELS[format]
  outputFormatSelect.appendChild(option)
}

/** Check whether the volume has a "z" spatial axis. */
function is3DVolume(multiscales: Multiscales): boolean {
  return multiscales.metadata.axes.some(
    (a) => a.name === "z" && a.type === "space",
  )
}

/** Check whether the image is RGB or RGBA (has a "c" dimension with 3 or 4 components). */
function isRGBOrRGBA(multiscales: Multiscales): boolean {
  const firstImage = multiscales.images[0]
  if (!firstImage) return false
  const info = getChannelInfo(firstImage)
  return info !== null && (info.components === 3 || info.components === 4)
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
    show3Dcrosshair: false,
    crosshairWidth: 0,
    backColor: [0, 0, 0, 1],
  })
  nv.attachToCanvas(canvas)
}

/**
 * Get the currently selected output format from the UI.
 */
function getSelectedFormat(): OutputFormat {
  return ((outputFormatSelect as unknown as { value: string }).value ||
    "ozx") as OutputFormat
}

/**
 * Update the convert button label depending on the current state.
 *
 * - When an OME-Zarr URL is loaded (no conversion needed), the button
 *   reads "Export & Download".
 * - Otherwise it reads "Convert & Download".
 */
function updateConvertButtonLabel(): void {
  convertBtn.textContent =
    loadedMultiscales && !selectedFile
      ? "Export & Download"
      : "Convert & Download"
}

// File handling
function handleFile(file: File, { fromUrl = false } = {}): void {
  selectedFile = file
  loadedMultiscales = null
  loadedName = ""
  fileInfo.textContent = `${file.name} (${formatFileSize(file.size)})`
  convertBtn.removeAttribute("disabled")
  lastResult = null

  // Clear any stale ?url= param when loading a local file
  if (!fromUrl) {
    const currentUrl = new URL(window.location.href)
    if (currentUrl.searchParams.has("url")) {
      currentUrl.searchParams.delete("url")
      history.replaceState(null, "", currentUrl)
    }
  }

  // Reset multiscales table
  multiscalesCard.classList.add("hidden")

  // Use a larger default chunk size for 2D images
  const dotIndex = file.name.lastIndexOf(".")
  const ext = dotIndex !== -1 ? file.name.slice(dotIndex).toLowerCase() : ""
  const chunkDefault = IMAGE_2D_EXTENSIONS.has(ext)
    ? DEFAULT_CHUNK_SIZE_2D
    : DEFAULT_CHUNK_SIZE_3D
  ;(chunkSizeInput as unknown as { value: string }).value = chunkDefault

  updateConvertButtonLabel()
}

/**
 * Fetch an image from a remote URL and feed it into the UI.
 *
 * OME-Zarr URLs are loaded directly into the viewer without
 * conversion. Other URLs are fetched as files for later conversion.
 *
 * @param url - The remote URL to fetch
 */
async function handleUrl(url: string): Promise<void> {
  const trimmed = url.trim()
  if (!trimmed) return

  // Disable controls and show progress while loading
  urlLoadBtn.setAttribute("disabled", "")
  convertBtn.setAttribute("disabled", "")
  progressContainer.classList.add("visible")

  try {
    if (isOmeZarrUrl(trimmed)) {
      // --- OME-Zarr URL: load directly into the viewer ---
      selectedFile = null
      lastResult = null
      const multiscales = await loadOmeZarrUrl(trimmed, updateProgress)
      loadedMultiscales = multiscales
      loadedName = trimmed.replace(/\/+$/, "").split("/").pop() || "image"
      fileInfo.textContent = `OME-Zarr: ${loadedName}`

      // Show the multiscales table immediately and kick off
      // the preview in the background (progressive loading from
      // the remote store can be slow).
      updateMultiscalesTable({ multiscales })
      void showPreview({ multiscales })

      convertBtn.removeAttribute("disabled")
    } else {
      // --- Regular image URL: fetch as file ---
      const file = await fetchImageFile(trimmed, updateProgress)
      handleFile(file, { fromUrl: true })
    }

    // Update the browser URL so the current state is shareable
    const newUrl = new URL(window.location.href)
    newUrl.searchParams.set("url", trimmed)
    history.replaceState(null, "", newUrl)
  } catch (error) {
    console.error("Failed to fetch URL:", error)
    const message = error instanceof Error ? error.message : String(error)
    progressText.textContent = `Error: ${message}`
  } finally {
    urlLoadBtn.removeAttribute("disabled")
    // Re-enable the convert button if we have something to work with
    if (selectedFile || loadedMultiscales) {
      convertBtn.removeAttribute("disabled")
    } else {
      convertBtn.setAttribute("disabled", "")
    }
    updateConvertButtonLabel()
  }
}

// URL input: load button click
urlLoadBtn.addEventListener("click", () => {
  void handleUrl((urlInput as unknown as { value: string }).value)
})

// URL input: Enter key triggers load
urlInput.addEventListener("keydown", (e: Event) => {
  if ((e as KeyboardEvent).key === "Enter") {
    void handleUrl((urlInput as unknown as { value: string }).value)
  }
})

// Drag and drop
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault()
  dropZone.classList.add("dragover")
})

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover")
})

dropZone.addEventListener("drop", (e) => {
  e.preventDefault()
  dropZone.classList.remove("dragover")

  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    handleFile(files[0])
  }
})

// Browse button
browseBtn.addEventListener("click", () => {
  fileInput.click()
})

fileInput.addEventListener("change", () => {
  const files = fileInput.files
  if (files && files.length > 0) {
    handleFile(files[0])
  }
})

// Progress handling
function updateProgress(progress: ConversionProgress): void {
  progressBar.setAttribute("value", String(progress.percent))
  progressText.textContent = progress.message
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
async function showPreview(
  result: Pick<ConversionResult, "multiscales">,
): Promise<void> {
  initNiivue()
  if (!nv) return

  placeholder.style.display = "none"

  const volumeIs3D = is3DVolume(result.multiscales)
  const imageIsRGB = isRGBOrRGBA(result.multiscales)

  // Disable colormap for RGB/RGBA images (NiiVue renders them directly)
  if (imageIsRGB) {
    colormapSelect.setAttribute("disabled", "")
  } else {
    colormapSelect.removeAttribute("disabled")
  }

  // Get colormap setting
  const colormap =
    (colormapSelect as unknown as { value: string }).value || "gray"

  // Create NVImage from multiscales
  const image = await OMEZarrNVImage.create({
    multiscales: result.multiscales,
    niivue: nv,
    autoLoad: false,
  })
  currentImage = image

  // Highlight the active level whenever the resolution changes
  image.addEventListener("resolutionChange", (event) => {
    highlightLevel(event.detail.currentLevel)
  })

  // Clear existing volumes and add new one
  nv.volumes = []
  nv.addVolume(image)
  await image.populateVolume()

  // Highlight the level that was loaded
  highlightLevel(image.getCurrentLevelIndex())

  // Apply colormap AFTER data is loaded to avoid calMinMax() on placeholder data.
  // Label images get a discrete colormap automatically from the library,
  // and RGB/RGBA images render their native colors directly — skip both.
  const isLabel = result.multiscales.method === Methods.ITKWASM_LABEL_IMAGE
  if (!isLabel && !imageIsRGB) {
    image.colormap = colormap
  }

  if (volumeIs3D) {
    set3DControlsEnabled(true)

    // Default to multiplanar for 3D volumes
    const sliceTypeStr =
      (sliceTypeSelect as unknown as { value: string }).value || "multiplanar"
    const sliceType = SLICE_TYPE_MAP[sliceTypeStr] ?? SLICE_TYPE.MULTIPLANAR

    // Set hero fraction BEFORE setSliceType so it takes effect on first draw
    nv.opts.heroImageFraction = sliceType === SLICE_TYPE.MULTIPLANAR ? 0.6 : 0
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

/** Highlight the row for the given resolution level in the multiscales table. */
function highlightLevel(levelIndex: number): void {
  const rows = multiscalesTable.querySelectorAll("tbody tr")
  for (const row of rows) {
    row.classList.toggle(
      "active-level",
      Number((row as HTMLTableRowElement).dataset.level) === levelIndex,
    )
  }
}

// Update multiscales table
function updateMultiscalesTable(
  result: Pick<ConversionResult, "multiscales">,
): void {
  const info = getMultiscalesInfo(result.multiscales)
  const tbody = multiscalesTable.querySelector(
    "tbody",
  ) as HTMLTableSectionElement
  tbody.innerHTML = ""

  for (const scale of info) {
    const row = document.createElement("tr")
    row.dataset.level = String(scale.level)
    row.innerHTML = `
      <td>${scale.level}</td>
      <td class="mono">${scale.path}</td>
      <td class="mono">${scale.shape}</td>
      <td class="mono">${scale.chunks}</td>
      <td>${scale.size}</td>
    `
    row.addEventListener("click", () => {
      if (currentImage) {
        void currentImage.loadLevel(scale.level)
      }
    })
    tbody.appendChild(row)
  }

  multiscalesCard.classList.remove("hidden")
}

/**
 * Convert a local file and download the result.
 *
 * Reads the file, generates a multiscale pyramid, packages in the
 * selected output format, shows the preview, and downloads.
 */
async function startConversion(): Promise<void> {
  if (!selectedFile) return

  // Disable convert button during conversion
  convertBtn.setAttribute("disabled", "")
  progressContainer.classList.add("visible")

  try {
    const options = {
      chunkSize: parseInt(
        (chunkSizeInput as unknown as { value: string }).value || "96",
        10,
      ),
      method: ((methodSelect as unknown as { value: string }).value ||
        "itkwasm_gaussian") as Methods,
      outputFormat: getSelectedFormat(),
    }

    lastResult = await convertImage(selectedFile, options, updateProgress)

    // Sync the method dropdown if auto-detection changed it
    // (e.g. label image detected while default Gaussian was selected)
    const actualMethod = lastResult.multiscales.method
    if (
      actualMethod &&
      actualMethod !== (methodSelect as unknown as { value: string }).value
    ) {
      ;(methodSelect as unknown as { value: string }).value = actualMethod
    }

    // Show preview
    await showPreview(lastResult)

    // Update table
    updateMultiscalesTable(lastResult)

    // Download
    downloadFile(lastResult.outputData, lastResult.filename)
  } catch (error) {
    console.error("Conversion failed:", error)
    progressText.textContent = `Error: ${
      error instanceof Error ? error.message : String(error)
    }`
  } finally {
    convertBtn.removeAttribute("disabled")
  }
}

/**
 * Export an already-loaded OME-Zarr to the selected output format
 * and trigger a download.
 */
async function startExport(): Promise<void> {
  if (!loadedMultiscales) return

  convertBtn.setAttribute("disabled", "")
  progressContainer.classList.add("visible")

  try {
    const format = getSelectedFormat()
    updateProgress({ stage: "packaging", percent: 0, message: "Exporting..." })

    const { outputData, filename } = await exportMultiscales(
      loadedMultiscales,
      loadedName,
      format,
      updateProgress,
    )

    updateProgress({ stage: "done", percent: 100, message: "Export complete!" })
    downloadFile(outputData, filename)
  } catch (error) {
    console.error("Export failed:", error)
    progressText.textContent = `Error: ${
      error instanceof Error ? error.message : String(error)
    }`
  } finally {
    convertBtn.removeAttribute("disabled")
  }
}

// Convert / Export button
convertBtn.addEventListener("click", () => {
  if (loadedMultiscales && !selectedFile) {
    void startExport()
  } else {
    void startConversion()
  }
})

// Settings change handlers for live preview updates
colormapSelect.addEventListener("change", () => {
  const ms = lastResult?.multiscales ?? loadedMultiscales
  if (ms && nv && nv.volumes.length > 0) {
    // Label images use discrete colormaps managed by the library
    if (ms.method === Methods.ITKWASM_LABEL_IMAGE) {
      return
    }
    const colormap =
      (colormapSelect as unknown as { value: string }).value || "gray"
    nv.volumes[0].colormap = colormap
    nv.updateGLVolume()
  }
})

opacitySlider.addEventListener("input", () => {
  const ms = lastResult?.multiscales ?? loadedMultiscales
  if (ms && nv && nv.volumes.length > 0) {
    updateGradientSettings()
  }
})

silhouetteSlider.addEventListener("input", () => {
  const ms = lastResult?.multiscales ?? loadedMultiscales
  if (ms && nv && nv.volumes.length > 0) {
    updateGradientSettings()
  }
})

sliceTypeSelect.addEventListener("change", () => {
  const ms = lastResult?.multiscales ?? loadedMultiscales
  if (ms && nv && nv.volumes.length > 0) {
    const sliceTypeStr =
      (sliceTypeSelect as unknown as { value: string }).value || "multiplanar"
    const sliceType = SLICE_TYPE_MAP[sliceTypeStr] ?? SLICE_TYPE.MULTIPLANAR
    nv.setSliceType(sliceType)
    nv.opts.heroImageFraction = sliceType === SLICE_TYPE.MULTIPLANAR ? 0.6 : 0
    nv.updateGLVolume()
  }
})

// Auto-load from ?url= query parameter
const urlParam = new URLSearchParams(window.location.search).get("url")
if (urlParam) {
  ;(urlInput as unknown as { value: string }).value = urlParam
  void handleUrl(urlParam)
}
