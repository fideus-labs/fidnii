/**
 * Image Converter - Main UI module
 */

import "@awesome.me/webawesome/dist/components/button/button.js"
import "@awesome.me/webawesome/dist/components/card/card.js"
import "@awesome.me/webawesome/dist/components/drawer/drawer.js"
import "@awesome.me/webawesome/dist/components/input/input.js"
import "@awesome.me/webawesome/dist/components/option/option.js"
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js"
import "@awesome.me/webawesome/dist/components/radio/radio.js"
import "@awesome.me/webawesome/dist/components/radio-group/radio-group.js"
import "@awesome.me/webawesome/dist/components/select/select.js"
import "@awesome.me/webawesome/dist/components/slider/slider.js"

import type { VolumeBounds } from "@fideus-labs/fidnii"
import {
  createAxisAlignedClipPlane,
  getChannelInfo,
  getVolumeBoundsFromMultiscales,
  OMEZarrNVImage,
} from "@fideus-labs/fidnii"
import type { Multiscales } from "@fideus-labs/ngff-zarr"
import type { Connectome, NVConnectomeNode } from "@niivue/niivue"
import { Niivue, SLICE_TYPE } from "@niivue/niivue"

import {
  type ChunkProgressCallback,
  type ConversionProgress,
  type ConvertResult,
  convertImage,
  convertMultiscales,
  downloadFile,
  fetchImageFile,
  formatFileSize,
  getMultiscalesInfo,
  isOmeZarrUrl,
  isTiffFilename,
  isTiffUrl,
  loadOmeZarrUrl,
  loadTiffFile,
  loadTiffUrl,
  Methods,
  OUTPUT_FORMAT_LABELS,
  OUTPUT_FORMATS,
  type OutputFormat,
  packageOutput,
} from "./converter.ts"
import { FAST_COLORMAP } from "./fast-colormap.ts"

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
const downloadBtn = document.getElementById("download-btn") as HTMLElement
const progressContainer = document.getElementById(
  "progress-container",
) as HTMLDivElement
const progressBar = document.getElementById("progress-bar") as HTMLElement
const progressText = document.getElementById("progress-text") as HTMLElement
const chunkProgressContainer = document.getElementById(
  "chunk-progress-container",
) as HTMLDivElement
const chunkProgressBar = document.getElementById(
  "chunk-progress-bar",
) as HTMLElement
const chunkProgressText = document.getElementById(
  "chunk-progress-text",
) as HTMLElement
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
const sampleBtn = document.getElementById("sample-btn") as HTMLElement

// Settings inputs
const outputFormatSelect = document.getElementById(
  "output-format",
) as HTMLSelectElement
const chunkSizeInput = document.getElementById("chunk-size") as HTMLInputElement
const methodSelect = document.getElementById("method") as HTMLSelectElement
const colormapSelect = document.getElementById("colormap") as HTMLSelectElement
const sliceTypeGroup = document.getElementById("slice-type") as HTMLElement
const opacitySlider = document.getElementById("opacity") as HTMLInputElement
const silhouetteSlider = document.getElementById(
  "silhouette",
) as HTMLInputElement

// Minimap elements
const minimapCard = document.getElementById("minimap-card") as HTMLElement
const minimapCanvas = document.getElementById("minimap-gl") as HTMLCanvasElement
const roiXSlider = document.getElementById("roi-x") as HTMLInputElement
const roiYSlider = document.getElementById("roi-y") as HTMLInputElement
const roiZSlider = document.getElementById("roi-z") as HTMLInputElement

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

/** File size threshold (300 MB) above which we suggest Python tooling. */
const LARGE_FILE_THRESHOLD = 300_000_000

// State
let selectedFile: File | null = null
let lastResult: ConvertResult | null = null
/** Multiscales loaded directly from an OME-Zarr URL (no conversion). */
let loadedMultiscales: Multiscales | null = null
/** Base name derived from the OME-Zarr URL (for output filenames). */
let loadedName = ""
let nv: Niivue | null = null
let currentImage: OMEZarrNVImage | null = null

// Minimap state
let minimapNv: Niivue | null = null
let minimapImage: OMEZarrNVImage | null = null
let volumeBounds: VolumeBounds | null = null

/** AbortController for tearing down minimap ↔ main camera sync listeners. */
let _syncAbort: AbortController | null = null

/** Re-entrancy guard so bidirectional camera sync doesn't loop. */
let _syncing = false

/** Pixel budget for the minimap (lower resolution for overview). */
const MINIMAP_MAX_PIXELS = 10_000_000

