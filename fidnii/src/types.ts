// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { Multiscales } from "@fideus-labs/ngff-zarr";
import type { Niivue } from "@niivue/niivue";

/**
 * A single clip plane defined by a point and normal vector.
 * The plane equation is: normal · (P - point) = 0
 * Points on the positive side of the normal are kept (visible).
 */
export interface ClipPlane {
  /** A point on the plane (center of volume projected to plane) [x, y, z] in world coordinates */
  point: [number, number, number];
  /** Unit normal vector pointing toward visible region [x, y, z] */
  normal: [number, number, number];
}

/**
 * Collection of clip planes that define the visible region.
 * Each plane clips away the half-space on the negative side of its normal.
 * Maximum 6 planes (NiiVue limit). Empty array = full volume visible.
 */
export type ClipPlanes = ClipPlane[];

/**
 * Volume bounds in world space.
 */
export interface VolumeBounds {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * A pixel region in array indices.
 * Coordinates are in [z, y, x] order to match OME-Zarr conventions.
 */
export interface PixelRegion {
  /** Start indices [z, y, x] (inclusive) */
  start: [number, number, number];
  /** End indices [z, y, x] (exclusive) */
  end: [number, number, number];
}

/**
 * A pixel region that has been aligned to chunk boundaries.
 */
export interface ChunkAlignedRegion extends PixelRegion {
  /** Chunk-aligned start indices [z, y, x] */
  chunkAlignedStart: [number, number, number];
  /** Chunk-aligned end indices [z, y, x] */
  chunkAlignedEnd: [number, number, number];
  /** True if the original region didn't align with chunk boundaries */
  needsClipping: boolean;
}

/**
 * Result of selecting an appropriate resolution level.
 */
export interface ResolutionSelection {
  /** Index into multiscales.images array */
  levelIndex: number;
  /** Dimensions of the buffer [z, y, x] */
  dimensions: [number, number, number];
  /** Total pixel count */
  pixelCount: number;
}

/**
 * Options for creating an OMEZarrNVImage.
 */
export interface OMEZarrNVImageOptions {
  /** The OME-Zarr multiscales data */
  multiscales: Multiscales;
  /** Reference to the NiiVue instance for rendering updates */
  niivue: Niivue;
  /** Maximum number of pixels to use (default: 50,000,000) */
  maxPixels?: number;
}

/**
 * Result of fetching a region from the zarr store.
 */
export interface RegionFetchResult {
  /** The pixel data as a typed array */
  data: TypedArray;
  /** Shape of the fetched data [z, y, x] */
  shape: number[];
  /** Stride of the fetched data */
  stride: number[];
}

/**
 * Supported zarr data types.
 */
export type ZarrDtype =
  | "uint8"
  | "uint16"
  | "uint32"
  | "int8"
  | "int16"
  | "int32"
  | "float32"
  | "float64";

/**
 * Union of all typed array types we support.
 */
export type TypedArray =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array;

/**
 * Typed arrays supported by NiiVue.
 * NiiVue only supports a subset of typed arrays.
 */
export type NiiVueTypedArray =
  | Uint8Array
  | Uint16Array
  | Int16Array
  | Float32Array
  | Float64Array;

/**
 * Typed array constructor types.
 */
export type TypedArrayConstructor =
  | Uint8ArrayConstructor
  | Uint16ArrayConstructor
  | Uint32ArrayConstructor
  | Int8ArrayConstructor
  | Int16ArrayConstructor
  | Int32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor;

/**
 * NIfTI data type codes.
 */
export const NiftiDataType = {
  UINT8: 2,
  INT16: 4,
  INT32: 8,
  FLOAT32: 16,
  FLOAT64: 64,
  INT8: 256,
  UINT16: 512,
  UINT32: 768,
} as const;

export type NiftiDataTypeCode = (typeof NiftiDataType)[keyof typeof NiftiDataType];

/**
 * Map zarr dtype to typed array constructor.
 */
export function getTypedArrayConstructor(dtype: ZarrDtype): TypedArrayConstructor {
  switch (dtype) {
    case "uint8":
      return Uint8Array;
    case "uint16":
      return Uint16Array;
    case "uint32":
      return Uint32Array;
    case "int8":
      return Int8Array;
    case "int16":
      return Int16Array;
    case "int32":
      return Int32Array;
    case "float32":
      return Float32Array;
    case "float64":
      return Float64Array;
    default:
      throw new Error(`Unsupported dtype: ${dtype}`);
  }
}

/**
 * Get bytes per pixel for a dtype.
 */
export function getBytesPerPixel(dtype: ZarrDtype): number {
  switch (dtype) {
    case "uint8":
    case "int8":
      return 1;
    case "uint16":
    case "int16":
      return 2;
    case "uint32":
    case "int32":
    case "float32":
      return 4;
    case "float64":
      return 8;
    default:
      throw new Error(`Unsupported dtype: ${dtype}`);
  }
}

/**
 * Map zarr dtype to NIfTI data type code.
 */
export function getNiftiDataType(dtype: ZarrDtype): NiftiDataTypeCode {
  switch (dtype) {
    case "uint8":
      return NiftiDataType.UINT8;
    case "uint16":
      return NiftiDataType.UINT16;
    case "uint32":
      return NiftiDataType.UINT32;
    case "int8":
      return NiftiDataType.INT8;
    case "int16":
      return NiftiDataType.INT16;
    case "int32":
      return NiftiDataType.INT32;
    case "float32":
      return NiftiDataType.FLOAT32;
    case "float64":
      return NiftiDataType.FLOAT64;
    default:
      throw new Error(`Unsupported dtype: ${dtype}`);
  }
}

/**
 * Parse a zarrita dtype string to our ZarrDtype.
 * Handles formats like "|u1", "<u2", "<f4", etc.
 */
export function parseZarritaDtype(dtype: string): ZarrDtype {
  // Remove endianness prefix if present
  const normalized = dtype.replace(/^[|<>]/, "");

  switch (normalized) {
    case "u1":
    case "uint8":
      return "uint8";
    case "u2":
    case "uint16":
      return "uint16";
    case "u4":
    case "uint32":
      return "uint32";
    case "i1":
    case "int8":
      return "int8";
    case "i2":
    case "int16":
      return "int16";
    case "i4":
    case "int32":
      return "int32";
    case "f4":
    case "float32":
      return "float32";
    case "f8":
    case "float64":
      return "float64";
    default:
      throw new Error(`Unsupported zarrita dtype: ${dtype}`);
  }
}
