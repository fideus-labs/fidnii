/**
 * Image to OME-Zarr conversion pipeline
 */

import { readImage } from "@itk-wasm/image-io";
// Import from browser subpath for browser-compatible functions
import {
  createMetadataWithVersion,
  type Multiscales,
  Multiscales as MultiscalesClass,
  type NgffImage,
  NgffImage as NgffImageClass,
  toMultiscales,
} from "@fideus-labs/ngff-zarr";
// Import browser-specific toNgffZarrOzx which returns Uint8Array
// (Node version takes a path and returns void)
import {
  computeOmeroFromNgffImage,
  toNgffZarrOzx,
} from "@fideus-labs/ngff-zarr/browser";
// itkImageToNgffImage is not in browser exports, but the main module has browser condition
// that should resolve to browser-mod.js - we need to use the main import for this
import type { Image } from "itk-wasm";
import * as zarr from "zarrita";
import { zarrSet } from "@fideus-labs/ngff-zarr/browser";

// Inline itkImageToNgffImage since it's not exported from browser module
// This is a simplified version based on ngff-zarr's implementation
async function itkImageToNgffImage(itkImage: Image): Promise<NgffImageClass> {
  const shape = [...itkImage.size].reverse();
  const spacing = itkImage.spacing;
  const origin = itkImage.origin;
  const ndim = shape.length;
  const imageType = itkImage.imageType;
  const isVector = imageType.components > 1;

  // Determine dimension names
  let dims: string[];
  if (ndim === 3 && isVector) {
    dims = ["y", "x", "c"];
  } else if (ndim < 4) {
    dims = ["z", "y", "x"].slice(-ndim);
  } else if (ndim < 5) {
    dims = isVector ? ["z", "y", "x", "c"] : ["t", "z", "y", "x"];
  } else if (ndim < 6) {
    dims = ["t", "z", "y", "x", "c"];
  } else {
    throw new Error(`Unsupported number of dimensions: ${ndim}`);
  }

  // Identify spatial dimensions
  const allSpatialDims = new Set(["x", "y", "z"]);
  const spatialDims = dims.filter((dim) => allSpatialDims.has(dim));

  // Create scale from spacing (reversed to match array order)
  const scale: Record<string, number> = {};
  const reversedSpacing = spacing.slice().reverse();
  spatialDims.forEach((dim, idx) => {
    scale[dim] = reversedSpacing[idx];
  });

  // Create translation from origin (reversed to match array order)
  const translation: Record<string, number> = {};
  const reversedOrigin = origin.slice().reverse();
  spatialDims.forEach((dim, idx) => {
    translation[dim] = reversedOrigin[idx];
  });

  // Create Zarr array from ITK-Wasm data
  const store = new Map<string, Uint8Array>();
  const root = zarr.root(store);
  const chunkShape = shape.map((s: number) => Math.min(s, 256));

  const zarrArray = await zarr.create(root.resolve("image"), {
    shape: shape,
    chunk_shape: chunkShape,
    data_type: imageType.componentType as zarr.DataType,
    fill_value: 0,
  });

  // Write the ITK-Wasm data to the zarr array
  const selection = new Array(ndim).fill(null);
  const strides = getStrides(shape);
  const dataChunk = {
    data: itkImage.data as zarr.TypedArray<typeof imageType.componentType>,
    shape: shape,
    stride: strides,
  };
  await zarrSet(zarrArray, selection, dataChunk);

  return new NgffImageClass({
    data: zarrArray,
    dims,
    scale,
    translation,
    name: "image",
    axesUnits: undefined,
    axesOrientations: undefined,
    computedCallbacks: undefined,
  });
}

// Calculate C-order strides for a shape
function getStrides(shape: number[]): number[] {
  const strides = new Array(shape.length);
  strides[shape.length - 1] = 1;
  for (let i = shape.length - 2; i >= 0; i--) {
    strides[i] = strides[i + 1] * shape[i + 1];
  }
  return strides;
}

export interface ConversionOptions {
  chunkSize: number;
  scaleLevels: number; // 0 = auto
}

