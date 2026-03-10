/**
 * Image conversion pipeline with multiple output format support
 */

import type { VolumeBounds } from "@fideus-labs/fidnii"
import {
  fromTiff,
  getVolumeShape,
  pixelToWorld,
  worldToPixel,
} from "@fideus-labs/fidnii"
import type { WriteOptions as FiffWriteOptions } from "@fideus-labs/fiff"
import { toOmeTiff } from "@fideus-labs/fiff"
import {
  bytesOnlyCodecs,
  createMetadataWithVersion,
  Methods,
  type Multiscales,
  Multiscales as MultiscalesClass,
  type NgffImage,
  toMultiscales,
} from "@fideus-labs/ngff-zarr"
import {
  computeOmeroFromNgffImage,
  fromNgffZarr,
  itkImageToNgffImage,
  ngffImageToItkImage,
  toNgffZarrOzx,
  zarrGet,
} from "@fideus-labs/ngff-zarr/browser"
import { WorkerPool } from "@fideus-labs/worker-pool"
import { setPipelinesBaseUrl as setPipelinesBaseUrlDownsample } from "@itk-wasm/downsample"
import {
  readImage,
  setPipelinesBaseUrl as setPipelinesBaseUrlImageIo,
  writeImage,
} from "@itk-wasm/image-io"
import type { Image } from "itk-wasm"

export { Methods } from "@fideus-labs/ngff-zarr"

// Use local, vendored WebAssembly module assets copied by viteStaticCopy
// @ts-expect-error import.meta.env is provided by Vite at runtime
const viteBaseUrl = import.meta.env.BASE_URL || "/"
const pipelinesBaseUrl = new URL(
  `${viteBaseUrl}pipelines`,
  document.location.origin,
).href
setPipelinesBaseUrlImageIo(pipelinesBaseUrl)
setPipelinesBaseUrlDownsample(pipelinesBaseUrl)

/**
 * Maximum number of unique labels for auto-detection of label images.
 * Images with integer pixel types and fewer unique values than this
 * threshold are treated as label/segmentation images.
 */
const MAX_LABELS_IN_LABEL_IMAGE = 64

/**
 * Detect whether an ITK-Wasm image is a label/segmentation image.
 *
 * A label image has:
 * 1. An integer pixel type (not float32 or float64)
 * 2. A small number of unique values (<= MAX_LABELS_IN_LABEL_IMAGE)
 *
 * @param image - The ITK-Wasm image to check
 * @returns true if the image is detected as a label image
 */
function isLabelImage(image: Image): boolean {
  const { componentType } = image.imageType
  if (componentType === "float32" || componentType === "float64") {
    return false
  }
  // Only integer-based pixels considered for label maps
  if (!image.data) {
    return false
  }
  const uniqueLabels = new Set(image.data as unknown as Iterable<number>).size
  return uniqueLabels <= MAX_LABELS_IN_LABEL_IMAGE
}

/**
 * Supported output format identifiers.
 *
 * - `ozx`: OME-Zarr (.ome.zarr.ozx) — default
 * - `ome-tiff`: OME-TIFF (.ome.tif) via fiff
 * - All others: ITK-Wasm `writeImage` formats, keyed by file extension
 */
export type OutputFormat =
  | "ozx"
  | "ome-tiff"
  | "nii"
  | "nii.gz"
  | "nrrd"
  | "mha"
  | "vtk"
  | "mrc"
  | "mnc"
  | "mgh"
  | "gipl"
  | "pic"
  | "bmp"
  | "jpg"
  | "png"
  | "hdf5"
  | "aim"
  | "fdf"

/** Human-readable labels for the output format select. */
export const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = {
  ozx: "OME-Zarr (.ozx)",
  "ome-tiff": "OME-TIFF (.ome.tif)",
  nii: "NIfTI (.nii)",
  "nii.gz": "NIfTI compressed (.nii.gz)",
  nrrd: "NRRD (.nrrd)",
  mha: "MetaImage (.mha)",
  vtk: "VTK (.vtk)",
  mrc: "MRC (.mrc)",
  mnc: "MINC (.mnc)",
  mgh: "MGH (.mgh)",
  gipl: "GIPL (.gipl)",
  pic: "BioRad (.pic)",
  bmp: "BMP (.bmp)",
  jpg: "JPEG (.jpg)",
  png: "PNG (.png)",
  hdf5: "HDF5 (.hdf5)",
  aim: "Scanco AIM (.aim)",
  fdf: "Varian FDF (.fdf)",
}

