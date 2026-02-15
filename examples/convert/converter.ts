/**
 * Image to OME-Zarr conversion pipeline
 */

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
  itkImageToNgffImage,
  toNgffZarrOzx,
} from "@fideus-labs/ngff-zarr/browser"
import { readImage } from "@itk-wasm/image-io"
import type { Image } from "itk-wasm"

export { Methods } from "@fideus-labs/ngff-zarr"

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

export interface ConversionResult {
  multiscales: Multiscales
  ozxData: Uint8Array
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
 * Convert an image file to OME-Zarr 0.5 format
 */
export async function convertToOmeZarr(
  file: File,
  options: ConversionOptions,
  onProgress?: ProgressCallback,
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
  webWorker?.terminate()

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

  // Stage 4: Package as OZX
  report("packaging", 80, "Creating OZX file...")
  const ozxData = await toNgffZarrOzx(multiscales, {
    enabledRfcs: [4], // Enable RFC-4 for anatomical orientation
  })

  // Generate output filename
  const baseName = file.name.replace(/\.[^/.]+$/, "")
  const filename = `${baseName}.ome.zarr.ozx`

  report("done", 100, "Conversion complete!")

  return {
    multiscales,
    ozxData,
    filename,
  }
}

/**
 * Trigger a file download in the browser
 */
export function downloadFile(data: Uint8Array, filename: string): void {
  const blob = new Blob([data as unknown as BlobPart], {
    type: "application/zip",
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