/** Cobalt blue RGBA for the ROI box: #0047AB */
const COBALT_RGBA: [number, number, number, number] = [
  0,
  71 / 255,
  171 / 255,
  1,
]

// Slice type string-to-enum mapping
const SLICE_TYPE_MAP: Record<string, SLICE_TYPE> = {
  axial: SLICE_TYPE.AXIAL,
  coronal: SLICE_TYPE.CORONAL,
  sagittal: SLICE_TYPE.SAGITTAL,
  multiplanar: SLICE_TYPE.MULTIPLANAR,
  render: SLICE_TYPE.RENDER,
}

/** Read the currently selected slice type from the radio-group element. */
function getSelectedSliceType(): SLICE_TYPE {
  const value =
    (sliceTypeGroup as unknown as { value: string }).value || "multiplanar"
  return SLICE_TYPE_MAP[value] ?? SLICE_TYPE.MULTIPLANAR
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

/** Check whether the image is single-component (no "c" axis or exactly 1 component). */
function isSingleComponent(multiscales: Multiscales): boolean {
  const firstImage = multiscales.images[0]
  if (!firstImage) return false
  const info = getChannelInfo(firstImage)
  return info === null || info.components === 1
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
    backColor: [0.384, 0.365, 0.353, 1],
    isOrientCube: false,
    isOrientationTextVisible: false,
  })
  nv.attachToCanvas(canvas)
  nv.addColormap("fast", FAST_COLORMAP)
}

// --------------- Minimap helpers ---------------

/** Create a 256-entry single-color LUT for the cobalt blue ROI box. */
function buildCobaltColormap(): {
  R: number[]
  G: number[]
  B: number[]
  A: number[]
  I: number[]
} {
  const R = new Array<number>(256).fill(Math.round(COBALT_RGBA[0] * 255))
  const G = new Array<number>(256).fill(Math.round(COBALT_RGBA[1] * 255))
  const B = new Array<number>(256).fill(Math.round(COBALT_RGBA[2] * 255))
  const A = new Array<number>(256).fill(255)
  const I = new Array<number>(256).fill(0).map((_, i) => i)
  // First entry transparent so sizeValue=0 nodes are invisible
  R[0] = 0
  G[0] = 0
  B[0] = 0
  A[0] = 0
  return { R, G, B, A, I }
}

/** Initialize the minimap NiiVue instance (lazy, only done once). */
function initMinimapNiivue(): void {
  if (minimapNv) return

  minimapNv = new Niivue({
    show3Dcrosshair: false,
    crosshairWidth: 0,
    backColor: [0.384, 0.365, 0.353, 1],
    isOrientCube: false,
    isOrientationTextVisible: false,
  })
  minimapNv.attachToCanvas(minimapCanvas)
  minimapNv.addColormap("fast", FAST_COLORMAP)
  minimapNv.addColormap("cobalt", buildCobaltColormap())
}

/**
 * Build a NiiVue connectome representing the ROI bounding box as
 * 8 corner nodes connected by 12 edges (wireframe cube).
 *
 * @param min - ROI min corner in world coordinates [x, y, z]
 * @param max - ROI max corner in world coordinates [x, y, z]
 */
function buildRoiConnectome(
  min: [number, number, number],
  max: [number, number, number],
): Connectome {
  const nodes: NVConnectomeNode[] = [
    { name: "0", x: min[0], y: min[1], z: min[2], colorValue: 1, sizeValue: 0 },
    { name: "1", x: max[0], y: min[1], z: min[2], colorValue: 1, sizeValue: 0 },
    { name: "2", x: min[0], y: max[1], z: min[2], colorValue: 1, sizeValue: 0 },
    { name: "3", x: max[0], y: max[1], z: min[2], colorValue: 1, sizeValue: 0 },
    { name: "4", x: min[0], y: min[1], z: max[2], colorValue: 1, sizeValue: 0 },
    { name: "5", x: max[0], y: min[1], z: max[2], colorValue: 1, sizeValue: 0 },
    { name: "6", x: min[0], y: max[1], z: max[2], colorValue: 1, sizeValue: 0 },
    { name: "7", x: max[0], y: max[1], z: max[2], colorValue: 1, sizeValue: 0 },
  ]
  // 12 edges forming a wireframe cube
  const edges = [
    // Bottom face (z = min)
    { first: 0, second: 1, colorValue: 1 },
    { first: 1, second: 3, colorValue: 1 },
    { first: 3, second: 2, colorValue: 1 },
    { first: 2, second: 0, colorValue: 1 },
    // Top face (z = max)
    { first: 4, second: 5, colorValue: 1 },
    { first: 5, second: 7, colorValue: 1 },
    { first: 7, second: 6, colorValue: 1 },
    { first: 6, second: 4, colorValue: 1 },
    // Vertical edges
    { first: 0, second: 4, colorValue: 1 },
    { first: 1, second: 5, colorValue: 1 },
    { first: 2, second: 6, colorValue: 1 },
    { first: 3, second: 7, colorValue: 1 },
  ]
  return {
    name: "roiBox",
    nodeColormap: "cobalt",
    nodeColormapNegative: "cobalt",
    nodeMinColor: 0,
    nodeMaxColor: 2,
    nodeScale: 0,
    edgeColormap: "cobalt",
    edgeColormapNegative: "cobalt",
    edgeMin: 0,
    edgeMax: 2,
    edgeScale: 1,
    nodes,
    edges,
  }
}