/** File extension (including dot) for each output format. */
const FORMAT_EXTENSION: Record<OutputFormat, string> = {
  ozx: ".ome.zarr.ozx",
  "ome-tiff": ".ome.tif",
  nii: ".nii",
  "nii.gz": ".nii.gz",
  nrrd: ".nrrd",
  mha: ".mha",
  vtk: ".vtk",
  mrc: ".mrc",
  mnc: ".mnc",
  mgh: ".mgh",
  gipl: ".gipl",
  pic: ".pic",
  bmp: ".bmp",
  jpg: ".jpg",
  png: ".png",
  hdf5: ".hdf5",
  aim: ".aim",
  fdf: ".fdf",
}

/** Ordered list of all output formats for the UI select. */
export const OUTPUT_FORMATS: OutputFormat[] = Object.keys(
  OUTPUT_FORMAT_LABELS,
) as OutputFormat[]

export interface ConversionOptions {
  chunkSize: number
  method: Methods
}

export interface ConversionProgress {
  stage: "reading" | "converting" | "downsampling" | "packaging" | "done"
  percent: number
  message: string
}

export type ProgressCallback = (progress: ConversionProgress) => void

/**
 * Callback for per-chunk progress during OMERO computation or OZX packaging.
 *
 * @param stage - Which operation is reporting progress
 * @param completed - Number of chunks completed so far
 * @param total - Total number of chunks to process
 */
export type ChunkProgressCallback = (
  stage: "omero" | "packaging",
  completed: number,
  total: number,
) => void

export interface ConvertResult {
  multiscales: Multiscales
}

/**
 * Extract a usable filename from a URL.
 *
 * Tries the last non-empty path segment first, then falls back to the
 * hostname. The filename is needed because `readImage` uses the file
 * extension for format detection (e.g. `.nii.gz`, `.nrrd`, `.dcm`).
 *
 * @param url - The URL to extract a filename from
 * @returns A filename string suitable for format detection
 */
function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split("/").filter(Boolean)
    if (segments.length > 0) {
      return decodeURIComponent(segments[segments.length - 1])
    }
    return parsed.hostname
  } catch {
    // Last resort: use the raw string's last slash-separated segment
    const parts = url.split("/").filter(Boolean)
    return parts[parts.length - 1] || "image"
  }
}

/**
 * Check whether a URL looks like an OME-Zarr resource.
 *
 * @param url - The URL to check
 * @returns true if the URL path ends with `.ome.zarr` (with optional
 *   trailing slash)
 */
export function isOmeZarrUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase()
    return path.endsWith(".ome.zarr")
  } catch {
    return url.replace(/\/+$/, "").toLowerCase().endsWith(".ome.zarr")
  }
}

/** TIFF extensions recognised by {@link isTiffFilename} and {@link isTiffUrl}. */
const TIFF_EXTENSIONS = [".ome.tif", ".ome.tiff", ".tif", ".tiff"]

/**
 * Check whether a filename has a TIFF extension.
 *
 * @param name - Filename or path to check (case-insensitive)
 * @returns `true` if the name ends with `.tif`, `.tiff`, `.ome.tif`,
 *   or `.ome.tiff`
 */
