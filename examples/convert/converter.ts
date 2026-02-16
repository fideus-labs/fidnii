/**
 * Image conversion pipeline with multiple output format support
 */

import type { WriteOptions as FiffWriteOptions } from "@fideus-labs/fiff"
import { toOmeTiff } from "@fideus-labs/fiff"
import {
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
  outputFormat: OutputFormat
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

export interface ConversionResult {
  multiscales: Multiscales
  outputData: Uint8Array
  filename: string
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
  onProgress?.({
    stage: "reading",
    percent: 0,
    message: "Loading OME-Zarr metadata...",
  })

  const multiscales = await fromNgffZarr(url)

  onProgress?.({
    stage: "done",
    percent: 100,
    message: "OME-Zarr loaded",
  })

  return multiscales
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
 * @returns The serialized file bytes and output filename
 */
async function packageOutput(
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
 * Convert an image file to the requested output format.
 *
 * The pipeline reads the input image, generates a multiscale pyramid,
 * then packages the result in the requested format.
 *
 * @param file - The input image file
 * @param options - Conversion options (chunk size, method, output format)
 * @param onProgress - Optional callback for progress updates
 * @returns The conversion result with multiscales, output bytes, and filename
 */
export async function convertImage(
  file: File,
  options: ConversionOptions,
  onProgress?: ProgressCallback,
  onChunkProgress?: ChunkProgressCallback,
): Promise<ConversionResult> {
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
  const ngffImage = await itkImageToNgffImage(itkImage)

  // Stage 2b: Compute OMERO visualization metadata from highest resolution image.
  // A shared chunk cache lets computeOmeroFromNgffImage cache decoded chunks,
  // which can speed up OMERO computation by reusing chunks across channels.
  report("converting", 25, "Computing OMERO visualization metadata...")
  const chunkCache = new Map()
  const omero = await computeOmeroFromNgffImage(ngffImage, {
    cache: chunkCache,
    onProgress: onChunkProgress
      ? (completed, total) => onChunkProgress("omero", completed, total)
      : undefined,
  })

  // Stage 3: Generate multiscales (downsampling)
  report("downsampling", 30, "Generating multiscale pyramid...")

  const multiscalesV04 = await toMultiscales(ngffImage, {
    method,
    chunks: options.chunkSize,
  })

  report(
    "downsampling",
    70,
    `Created ${multiscalesV04.images.length} scale levels`,
  )

  // toMultiscales creates version 0.4 by default, but toNgffZarrOzx requires 0.5
  // Create a new Multiscales with version 0.5 metadata and OMERO visualization data
  const metadataV05 = createMetadataWithVersion(multiscalesV04.metadata, "0.5")
  metadataV05.omero = omero // Attach computed OMERO visualization metadata

  const multiscales = new MultiscalesClass({
    images: multiscalesV04.images,
    metadata: metadataV05,
    scaleFactors: multiscalesV04.scaleFactors,
    method: multiscalesV04.method,
    chunks: multiscalesV04.chunks,
  })

  // Stage 4: Package in the requested output format
  const { outputData, filename } = await packageOutput(
    multiscales,
    file.name,
    options.outputFormat,
    onProgress,
    onChunkProgress,
  )

  report("done", 100, "Conversion complete!")

  return {
    multiscales,
    outputData,
    filename,
  }
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