/**
 * Update the ROI wireframe box on the minimap by mutating the
 * existing connectome node positions.
 */
function updateMinimapBox(
  min: [number, number, number],
  max: [number, number, number],
): void {
  if (!minimapNv || minimapNv.meshes.length === 0) return
  const mesh = minimapNv.meshes[0]
  const nodes = mesh.nodes as NVConnectomeNode[] | undefined
  if (!nodes || nodes.length < 8) return

  const corners: [number, number, number][] = [
    [min[0], min[1], min[2]],
    [max[0], min[1], min[2]],
    [min[0], max[1], min[2]],
    [max[0], max[1], min[2]],
    [min[0], min[1], max[2]],
    [max[0], min[1], max[2]],
    [min[0], max[1], max[2]],
    [max[0], max[1], max[2]],
  ]
  for (let i = 0; i < 8; i++) {
    nodes[i].x = corners[i][0]
    nodes[i].y = corners[i][1]
    nodes[i].z = corners[i][2]
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gl = (minimapNv as any)._gl as WebGL2RenderingContext | null
  if (gl) {
    ;(mesh as any).updateConnectome(gl)
  }
  minimapNv.updateGLVolume()
}

/** Read the current ROI slider values as world-coordinate bounds. */
function readRoiSliders(): {
  min: [number, number, number]
  max: [number, number, number]
} {
  const xSlider = roiXSlider as unknown as {
    minValue: number
    maxValue: number
  }
  const ySlider = roiYSlider as unknown as {
    minValue: number
    maxValue: number
  }
  const zSlider = roiZSlider as unknown as {
    minValue: number
    maxValue: number
  }
  return {
    min: [xSlider.minValue, ySlider.minValue, zSlider.minValue],
    max: [xSlider.maxValue, ySlider.maxValue, zSlider.maxValue],
  }
}

/**
 * Apply the current ROI slider values as clip planes on the main
 * image and update the wireframe box on the minimap.
 */
function updateRoi(): void {
  if (!volumeBounds || !currentImage) return

  const roi = readRoiSliders()

  // Only apply clip planes if the ROI differs from the full volume
  const isFullVolume =
    Math.abs(roi.min[0] - volumeBounds.min[0]) < 0.01 &&
    Math.abs(roi.min[1] - volumeBounds.min[1]) < 0.01 &&
    Math.abs(roi.min[2] - volumeBounds.min[2]) < 0.01 &&
    Math.abs(roi.max[0] - volumeBounds.max[0]) < 0.01 &&
    Math.abs(roi.max[1] - volumeBounds.max[1]) < 0.01 &&
    Math.abs(roi.max[2] - volumeBounds.max[2]) < 0.01

  if (isFullVolume) {
    currentImage.clearClipPlanes()
  } else {
    const planes = [
      createAxisAlignedClipPlane("x", roi.min[0], "positive", volumeBounds),
      createAxisAlignedClipPlane("x", roi.max[0], "negative", volumeBounds),
      createAxisAlignedClipPlane("y", roi.min[1], "positive", volumeBounds),
      createAxisAlignedClipPlane("y", roi.max[1], "negative", volumeBounds),
      createAxisAlignedClipPlane("z", roi.min[2], "positive", volumeBounds),
      createAxisAlignedClipPlane("z", roi.max[2], "negative", volumeBounds),
    ]
    currentImage.setClipPlanes(planes)
  }

  // Update the wireframe box on the minimap
  updateMinimapBox(roi.min, roi.max)
}

/**
 * Configure the ROI range sliders to match the current volume bounds
 * and reset them to the full range.
 */
function initRoiSliders(bounds: VolumeBounds): void {
  const axes: { slider: HTMLInputElement; idx: 0 | 1 | 2; label: string }[] = [
    { slider: roiXSlider, idx: 0, label: "X" },
    { slider: roiYSlider, idx: 1, label: "Y" },
    { slider: roiZSlider, idx: 2, label: "Z" },
  ]

  for (const { slider, idx, label } of axes) {
    const lo = bounds.min[idx]
    const hi = bounds.max[idx]
    const range = hi - lo
    const step = Math.max(range / 200, 0.01)

    const s = slider as unknown as {
      min: number
      max: number
      step: number
      minValue: number
      maxValue: number
      label: string
      valueFormatter: (value: number) => string
    }
    s.min = lo
    s.max = hi
    s.step = parseFloat(step.toFixed(4))
    s.minValue = lo
    s.maxValue = hi
    s.label = `${label} Range`
    s.valueFormatter = (v: number) => v.toFixed(1)
  }
}

/**
 * Clean up minimap state when loading a new image.
 */
function cleanupMinimap(): void {
  // Tear down camera sync listeners before disposing of instances
  if (_syncAbort) {
    _syncAbort.abort()
    _syncAbort = null
  }

  if (minimapNv) {
    // Remove existing meshes (connectome)
    for (const mesh of minimapNv.meshes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gl = (minimapNv as any)._gl as WebGL2RenderingContext | null
      if (gl) {
        mesh.unloadMesh(gl)
      }
    }
    minimapNv.meshes = []
    minimapNv.volumes = []
  }
  if (minimapImage) {
    minimapImage = null
  }
  volumeBounds = null
  minimapCard.classList.add("hidden")
}

/**
 * Get the currently selected output format from the UI.
 */
function getSelectedFormat(): OutputFormat {
  return ((outputFormatSelect as unknown as { value: string }).value ||
    "ozx") as OutputFormat
}

/** Update button labels depending on the current state. */
function updateButtonLabels(): void {
  convertBtn.textContent = "Convert"
  downloadBtn.textContent = "Download"
}

// Large-file recommendation drawer
const largeFileDrawer = document.getElementById(
  "large-file-drawer",
) as HTMLElement & { open: boolean }
let _largeFileTimer: ReturnType<typeof setTimeout> | null = null
let _largeFileHideListener: (() => void) | null = null

/**
 * Show a bottom drawer recommending ngff-zarr Python tooling for
 * files larger than {@link LARGE_FILE_THRESHOLD}.  The drawer
 * auto-closes after 10 seconds or on dismissal.
 */
function showLargeFileDrawer(): void {
  // Clear any pending auto-close from a previous showing
  if (_largeFileTimer) {
    clearTimeout(_largeFileTimer)
    _largeFileTimer = null
  }

  // Remove any existing hide listener to prevent accumulation
  if (_largeFileHideListener) {
    largeFileDrawer.removeEventListener("wa-after-hide", _largeFileHideListener)
    _largeFileHideListener = null
  }

  largeFileDrawer.open = true

  // Auto-close after 10 seconds
  _largeFileTimer = setTimeout(() => {
    largeFileDrawer.open = false
    _largeFileTimer = null
  }, 20_000)

  // If the user dismisses the drawer early, cancel the timer
  _largeFileHideListener = () => {
    if (_largeFileTimer) {
      clearTimeout(_largeFileTimer)
      _largeFileTimer = null
    }
    _largeFileHideListener = null
  }
  largeFileDrawer.addEventListener("wa-after-hide", _largeFileHideListener, {
    once: true,
  })
}

// File handling
function handleFile(file: File, { fromUrl = false } = {}): void {
  selectedFile = file
  loadedMultiscales = null
  loadedName = ""
  fileInfo.textContent = `${file.name} (${formatFileSize(file.size)})`
  convertBtn.removeAttribute("disabled")
  lastResult = null

  // Suggest Python tooling for very large files
  if (file.size > LARGE_FILE_THRESHOLD) {
    showLargeFileDrawer()
  }

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

  // Disable download until a new conversion completes
  downloadBtn.setAttribute("disabled", "")

  // Use a larger default chunk size for 2D images
  const dotIndex = file.name.lastIndexOf(".")
  const ext = dotIndex !== -1 ? file.name.slice(dotIndex).toLowerCase() : ""
  const chunkDefault = IMAGE_2D_EXTENSIONS.has(ext)
    ? DEFAULT_CHUNK_SIZE_2D
    : DEFAULT_CHUNK_SIZE_3D
  ;(chunkSizeInput as unknown as { value: string }).value = chunkDefault

  updateButtonLabels()
}

/**
 * Fetch an image from a remote URL and feed it into the UI.
 *
 * OME-Zarr URLs are loaded directly into the viewer without
 * conversion. Other URLs are fetched as files for later conversion.
 *
 * @param url - The remote URL to fetch
 * @returns True if the URL was successfully loaded, false otherwise
 */
async function handleUrl(url: string): Promise<boolean> {
  const trimmed = url.trim()
  if (!trimmed) return false

  // Disable controls and show progress while loading
  urlLoadBtn.setAttribute("disabled", "")
  convertBtn.setAttribute("disabled", "")
  progressContainer.classList.add("visible")

  let success = false
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

      // No conversion needed for OME-Zarr — only Download is relevant
      convertBtn.setAttribute("disabled", "")
      downloadBtn.removeAttribute("disabled")
    } else if (await isTiffUrl(trimmed)) {
      // --- TIFF URL: load via fiff with HTTP range requests ---
      selectedFile = null
      lastResult = null
      const multiscales = await loadTiffUrl(trimmed, updateProgress)
      loadedMultiscales = multiscales
      loadedName = trimmed.replace(/\/+$/, "").split("/").pop() || "image"
      fileInfo.textContent = `TIFF: ${loadedName}`

      updateMultiscalesTable({ multiscales })
      void showPreview({ multiscales })

      // Allow conversion (re-downsample / repackage) and download
      convertBtn.removeAttribute("disabled")
      downloadBtn.removeAttribute("disabled")
    } else {
      // --- Regular image URL: fetch as file ---
      const file = await fetchImageFile(trimmed, updateProgress)
      handleFile(file, { fromUrl: true })
    }

    // Update the browser URL so the current state is shareable
    const newUrl = new URL(window.location.href)
    newUrl.searchParams.set("url", trimmed)
    history.replaceState(null, "", newUrl)
    success = true
  } catch (error) {
    console.error("Failed to fetch URL:", error)
    const message = error instanceof Error ? error.message : String(error)
    progressText.textContent = `Error: ${message}`
  } finally {
    urlLoadBtn.removeAttribute("disabled")
    // Re-enable the convert button if we have a source to convert.
    // OME-Zarr URLs don't need conversion; TIFF URLs and local files
    // enable Convert in their respective branches above.
    if (selectedFile) {
      convertBtn.removeAttribute("disabled")
    } else if (!loadedMultiscales) {
      convertBtn.setAttribute("disabled", "")
    }
    updateButtonLabels()
  }
  return success
}