export function isTiffFilename(name: string): boolean {
  const lower = name.toLowerCase()
  return TIFF_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * Check whether a URL looks like a TIFF file.
 *
 * Inspects the URL path extension first (`.tif`, `.tiff`, `.ome.tif`,
 * `.ome.tiff`).  When the extension is ambiguous a `HEAD` request is
 * issued and the response `Content-Type` is checked for `image/tiff`.
 *
 * @param url - The URL to check
 * @returns `true` if the URL is likely a TIFF resource
 */
export async function isTiffUrl(url: string): Promise<boolean> {
  const pathname = (() => {
    try {
      return new URL(url).pathname.replace(/\/+$/, "").toLowerCase()
    } catch {
      return url.replace(/\/+$/, "").toLowerCase()
    }
  })()

  if (isTiffFilename(pathname)) {
    return true
  }

  // Fall back to a HEAD request when the extension is not conclusive
  try {
    const response = await fetch(url, { method: "HEAD", mode: "cors" })
    if (!response.ok) {
      return false
    }
    const contentType = response.headers.get("content-type") ?? ""
    return contentType.includes("image/tiff")
  } catch {
    return false
  }
}

/**
 * Shared helper that wraps a load function with "reading" / "done" progress
 * events, eliminating the boilerplate duplicated across the public load
 * functions.
 *
 * @param load - Async factory that performs the actual load
 * @param startMessage - Progress message emitted before the load begins
 * @param doneMessage - Progress message emitted after the load completes
 * @param onProgress - Optional callback for progress updates
 * @returns The `Multiscales` returned by `load`
 */
async function loadWithProgress(
  load: () => Promise<Multiscales>,
  startMessage: string,
  doneMessage: string,
  onProgress?: ProgressCallback,
): Promise<Multiscales> {
  onProgress?.({ stage: "reading", percent: 0, message: startMessage })
  const multiscales = await load()
  onProgress?.({ stage: "done", percent: 100, message: doneMessage })
  return multiscales
}

/**
 * Load a TIFF file from a remote URL via HTTP range requests.
 *
 * Uses {@link fromTiff} (backed by `TiffStore.fromUrl`) to stream the
 * TIFF without downloading the entire file up-front.
 *
 * @param url - The remote TIFF URL
 * @param onProgress - Optional callback for progress updates
 * @returns The loaded `Multiscales` from the TIFF
 * @throws If the URL cannot be opened as a TIFF
 */
export async function loadTiffUrl(
  url: string,
  onProgress?: ProgressCallback,
): Promise<Multiscales> {
  return loadWithProgress(
    () => fromTiff(url),
    "Opening TIFF via range requests...",
    "TIFF loaded",
    onProgress,
  )
}

/**
 * Load a local TIFF file via fiff.
 *
 * Uses {@link fromTiff} (backed by `TiffStore.fromBlob`) to read the
 * file directly through fiff rather than decoding via ITK-Wasm.
 *
 * @param file - The local TIFF file
 * @param onProgress - Optional callback for progress updates
 * @returns The loaded `Multiscales` from the TIFF
 * @throws If the file cannot be opened as a TIFF
 */
export async function loadTiffFile(
  file: File,
  onProgress?: ProgressCallback,
): Promise<Multiscales> {
  return loadWithProgress(
    () => fromTiff(file),
    "Reading TIFF file...",
    "TIFF loaded",
    onProgress,
  )
}

/**
 * Load an OME-Zarr dataset from a remote URL.
 *
 * Uses `fromNgffZarr` to parse the remote store and return a
 * `Multiscales` object for direct viewing (no conversion needed).
 *
 * @param url - The OME-Zarr URL to load
 * @param onProgress - Optional callback for progress updates
 * @returns The loaded `Multiscales` from the remote store
 * @throws If the URL cannot be loaded as OME-Zarr
 */
export async function loadOmeZarrUrl(
  url: string,
  onProgress?: ProgressCallback,
): Promise<Multiscales> {
  return loadWithProgress(
    () => fromNgffZarr(url),
    "Loading OME-Zarr metadata...",
    "OME-Zarr loaded",
    onProgress,
  )
}

/**
 * Fetch an image from a remote URL and return it as a `File`.
 *
 * The response body is streamed so that download progress can be
 * reported when the server provides a `Content-Length` header.
 *
 * @param url - The URL to fetch the image from
 * @param onProgress - Optional callback for download progress updates
 * @returns A `File` wrapping the fetched bytes with a name derived from
 *   the URL (used by `readImage` for format detection)
 * @throws If the fetch fails or the server returns a non-OK status
 */
export async function fetchImageFile(
  url: string,
  onProgress?: ProgressCallback,
): Promise<File> {
  const report = (percent: number, message: string) => {
    onProgress?.({ stage: "reading", percent, message })
  }

  report(0, "Fetching image from URL...")

  const response = await fetch(url, { mode: "cors" })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch URL (${response.status} ${response.statusText})`,
    )
  }

  const contentLength = response.headers.get("Content-Length")
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0
  const filename = filenameFromUrl(url)

  // Stream the body so we can report download progress
  if (totalBytes > 0 && response.body) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let receivedBytes = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      receivedBytes += value.byteLength
      const pct = Math.min(Math.round((receivedBytes / totalBytes) * 10), 10)
      report(
        pct,
        `Downloading... ${formatFileSize(receivedBytes)} / ${formatFileSize(totalBytes)}`,
      )
    }

    // Concatenate chunks into a single buffer
    const buffer = new Uint8Array(receivedBytes)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.byteLength
    }

    report(10, `Downloaded ${formatFileSize(receivedBytes)}`)
    return new File([buffer], filename)
  }

  // Fallback: no Content-Length or no body streaming — read all at once
  const arrayBuffer = await response.arrayBuffer()
  report(10, `Downloaded ${formatFileSize(arrayBuffer.byteLength)}`)
  return new File([arrayBuffer], filename)
}

/**
 * Generate the output filename from the input name and output format.
 *
 * @param inputName - The original input filename (or URL-derived name)
 * @param format - The target output format
 * @returns A filename with the appropriate extension
 */
function outputFilename(inputName: string, format: OutputFormat): string {
  // Strip existing extension(s) — handle compound extensions like .nii.gz
  const baseName = inputName
    .replace(/\.ome\.zarr\.ozx$/i, "")
    .replace(/\.ome\.zarr$/i, "")
    .replace(/\.ome\.tiff?$/i, "")
    .replace(/\.nii\.gz$/i, "")
    .replace(/\.gipl\.gz$/i, "")
    .replace(/\.mnc\.gz$/i, "")
    .replace(/\.mgh\.gz$/i, "")
    .replace(/\.iwi\.cbor\.zst$/i, "")
    .replace(/\.iwi\.cbor$/i, "")
    .replace(/\.[^/.]+$/, "")
  return `${baseName}${FORMAT_EXTENSION[format]}`
}

/**
 * Package a `Multiscales` object into the requested output format.
 *
 * @param multiscales - The multiscale pyramid to package
 * @param inputName - The original input filename (used to derive the
 *   output filename)
 * @param format - The target output format
 * @param onProgress - Optional callback for progress updates
 * @param onChunkProgress - Optional callback for per-chunk progress
 * @returns The serialized file bytes and output filename
 */
export async function packageOutput(
  multiscales: Multiscales,
  inputName: string,
  format: OutputFormat,
  onProgress?: ProgressCallback,
  onChunkProgress?: ChunkProgressCallback,
): Promise<{ outputData: Uint8Array; filename: string }> {
  const report = (percent: number, message: string) => {
    onProgress?.({ stage: "packaging", percent, message })
  }

  const filename = outputFilename(inputName, format)

  if (format === "ozx") {
    report(80, "Creating OZX file...")
    const ozxData = await toNgffZarrOzx(multiscales, {
      enabledRfcs: [4],
      onProgress: onChunkProgress
        ? (completed, total) => onChunkProgress("packaging", completed, total)
        : undefined,
    })
    return { outputData: ozxData, filename }
  }

  if (format === "ome-tiff") {
    report(80, "Creating OME-TIFF file...")
    const pool = new WorkerPool(navigator.hardwareConcurrency ?? 4)
    try {
      const options: FiffWriteOptions = {
        compression: "deflate",
        pool,
        getPlane: zarrGet as FiffWriteOptions["getPlane"],
      }
      const buffer = await toOmeTiff(multiscales, options)
      return { outputData: new Uint8Array(buffer), filename }
    } finally {
      pool.terminateWorkers()
    }
  }

  // ITK-Wasm formats: convert the highest-resolution NgffImage
  // back to an ITK-Wasm Image, then serialize with writeImage.
  report(80, "Converting to ITK-Wasm Image...")
  const highResImage = multiscales.images[0]
  const itkImage = await ngffImageToItkImage(highResImage)

  report(90, `Writing ${FORMAT_EXTENSION[format]} file...`)
  const { serializedImage, webWorker } = await writeImage(itkImage, filename)
  ;(webWorker as Worker | null)?.terminate()

  // itk-wasm allocates output buffers on SharedArrayBuffer when
  // available (COOP/COEP context). Blob rejects shared views, so
  // copy into a plain ArrayBuffer-backed Uint8Array.
  return { outputData: new Uint8Array(serializedImage.data), filename }
}

/**
 * Shared OMERO + multiscale pipeline used by both {@link convertImage} and
 * {@link convertMultiscales}.
 *
 * Computes OMERO visualization metadata, generates a multiscale pyramid via
 * {@link toMultiscales}, upgrades the metadata to version 0.5, and returns a
 * fully-formed {@link ConvertResult}.
 *
 * @param sourceImage - Highest-resolution source image to downsample
 * @param method - Downsampling method to use
 * @param options - Conversion options (chunk size)
 * @param report - Pre-bound progress reporter from the calling function
 * @param onChunkProgress - Optional callback for per-chunk progress
 * @returns The assembled multiscale pyramid wrapped in a {@link ConvertResult}
 */
async function buildMultiscales(
  sourceImage: NgffImage,
  method: Methods,
  options: ConversionOptions,
  report: (
    stage: ConversionProgress["stage"],
    percent: number,
    message: string,
  ) => void,
  onChunkProgress?: ChunkProgressCallback,
): Promise<ConvertResult> {
  // Compute OMERO visualization metadata.
  // A shared chunk cache lets computeOmeroFromNgffImage cache decoded chunks,
  // which can speed up OMERO computation by reusing chunks across channels.
  report("converting", 25, "Computing OMERO visualization metadata...")
  const chunkCache = new Map()
  const omero = await computeOmeroFromNgffImage(sourceImage, {
    cache: chunkCache,
    onProgress: onChunkProgress
      ? (completed, total) => onChunkProgress("omero", completed, total)
      : undefined,
  })

  // Generate multiscale pyramid.
  // Use uncompressed codecs since the zarr arrays are ephemeral
  // in-memory data. packageOutput() will re-read and re-encode
  // the chunks in the final output format (OZX applies its own
  // blosc/zstd, OME-TIFF applies deflate, ITK-Wasm serializes
  // directly). Skipping the intermediate compression avoids a
  // wasteful compress → decompress round-trip.
  report("downsampling", 30, "Generating multiscale pyramid...")
  const multiscalesV04 = await toMultiscales(sourceImage, {
    method,
    chunks: options.chunkSize,
    codecs: bytesOnlyCodecs(),
  })
  report(
    "downsampling",
    70,
    `Created ${multiscalesV04.images.length} scale levels`,
  )

  // toMultiscales creates version 0.4 by default, but toNgffZarrOzx requires 0.5.
  // Create a new Multiscales with version 0.5 metadata and OMERO visualization data.
  const metadataV05 = createMetadataWithVersion(multiscalesV04.metadata, "0.5")
  metadataV05.omero = omero

  const multiscales = new MultiscalesClass({
    images: multiscalesV04.images,
    metadata: metadataV05,
    scaleFactors: multiscalesV04.scaleFactors,
    method: multiscalesV04.method,
    chunks: multiscalesV04.chunks,
  })

  report("done", 100, "Conversion complete!")

  return { multiscales }
}

/**
 * Convert an image file into a multiscale pyramid.
 *
 * Reads the input image, generates a multiscale pyramid with the
 * selected downsampling method, and returns the result. Packaging
 * into a specific output format is handled separately by
 * {@link packageOutput}.
 *
 * @param file - The input image file
 * @param options - Conversion options (chunk size, downsampling method)
 * @param onProgress - Optional callback for progress updates
 * @param onChunkProgress - Optional callback for per-chunk progress
 * @returns The multiscale pyramid
 */
export async function convertImage(
  file: File,
  options: ConversionOptions,
  onProgress?: ProgressCallback,
  onChunkProgress?: ChunkProgressCallback,
): Promise<ConvertResult> {
  const report = (
    stage: ConversionProgress["stage"],
    percent: number,
    message: string,
  ) => {
    onProgress?.({ stage, percent, message })
  }

  // Stage 1: Read the image file
  report("reading", 0, "Reading image file...")
  const arrayBuffer = await file.arrayBuffer()

  report("reading", 10, "Decoding image...")
  const { image: itkImage, webWorker } = await readImage({
    data: new Uint8Array(arrayBuffer),
    path: file.name,
  })
  ;(webWorker as Worker | null)?.terminate()

  // Auto-detect label images when the user hasn't changed from the default method.
  // Label images use mode-based downsampling to preserve discrete label values.
  let method = options.method
  if (method === Methods.ITKWASM_GAUSSIAN && isLabelImage(itkImage)) {
    method = Methods.ITKWASM_LABEL_IMAGE
    report("reading", 15, "Detected label image, using label downsampling...")
  }

  // Stage 2: Convert to NgffImage
  report("converting", 20, "Converting to NGFF format...")
  // Enable anatomical orientation for formats that carry it in their
  // headers so the affine and NiiVue markers reflect the true layout.
  const lowerName = file.name.toLowerCase()
  const isLikelyDicom =
    lowerName.endsWith(".dcm") ||
    // DICOM series are often stored without an extension or with numeric extensions
    !lowerName.includes(".") ||
    /\.\d+$/.test(lowerName)
  const hasOrientation =
    // Compressed NIfTI before considering any generic .gz patterns
    lowerName.endsWith(".nii.gz") ||
    lowerName.endsWith(".nii") ||
    lowerName.endsWith(".nrrd") ||
    lowerName.endsWith(".nhdr") ||
    lowerName.endsWith(".mha") ||
    lowerName.endsWith(".mhd") ||
    lowerName.endsWith(".mnc") ||
    lowerName.endsWith(".gipl") ||
    lowerName.endsWith(".hdf5") ||
    lowerName.endsWith(".fdf") ||
    lowerName.endsWith(".mgz") ||
    lowerName.endsWith(".img") ||
    lowerName.endsWith(".hdr") ||
    isLikelyDicom
  const ngffImage = await itkImageToNgffImage(itkImage, {
    addAnatomicalOrientation: hasOrientation,
    chunks: options.chunkSize,
  })

  // Stage 2b–3: Compute OMERO metadata, downsample, and assemble result.
  return buildMultiscales(ngffImage, method, options, report, onChunkProgress)
}

/**
 * Re-downsample an already-loaded `Multiscales` with new settings.
 *
 * Takes the highest-resolution image from the source multiscales,
 * re-runs the downsampling pipeline, and computes OMERO visualization
 * metadata. This is used for TIFF URLs loaded via fiff where we
 * already have a `Multiscales` but the user wants to change the
 * chunk size or downsampling method.
 *
 * @param source - The pre-loaded multiscales (e.g. from a TIFF URL)
 * @param options - Conversion options (chunk size, downsampling method)
 * @param onProgress - Optional callback for progress updates
 * @param onChunkProgress - Optional callback for per-chunk progress
 * @returns A new multiscale pyramid with the requested settings
 */
export async function convertMultiscales(
  source: Multiscales,
  options: ConversionOptions,
  onProgress?: ProgressCallback,
  onChunkProgress?: ChunkProgressCallback,
): Promise<ConvertResult> {
  const report = (
    stage: ConversionProgress["stage"],
    percent: number,
    message: string,
  ) => {
    onProgress?.({ stage, percent, message })
  }

  // Use the highest-resolution image as the source
  const highResImage = source.images[0]

  return buildMultiscales(
    highResImage,
    options.method,
    options,
    report,
    onChunkProgress,
  )
}

/**
 * Export an already-loaded `Multiscales` to the requested output format.
 *
 * Used when the source is an OME-Zarr URL that was loaded directly
 * (no input file conversion needed).
 *
 * @param multiscales - The loaded multiscale pyramid
 * @param name - A base name for the output file (e.g. from the URL)
 * @param format - The target output format
 * @param onProgress - Optional callback for progress updates
 * @returns The serialized file bytes and output filename
 */
export async function exportMultiscales(
  multiscales: Multiscales,
  name: string,
  format: OutputFormat,
  onProgress?: ProgressCallback,
): Promise<{ outputData: Uint8Array; filename: string }> {
  return packageOutput(multiscales, name, format, onProgress)
}

/**
 * Trigger a file download in the browser
 */
export function downloadFile(data: Uint8Array, filename: string): void {
  const blob = new Blob([data as unknown as BlobPart], {
    type: "application/octet-stream",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

/**
 * Get multiscales info for display in the table
 */
export interface ScaleInfo {
  level: number
  path: string
  shape: string
  chunks: string
  size: string
}

export function getMultiscalesInfo(multiscales: Multiscales): ScaleInfo[] {
  return multiscales.images.map((image: NgffImage, index: number) => {
    const dataset = multiscales.metadata.datasets[index]
    const shape = image.data.shape
    const chunks =
      image.data.chunks || shape.map((s: number) => Math.min(s, 64))

    // Estimate size: shape product * bytes per element
    const dtype = image.data.dtype
    const bytesPerElement = getBytesPerElement(dtype)
    const totalElements = shape.reduce((a: number, b: number) => a * b, 1)
    const estimatedSize = totalElements * bytesPerElement

    return {
      level: index,
      path: dataset?.path || `scale${index}`,
      shape: shape.join(" x "),
      chunks: chunks.join(" x "),
      size: formatFileSize(estimatedSize),
    }
  })
}

function getBytesPerElement(dtype: string): number {
  const dtypeBytes: Record<string, number> = {
    int8: 1,
    uint8: 1,
    int16: 2,
    uint16: 2,
    int32: 4,
    uint32: 4,
    int64: 8,
    uint64: 8,
    float32: 4,
    float64: 8,
  }
  return dtypeBytes[dtype] || 4
}

// -------- ROI Cropping --------

/**
 * Spatial dimension name → PixelRegion axis index.
 * PixelRegion stores values in [z, y, x] order.
 */
const SPATIAL_DIM_INDEX: Record<string, 0 | 1 | 2> = { z: 0, y: 1, x: 2 }

/**
 * Check whether a set of ROI bounds covers the full volume.
 *
 * @param roi - ROI bounds in world coordinates
 * @param volumeBounds - Full volume bounds in world coordinates
 * @returns `true` when the ROI is (approximately) equal to the full volume
 */
export function isFullVolume(
  roi: VolumeBounds,
  volumeBounds: VolumeBounds,
): boolean {
  const tol = 0.01
  return (
    Math.abs(roi.min[0] - volumeBounds.min[0]) < tol &&
    Math.abs(roi.min[1] - volumeBounds.min[1]) < tol &&
    Math.abs(roi.min[2] - volumeBounds.min[2]) < tol &&
    Math.abs(roi.max[0] - volumeBounds.max[0]) < tol &&
    Math.abs(roi.max[1] - volumeBounds.max[1]) < tol &&
    Math.abs(roi.max[2] - volumeBounds.max[2]) < tol
  )
}

/**
 * Crop the highest-resolution image in a `Multiscales` to an ROI,
 * rebuild the downsampled pyramid, and return a new `ConvertResult`.
 *
 * The ROI is specified in OME-Zarr world coordinates (the same space
 * as `VolumeBounds`). The crop region is aligned to chunk boundaries
 * so that only whole chunks are fetched from the source zarr array.
 *
 * @param source - The multiscale pyramid to crop
 * @param roi - Bounding box in world coordinates [x, y, z]
 * @param options - Conversion options (chunk size, downsampling method)
 * @param onProgress - Optional callback for progress updates
 * @param onChunkProgress - Optional callback for per-chunk progress
 * @returns A new multiscale pyramid containing only the cropped region
 */
export async function cropMultiscales(
  source: Multiscales,
  roi: VolumeBounds,
  options: ConversionOptions,
  onProgress?: ProgressCallback,
  onChunkProgress?: ChunkProgressCallback,
): Promise<ConvertResult> {
  const report = (
    stage: ConversionProgress["stage"],
    percent: number,
    message: string,
  ) => {
    onProgress?.({ stage, percent, message })
  }

  report("reading", 0, "Cropping to ROI...")

  const sourceImage = source.images[0]
  const shape = getVolumeShape(sourceImage)
  const dims = sourceImage.dims

  // --- Convert world ROI to pixel coordinates ---
  // worldToPixel returns [z, y, x]
  const minPixelRaw = worldToPixel(roi.min, sourceImage)
  const maxPixelRaw = worldToPixel(roi.max, sourceImage)

  // Ensure proper ordering (min ≤ max) and clamp to valid range
  const minPixel: [number, number, number] = [
    Math.max(0, Math.floor(Math.min(minPixelRaw[0], maxPixelRaw[0]))),
    Math.max(0, Math.floor(Math.min(minPixelRaw[1], maxPixelRaw[1]))),
    Math.max(0, Math.floor(Math.min(minPixelRaw[2], maxPixelRaw[2]))),
  ]
  const maxPixel: [number, number, number] = [
    Math.min(shape[0], Math.ceil(Math.max(minPixelRaw[0], maxPixelRaw[0]))),
    Math.min(shape[1], Math.ceil(Math.max(minPixelRaw[1], maxPixelRaw[1]))),
    Math.min(shape[2], Math.ceil(Math.max(minPixelRaw[2], maxPixelRaw[2]))),
  ]

  // --- Align to chunk boundaries ---
  // Chunk shape from the source zarr array, mapped to [z, y, x]
  const rawChunks = sourceImage.data.chunks ?? sourceImage.data.shape
  const chunkZ =
    dims.indexOf("z") !== -1 ? rawChunks[dims.indexOf("z")] : shape[0]
  const chunkY = rawChunks[dims.indexOf("y")]
  const chunkX = rawChunks[dims.indexOf("x")]

  const alignedMin: [number, number, number] = [
    Math.floor(minPixel[0] / chunkZ) * chunkZ,
    Math.floor(minPixel[1] / chunkY) * chunkY,
    Math.floor(minPixel[2] / chunkX) * chunkX,
  ]
  const alignedMax: [number, number, number] = [
    Math.min(Math.ceil(maxPixel[0] / chunkZ) * chunkZ, shape[0]),
    Math.min(Math.ceil(maxPixel[1] / chunkY) * chunkY, shape[1]),
    Math.min(Math.ceil(maxPixel[2] / chunkX) * chunkX, shape[2]),
  ]

  report("reading", 5, "Fetching cropped region from source...")

  // --- Build zarrGet selection from aligned pixel region ---
  // The selection array must match the dims order of the source image.
  // Spatial dims get slice ranges; non-spatial dims (c, t) get null.
  const selection = dims.map((dim) => {
    const spatialIdx = SPATIAL_DIM_INDEX[dim]
    if (spatialIdx !== undefined) {
      return {
        start: alignedMin[spatialIdx],
        stop: alignedMax[spatialIdx],
        step: null,
      }
    }
    // Non-spatial dims: select all (c) or first frame (t)
    if (dim === "t") return 0
    return null
  })

  // Read the cropped region from the source zarr array
  const cropped = await zarrGet(
    sourceImage.data,
    selection as Parameters<typeof zarrGet>[1],
  )

  report("reading", 15, "Building cropped image...")

  // --- Compute new translation for the cropped region ---
  // The crop's origin in world space is the aligned pixel start
  const croppedTranslation = pixelToWorld(alignedMin, sourceImage)

  // --- Compute the cropped shape in array dim order ---
  const croppedSpatialShape: Record<string, number> = {
    z: alignedMax[0] - alignedMin[0],
    y: alignedMax[1] - alignedMin[1],
    x: alignedMax[2] - alignedMin[2],
  }

  // Build ITK-Wasm Image from cropped data
  // ITK-Wasm stores size in physical order [x, y, z] (reversed from
  // the OME-Zarr array order [z, y, x]).
  const spatialDims = dims.filter((d) => d === "x" || d === "y" || d === "z")
  const hasChannel = dims.includes("c")
  const cIdx = dims.indexOf("c")
  const components = hasChannel ? sourceImage.data.shape[cIdx] : 1

  // ITK size is [x, y, z] or [x, y] for 2D
  const itkSize = spatialDims.includes("z")
    ? [croppedSpatialShape.x, croppedSpatialShape.y, croppedSpatialShape.z]
    : [croppedSpatialShape.x, croppedSpatialShape.y]

  // ITK spacing is [x, y, z] (world units per pixel)
  const sx = sourceImage.scale.x ?? sourceImage.scale.X ?? 1
  const sy = sourceImage.scale.y ?? sourceImage.scale.Y ?? 1
  const sz = sourceImage.scale.z ?? sourceImage.scale.Z ?? 1
  const itkSpacing = spatialDims.includes("z") ? [sx, sy, sz] : [sx, sy]

  // ITK origin = world coordinate of the cropped region's first pixel
  // croppedTranslation is [x, y, z] from pixelToWorld
  const itkOrigin = spatialDims.includes("z")
    ? [croppedTranslation[0], croppedTranslation[1], croppedTranslation[2]]
    : [croppedTranslation[0], croppedTranslation[1]]

  // Map zarr dtype to ITK componentType
  const componentType = sourceImage.data.dtype as
    | "int8"
    | "uint8"
    | "int16"
    | "uint16"
    | "int32"
    | "uint32"
    | "int64"
    | "uint64"
    | "float32"
    | "float64"

  // Build the ITK direction matrix (identity — we preserve orientation
  // from the source, and since we only do axis-aligned crops the
  // direction doesn't change).
  const dimension = itkSize.length
  const direction = new Float64Array(dimension * dimension)
  for (let i = 0; i < dimension; i++) {
    direction[i * dimension + i] = 1.0
  }

  // Copy the direction from the source if axesOrientations are present.
  // The ITK direction matrix encodes the mapping from voxel axes to
  // physical axes.  For axis-aligned crops the direction is preserved.
  // We pass addAnatomicalOrientation=false to itkImageToNgffImage and
  // copy axesOrientations from the source manually, which avoids
  // re-computing orientation from a potentially identity direction matrix.

  // Ensure cropped data is a plain (non-shared) ArrayBuffer view
  // so itkImageToNgffImage can handle it (SharedArrayBuffer may
  // cause issues with zarr codec encoders).
  const croppedData = cropped as {
    data: ArrayBufferView
    shape: number[]
    stride: number[]
  }
  let dataView = croppedData.data
  if (dataView.buffer instanceof SharedArrayBuffer) {
    const copy = new (
      dataView.constructor as { new (buffer: ArrayBuffer): ArrayBufferView }
    )(new ArrayBuffer(dataView.byteLength))
    new Uint8Array(copy.buffer).set(
      new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength),
    )
    dataView = copy
  }

  const itkImage: Image = {
    imageType: {
      dimension,
      componentType,
      pixelType: components > 1 ? "VariableLengthVector" : "Scalar",
      components,
    },
    name: sourceImage.name || "cropped",
    origin: itkOrigin,
    spacing: itkSpacing,
    direction,
    size: itkSize,
    data: dataView as unknown as Image["data"],
    metadata: new Map(),
  }

  const croppedNgff = await itkImageToNgffImage(itkImage, {
    addAnatomicalOrientation: false,
    chunks: options.chunkSize,
  })

  // Preserve axesOrientations from the source image (axis-aligned
  // crop doesn't change orientation).
  const croppedWithOrientation: NgffImage = croppedNgff
  if (sourceImage.axesOrientations) {
    // We need the actual NgffImage class constructor, but we only have
    // the type import.  Use the same pattern as itkImageToNgffImage:
    // create a new NgffImage from the existing one's properties, adding
    // the missing axesOrientations.  Since NgffImage's constructor is
    // internal to ngff-zarr, we work around it by re-using
    // itkImageToNgffImage which already produced a valid NgffImage.
    // For the axesOrientations, we assign them via a thin wrapper.
    //
    // The NgffImage class stores axesOrientations as a readonly property
    // set in the constructor.  Since we can't call the constructor
    // directly from here, we use Object.defineProperty to attach them.
    Object.defineProperty(croppedWithOrientation, "axesOrientations", {
      value: { ...sourceImage.axesOrientations },
      writable: false,
      enumerable: true,
      configurable: true,
    })
  }

  report("converting", 20, "Building multiscale pyramid for cropped region...")

  // Re-use the standard buildMultiscales pipeline
  return buildMultiscales(
    croppedWithOrientation,
    options.method,
    options,
    report,
    onChunkProgress,
  )
}