export interface ConversionProgress {
  stage: "reading" | "converting" | "downsampling" | "packaging" | "done";
  percent: number;
  message: string;
}

export type ProgressCallback = (progress: ConversionProgress) => void;

export interface ConversionResult {
  multiscales: Multiscales;
  ozxData: Uint8Array;
  filename: string;
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
    onProgress?.({ stage, percent, message });
  };

  // Stage 1: Read the image file
  report("reading", 0, "Reading image file...");
  const arrayBuffer = await file.arrayBuffer();

  report("reading", 10, "Decoding image...");
  const { image: itkImage, webWorker } = await readImage({
    data: new Uint8Array(arrayBuffer),
    path: file.name,
  });
  webWorker?.terminate();

  // Stage 2: Convert to NgffImage
  report("converting", 20, "Converting to NGFF format...");
  const ngffImage = await itkImageToNgffImage(itkImage);

  // Stage 2b: Compute OMERO visualization metadata from highest resolution image
  report("converting", 25, "Computing OMERO visualization metadata...");
  const omero = await computeOmeroFromNgffImage(ngffImage);

  // Stage 3: Generate multiscales (downsampling)
  report("downsampling", 30, "Generating multiscale pyramid...");

  // Calculate scale factors if auto (0)
  let scaleFactors: number[] | undefined;
  if (options.scaleLevels > 0) {
    scaleFactors = [];
    for (let i = 0; i < options.scaleLevels; i++) {
      scaleFactors.push(Math.pow(2, i));
    }
  }

  const multiscalesV04 = await toMultiscales(ngffImage, {
    scaleFactors,
    chunks: options.chunkSize,
  });

  report(
    "downsampling",
    70,
    `Created ${multiscalesV04.images.length} scale levels`,
  );

  // toMultiscales creates version 0.4 by default, but toNgffZarrOzx requires 0.5
  // Create a new Multiscales with version 0.5 metadata and OMERO visualization data
  const metadataV05 = createMetadataWithVersion(multiscalesV04.metadata, "0.5");
  metadataV05.omero = omero; // Attach computed OMERO visualization metadata

  const multiscales = new MultiscalesClass({
    images: multiscalesV04.images,
    metadata: metadataV05,
    scaleFactors: multiscalesV04.scaleFactors,
    method: multiscalesV04.method,
    chunks: multiscalesV04.chunks,
  });

  // Stage 4: Package as OZX
  report("packaging", 80, "Creating OZX file...");
  const ozxData = await toNgffZarrOzx(multiscales, {
    enabledRfcs: [4], // Enable RFC-4 for anatomical orientation
  });

  // Generate output filename
  const baseName = file.name.replace(/\.[^/.]+$/, "");
  const filename = `${baseName}.ome.zarr.ozx`;

  report("done", 100, "Conversion complete!");

  return {
    multiscales,
    ozxData,
    filename,
  };
}

/**
 * Trigger a file download in the browser
 */
export function downloadFile(data: Uint8Array, filename: string): void {
  const blob = new Blob([data as unknown as BlobPart], {
    type: "application/zip",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Get multiscales info for display in the table
 */
export interface ScaleInfo {
  level: number;
  path: string;
  shape: string;
  chunks: string;
  size: string;
}

export function getMultiscalesInfo(multiscales: Multiscales): ScaleInfo[] {
  return multiscales.images.map((image: NgffImage, index: number) => {
    const dataset = multiscales.metadata.datasets[index];
    const shape = image.data.shape;
    const chunks = image.data.chunks ||
      shape.map((s: number) => Math.min(s, 64));

    // Estimate size: shape product * bytes per element
    const dtype = image.data.dtype;
    const bytesPerElement = getBytesPerElement(dtype);
    const totalElements = shape.reduce((a: number, b: number) => a * b, 1);
    const estimatedSize = totalElements * bytesPerElement;

    return {
      level: index,
      path: dataset?.path || `scale${index}`,
      shape: shape.join(" x "),
      chunks: chunks.join(" x "),
      size: formatFileSize(estimatedSize),
    };
  });
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
  };
  return dtypeBytes[dtype] || 4;
}