/** Load a URL and auto-convert if it's a regular image file. */
async function loadUrlAndConvert(url: string): Promise<void> {
  const success = await handleUrl(url)
  if (success && selectedFile) {
    void startConversion()
  }
}

// URL input: load button click
urlLoadBtn.addEventListener("click", () => {
  void loadUrlAndConvert((urlInput as unknown as { value: string }).value)
})

// URL input: Enter key triggers load
urlInput.addEventListener("keydown", (e: Event) => {
  if ((e as KeyboardEvent).key === "Enter") {
    void loadUrlAndConvert((urlInput as unknown as { value: string }).value)
  }
})

// Sample image button: load the bundled MRI and auto-convert
sampleBtn.addEventListener("click", () => {
  void (async () => {
    sampleBtn.setAttribute("disabled", "")
    try {
      const success = await handleUrl("/mri.nii.gz")
      if (success && selectedFile) {
        void startConversion()
      }
    } finally {
      sampleBtn.removeAttribute("disabled")
    }
  })()
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
    void startConversion()
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
    void startConversion()
  }
})

// Progress handling
function updateProgress(progress: ConversionProgress): void {
  progressBar.setAttribute("value", String(progress.percent))
  progressText.textContent = progress.message
}

const CHUNK_STAGE_LABELS: Record<string, string> = {
  omero: "OMERO computation",
  packaging: "OZX packaging",
}

const updateChunkProgress: ChunkProgressCallback = (
  stage,
  completed,
  total,
) => {
  chunkProgressContainer.style.display = "block"
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0
  chunkProgressBar.setAttribute("value", String(percent))
  const label = CHUNK_STAGE_LABELS[stage] ?? stage
  chunkProgressText.textContent = `${label}: ${completed} / ${total} chunks`
}

/** Show or hide the 3D-only preview controls. */
function set3DControlsVisible(visible: boolean): void {
  const controls: Element[] = [
    opacitySlider,
    silhouetteSlider,
    sliceTypeGroup.closest("fieldset")!,
  ]
  for (const el of controls) {
    el.classList.toggle("hidden", !visible)
  }
}

/**
 * Set up the minimap NiiVue instance, load a low-resolution copy of
 * the image, overlay the ROI wireframe box, configure bidirectional
 * camera sync with the main viewer, and initialize the range sliders.
 */
async function initMinimapPreview(
  multiscales: Multiscales,
  opts: { colormap: string | null },
): Promise<void> {
  if (!nv) return

  // Clean up any previous minimap state
  cleanupMinimap()

  initMinimapNiivue()
  if (!minimapNv) return

  // Compute world-space bounds of the full volume
  const bounds = getVolumeBoundsFromMultiscales(multiscales)
  volumeBounds = bounds

  // Copy orientation settings from the main viewer
  const hasOrientation = multiscales.images[0]?.axesOrientations !== undefined
  minimapNv.opts.isOrientCube = hasOrientation
  minimapNv.opts.isOrientationTextVisible = hasOrientation

  // Create a lower-resolution image for the minimap
  const mmImage = await OMEZarrNVImage.create({
    multiscales,
    niivue: minimapNv,
    autoLoad: false,
    maxPixels: MINIMAP_MAX_PIXELS,
  })
  minimapImage = mmImage

  // Load the minimap image
  minimapNv.volumes = []
  minimapNv.addVolume(mmImage)
  await mmImage.populateVolume()

  // Apply the same colormap as the main image
  if (opts.colormap) {
    mmImage.colormap = opts.colormap
  }

  // Always use render-only mode for the minimap so the 3D overview
  // fills the entire canvas without slice panels.
  minimapNv.opts.heroImageFraction = 0
  minimapNv.setSliceType(SLICE_TYPE.RENDER)

  // Apply the same gradient settings
  const opacity = parseFloat(
    (opacitySlider as unknown as { value: string }).value || "0.5",
  )
  const silhouette = parseFloat(
    (silhouetteSlider as unknown as { value: string }).value || "0",
  )
  await minimapNv.setGradientOpacity(opacity, silhouette)

  // Load the ROI wireframe box as a connectome
  const connectome = buildRoiConnectome(bounds.min, bounds.max)
  await minimapNv.loadConnectome(connectome)

  // --- Bidirectional camera sync via events (not broadcastTo) ---
  // We avoid broadcastTo because its polling-based 2D sync converts
  // fractional→mm→fractional across different-resolution volumes,
  // which causes crosshair positions to land in invalid space.
  // Instead, we listen for azimuth/elevation and zoom events and
  // mirror them with a re-entrancy guard to prevent loops.

  _syncAbort?.abort()
  const abort = new AbortController()
  _syncAbort = abort
  const signal = abort.signal

  // Main → Minimap
  nv.addEventListener(
    "azimuthElevationChange",
    (event) => {
      if (_syncing || !minimapNv) return
      _syncing = true
      try {
        minimapNv.setRenderAzimuthElevation(
          event.detail.azimuth,
          event.detail.elevation,
        )
      } finally {
        _syncing = false
      }
    },
    { signal },
  )
  nv.addEventListener(
    "zoom3DChange",
    (event) => {
      if (_syncing || !minimapNv) return
      _syncing = true
      try {
        minimapNv.scene.volScaleMultiplier = event.detail.zoom
        minimapNv.drawScene()
      } finally {
        _syncing = false
      }
    },
    { signal },
  )

  // Minimap → Main
  minimapNv.addEventListener(
    "azimuthElevationChange",
    (event) => {
      if (_syncing || !nv) return
      _syncing = true
      try {
        nv.setRenderAzimuthElevation(
          event.detail.azimuth,
          event.detail.elevation,
        )
      } finally {
        _syncing = false
      }
    },
    { signal },
  )
  minimapNv.addEventListener(
    "zoom3DChange",
    (event) => {
      if (_syncing || !nv) return
      _syncing = true
      try {
        nv.scene.volScaleMultiplier = event.detail.zoom
        nv.drawScene()
      } finally {
        _syncing = false
      }
    },
    { signal },
  )

  // Initialize the range sliders to match the volume bounds
  initRoiSliders(bounds)

  // Show the minimap card
  minimapCard.classList.remove("hidden")

  minimapNv.updateGLVolume()

  // Defer camera alignment to the next frame so NiiVue's internal
  // rendering state (obliqueRAS, toRAS, pivot, etc.) is fully settled
  // after the volume load and connectome load above.
  const mainNv = nv
  const mmNv = minimapNv
  requestAnimationFrame(() => {
    if (!mmNv || !mainNv) return
    mmNv.setRenderAzimuthElevation(
      mainNv.scene.renderAzimuth,
      mainNv.scene.renderElevation,
    )
    mmNv.scene.volScaleMultiplier = mainNv.scene.volScaleMultiplier
  })
}

// Preview with NiiVue
async function showPreview(
  result: Pick<ConvertResult, "multiscales">,
): Promise<void> {
  initNiivue()
  if (!nv) return

  placeholder.style.display = "none"

  // Enable orientation markers (L/R/A/P/S/I text labels and 3D
  // orientation cube) when the source format carries anatomical
  // orientation metadata, e.g. NIfTI, NRRD, DICOM.
  const hasOrientation =
    result.multiscales.images[0]?.axesOrientations !== undefined
  nv.opts.isOrientCube = hasOrientation
  nv.opts.isOrientationTextVisible = hasOrientation

  const volumeIs3D = is3DVolume(result.multiscales)
  const imageIsRGB = isRGBOrRGBA(result.multiscales)
  const singleComponent = isSingleComponent(result.multiscales)

  // Disable colormap for RGB/RGBA and multi-component images
  if (imageIsRGB || !singleComponent) {
    colormapSelect.setAttribute("disabled", "")
  } else {
    colormapSelect.removeAttribute("disabled")
  }

  // Get colormap setting
  const colormap =
    (colormapSelect as unknown as { value: string }).value || "fast"

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
  // RGB/RGBA images render their native colors directly, and multi-component
  // images are not suited for a single scalar colormap — skip all three.
  const isLabel = result.multiscales.method === Methods.ITKWASM_LABEL_IMAGE
  if (!isLabel && !imageIsRGB && singleComponent) {
    image.colormap = colormap
  }

  if (volumeIs3D) {
    set3DControlsVisible(true)

    // Default to multiplanar for 3D volumes
    const sliceType = getSelectedSliceType()

    // Set hero fraction BEFORE setSliceType so it takes effect on first draw
    nv.opts.heroImageFraction = sliceType === SLICE_TYPE.MULTIPLANAR ? 0.6 : 0
    nv.setSliceType(sliceType)
    await updateGradientSettings()
    nv.updateGLVolume()

    // ---- Set up the minimap ----
    await initMinimapPreview(result.multiscales, {
      colormap: !isLabel && !imageIsRGB && singleComponent ? colormap : null,
    })
  } else {
    set3DControlsVisible(false)

    // 2D images: axial view, no gradient effects
    nv.opts.heroImageFraction = 0
    nv.setSliceType(SLICE_TYPE.AXIAL)
    await nv.setGradientOpacity(0, 0)
    nv.updateGLVolume()

    // Hide the minimap for 2D images
    cleanupMinimap()
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
  result: Pick<ConvertResult, "multiscales">,
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
 * Convert the current source into a multiscale pyramid and show the
 * preview.  Works with both local files (`selectedFile`) and
 * pre-loaded multiscales from TIFF URLs (`loadedMultiscales`).
 *
 * Does not package or download the output — that is handled by
 * {@link startDownload}.
 */
async function startConversion(): Promise<void> {
  if (!selectedFile && !loadedMultiscales) return

  // Disable both buttons during conversion
  convertBtn.setAttribute("disabled", "")
  downloadBtn.setAttribute("disabled", "")
  progressContainer.classList.add("visible")
  chunkProgressContainer.style.display = "none"
  chunkProgressBar.setAttribute("value", "0")
  chunkProgressText.textContent = ""

  try {
    const options = {
      chunkSize: parseInt(
        (chunkSizeInput as unknown as { value: string }).value || "96",
        10,
      ),
      method: ((methodSelect as unknown as { value: string }).value ||
        "itkwasm_gaussian") as Methods,
    }

    if (selectedFile && isTiffFilename(selectedFile.name)) {
      // Local TIFF: load via fiff then re-downsample
      const tiffMs = await loadTiffFile(selectedFile, updateProgress)
      lastResult = await convertMultiscales(
        tiffMs,
        options,
        updateProgress,
        updateChunkProgress,
      )
    } else if (selectedFile) {
      lastResult = await convertImage(
        selectedFile,
        options,
        updateProgress,
        updateChunkProgress,
      )
    } else if (loadedMultiscales) {
      // Re-downsample from a pre-loaded source (e.g. TIFF URL)
      lastResult = await convertMultiscales(
        loadedMultiscales,
        options,
        updateProgress,
        updateChunkProgress,
      )
    }

    if (!lastResult) return

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

    // Enable download now that multiscales are ready
    downloadBtn.removeAttribute("disabled")
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
 * Package the current multiscales in the selected output format and
 * trigger a browser download.
 *
 * Works for both locally-converted files and directly-loaded OME-Zarr
 * URLs — whichever produced the available multiscales.
 */
async function startDownload(): Promise<void> {
  const multiscales = lastResult?.multiscales ?? loadedMultiscales
  const name = selectedFile?.name ?? loadedName
  if (!multiscales || !name) return

  downloadBtn.setAttribute("disabled", "")
  progressContainer.classList.add("visible")
  chunkProgressContainer.style.display = "none"
  chunkProgressBar.setAttribute("value", "0")
  chunkProgressText.textContent = ""

  try {
    const format = getSelectedFormat()
    updateProgress({
      stage: "packaging",
      percent: 0,
      message: "Packaging output...",
    })

    const { outputData, filename } = await packageOutput(
      multiscales,
      name,
      format,
      updateProgress,
      updateChunkProgress,
    )

    updateProgress({
      stage: "done",
      percent: 100,
      message: "Download ready!",
    })
    downloadFile(outputData, filename)
  } catch (error) {
    console.error("Download failed:", error)
    progressText.textContent = `Error: ${
      error instanceof Error ? error.message : String(error)
    }`
  } finally {
    downloadBtn.removeAttribute("disabled")
  }
}

// Convert button
convertBtn.addEventListener("click", () => {
  void startConversion()
})

// Download button
downloadBtn.addEventListener("click", () => {
  void startDownload()
})

// Settings change handlers for live preview updates
colormapSelect.addEventListener("change", () => {
  const ms = lastResult?.multiscales ?? loadedMultiscales
  if (ms && nv && currentImage) {
    // Label images use discrete colormaps managed by the library,
    // and multi-component images are not suited for a single scalar colormap.
    if (ms.method === Methods.ITKWASM_LABEL_IMAGE || !isSingleComponent(ms)) {
      return
    }
    const colormap =
      (colormapSelect as unknown as { value: string }).value || "fast"
    currentImage.colormap = colormap
    nv.updateGLVolume()

    // Propagate colormap to minimap
    if (minimapImage && minimapNv) {
      minimapImage.colormap = colormap
      minimapNv.updateGLVolume()
    }
  }
})

opacitySlider.addEventListener("input", () => {
  const ms = lastResult?.multiscales ?? loadedMultiscales
  if (ms && nv && nv.volumes.length > 0) {
    updateGradientSettings()

    // Propagate gradient settings to minimap
    if (minimapNv && minimapNv.volumes.length > 0) {
      const opacity = parseFloat(
        (opacitySlider as unknown as { value: string }).value || "0.5",
      )
      const silhouette = parseFloat(
        (silhouetteSlider as unknown as { value: string }).value || "0",
      )
      void minimapNv.setGradientOpacity(opacity, silhouette)
    }
  }
})

silhouetteSlider.addEventListener("input", () => {
  const ms = lastResult?.multiscales ?? loadedMultiscales
  if (ms && nv && nv.volumes.length > 0) {
    updateGradientSettings()

    // Propagate gradient settings to minimap
    if (minimapNv && minimapNv.volumes.length > 0) {
      const opacity = parseFloat(
        (opacitySlider as unknown as { value: string }).value || "0.5",
      )
      const silhouette = parseFloat(
        (silhouetteSlider as unknown as { value: string }).value || "0",
      )
      void minimapNv.setGradientOpacity(opacity, silhouette)
    }
  }
})

sliceTypeGroup.addEventListener("change", () => {
  const ms = lastResult?.multiscales ?? loadedMultiscales
  if (ms && nv && nv.volumes.length > 0) {
    const sliceType = getSelectedSliceType()
    nv.setSliceType(sliceType)
    nv.opts.heroImageFraction = sliceType === SLICE_TYPE.MULTIPLANAR ? 0.6 : 0
    nv.updateGLVolume()
  }
})

// ROI range slider handlers
for (const slider of [roiXSlider, roiYSlider, roiZSlider]) {
  slider.addEventListener("input", () => {
    updateRoi()
  })
}

// Auto-load from ?url= query parameter
const urlParam = new URLSearchParams(window.location.search).get("url")
if (urlParam) {
  ;(urlInput as unknown as { value: string }).value = urlParam
  void loadUrlAndConvert(urlParam)
}
