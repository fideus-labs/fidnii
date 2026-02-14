// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { Multiscales, NgffImage } from "@fideus-labs/ngff-zarr"
import type { Niivue, NVImage } from "@niivue/niivue"
import { SLICE_TYPE } from "@niivue/niivue"

import type { BufferManager } from "./BufferManager.js"
import type { PopulateTrigger } from "./events.js"

/**
 * A single clip plane defined by a point and normal vector.
 * The plane equation is: normal · (P - point) = 0
 * Points on the positive side of the normal are kept (visible).
 */
export interface ClipPlane {
  /** A point on the plane (center of volume projected to plane) [x, y, z] in world coordinates */
  point: [number, number, number]
  /** Unit normal vector pointing toward visible region [x, y, z] */
  normal: [number, number, number]
}

/**
 * Collection of clip planes that define the visible region.
 * Each plane clips away the half-space on the negative side of its normal.
 * Maximum 6 planes (NiiVue limit). Empty array = full volume visible.
 */
export type ClipPlanes = ClipPlane[]

/**
 * Volume bounds in world space.
 */
export interface VolumeBounds {
  min: [number, number, number]
  max: [number, number, number]
}

/**
 * A pixel region in array indices.
 * Coordinates are in [z, y, x] order to match OME-Zarr conventions.
 */
export interface PixelRegion {
  /** Start indices [z, y, x] (inclusive) */
  start: [number, number, number]
  /** End indices [z, y, x] (exclusive) */
  end: [number, number, number]
}

/**
 * A pixel region that has been aligned to chunk boundaries.
 */
export interface ChunkAlignedRegion extends PixelRegion {
  /** Chunk-aligned start indices [z, y, x] */
  chunkAlignedStart: [number, number, number]
  /** Chunk-aligned end indices [z, y, x] */
  chunkAlignedEnd: [number, number, number]
  /** True if the original region didn't align with chunk boundaries */
  needsClipping: boolean
}

/**
 * Result of selecting an appropriate resolution level.
 */
export interface ResolutionSelection {
  /** Index into multiscales.images array */
  levelIndex: number
  /** Dimensions of the buffer [z, y, x] */
  dimensions: [number, number, number]
  /** Total pixel count */
  pixelCount: number
}

/**
 * Interface for a decoded-chunk cache, compatible with `Map`.
 *
 * Caches decoded chunks keyed by a string combining the store instance,
 * array path, and chunk coordinates. This avoids redundant decompression
 * when accessing overlapping selections or making repeated calls to the
 * same data.
 *
 * Any object with `get(key)` and `set(key, value)` works — a plain `Map`
 * is the simplest option. For bounded memory use an LRU cache such as
 * `lru-cache`.
 *
 * @example
 * ```ts
 * // Use a plain Map (unbounded)
 * const cache = new Map()
 *
 * // Use lru-cache (bounded)
 * import { LRUCache } from 'lru-cache'
 * const cache = new LRUCache({ max: 200 })
 * ```
 */
export interface ChunkCache {
  /** Look up a cached decoded chunk by key. */
  get(key: string): unknown | undefined
  /** Store a decoded chunk under the given key. */
  set(key: string, value: unknown): void
}

/**
 * Options for creating an OMEZarrNVImage.
 */
export interface OMEZarrNVImageOptions {
  /** The OME-Zarr multiscales data */
  multiscales: Multiscales
  /** Reference to the NiiVue instance for rendering updates */
  niivue: Niivue
  /** Maximum number of pixels to use (default: 50,000,000) */
  maxPixels?: number
  /** Debounce delay for clip plane data refetch in milliseconds (default: 300) */
  clipPlaneDebounceMs?: number
  /**
   * Automatically add to NiiVue and start progressive loading (default: true).
   * Set to false to manually control when populateVolume() is called.
   * Listen to 'populateComplete' event to know when loading finishes.
   */
  autoLoad?: boolean
  /**
   * Maximum 3D render zoom level for scroll-wheel zoom (default: 10.0).
   * NiiVue's built-in 3D zoom is hardcoded to [0.5, 2.0]. This option
   * overrides the scroll-wheel zoom handler to allow zooming beyond that limit.
   */
  max3DZoom?: number
  /**
   * Minimum 3D render zoom level for scroll-wheel zoom (default: 0.3).
   * @see max3DZoom
   */
  min3DZoom?: number
  /**
   * Enable viewport-aware resolution selection (default: true).
   * When enabled, zoom/pan interactions constrain the fetch region to the
   * visible viewport, allowing higher resolution within the same maxPixels budget.
   */
  viewportAware?: boolean
  /**
   * Maximum number of decoded-chunk cache entries (default: 200).
   *
   * Fidnii creates an LRU cache that avoids redundant chunk decompression
   * on repeated or overlapping reads (e.g. clip plane adjustments, viewport
   * panning, progressive resolution loading).
   *
   * Set to `0` to disable caching entirely.
   */
  maxCacheEntries?: number
  /**
   * Optional pre-built decoded-chunk cache. When provided, overrides the
   * internal LRU cache created from `maxCacheEntries`.
   *
   * Any object with `get(key)` / `set(key, value)` works — a plain `Map`
   * or any LRU cache implementing the same interface.
   *
   * @see {@link ChunkCache}
   */
  cache?: ChunkCache
  /**
   * Flip the y-axis in the NIfTI affine for 2D images (default: true).
   *
   * 2D images (e.g., PNGs converted to OME-Zarr) store pixel data with
   * y=0 at the top (increasing downward). NiiVue expects a negative
   * y-scale in the affine to render these right-side up. Set to `false`
   * if your 2D data already has bottom-to-top y ordering.
   *
   * This option has no effect on 3D volumes (images with a `"z"` axis).
   */
  flipY2D?: boolean
}

/**
 * Result of fetching a region from the zarr store.
 */
export interface RegionFetchResult {
  /** The pixel data as a typed array */
  data: TypedArray
  /** Shape of the fetched data [z, y, x] */
  shape: number[]
  /** Stride of the fetched data */
  stride: number[]
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
  | "float64"

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
  | Float64Array

/**
 * Typed arrays supported by NiiVue.
 * NiiVue only supports a subset of typed arrays.
 */
export type NiiVueTypedArray =
  | Uint8Array
  | Uint16Array
  | Int16Array
  | Float32Array
  | Float64Array

// Re-export SLICE_TYPE for convenience
export { SLICE_TYPE }

/**
 * The 2D slice types that use slab-based loading.
 * These are the Niivue slice types that show a single 2D plane.
 */
export type SlabSliceType =
  | typeof SLICE_TYPE.AXIAL
  | typeof SLICE_TYPE.CORONAL
  | typeof SLICE_TYPE.SAGITTAL

/**
 * State for a per-slice-type slab buffer.
 *
 * Each 2D slice view (axial, coronal, sagittal) gets its own NVImage buffer
 * loaded with a slab (one chunk thick in the orthogonal direction) at the
 * current slice position.
 */
export interface SlabBufferState {
  /** The NVImage instance for this slab */
  nvImage: NVImage
  /** Buffer manager for this slab's pixel data */
  bufferManager: BufferManager
  /** Current resolution level index for this slab */
  levelIndex: number
  /** Target resolution level index for this slab */
  targetLevelIndex: number
  /** Start index of the currently loaded slab in the orthogonal axis (pixel coords at current level) */
  slabStart: number
  /** End index of the currently loaded slab in the orthogonal axis (pixel coords at current level) */
  slabEnd: number
  /** Whether this slab is currently loading */
  isLoading: boolean
  /** Data type of the slab */
  dtype: ZarrDtype
  /**
   * The affine normalization scale applied to the slab NVImage header.
   * NiiVue mm values = world * normalizationScale.
   * This is 1/maxVoxelSize where maxVoxelSize = max(sx, sy, sz).
   * Used to convert NiiVue 2D FOV coordinates back to physical world coords.
   */
  normalizationScale: number
  /**
   * Pending reload request queued while this slab was loading.
   * Latest-wins semantics: only the most recent request is kept.
   * Auto-drained when the current load completes.
   */
  pendingReload: {
    worldCoord: [number, number, number]
    trigger: PopulateTrigger
  } | null
}

/**
 * State for a Niivue instance attached to an OMEZarrNVImage.
 */
export interface AttachedNiivueState {
  /** The Niivue instance */
  nv: Niivue
  /** The current slice type of this NV instance */
  currentSliceType: SLICE_TYPE
  /** Previous onLocationChange callback (to chain) */
  previousOnLocationChange?: (location: unknown) => void
  /** Previous onOptsChange callback (to chain) */
  previousOnOptsChange?: (
    propertyName: string,
    newValue: unknown,
    oldValue: unknown,
  ) => void
  /** Previous onMouseUp callback (to chain, for viewport-aware mode) */
  previousOnMouseUp?: (data: unknown) => void
  /** Previous onZoom3DChange callback (to chain, for viewport-aware mode) */
  previousOnZoom3DChange?: (zoom: number) => void
  /** AbortController for viewport-aware event listeners (wheel, etc.) */
  viewportAbortController?: AbortController
  /** AbortController for the 3D zoom override wheel listener */
  zoomOverrideAbortController?: AbortController
}

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
  | Float64ArrayConstructor

/**
 * NIfTI data type codes.
 */
export const NiftiDataType = {
  UINT8: 2,
  INT16: 4,
  INT32: 8,
  FLOAT32: 16,
  FLOAT64: 64,
  RGB24: 128,
  INT8: 256,
  UINT16: 512,
  UINT32: 768,
  RGBA32: 2304,
} as const

export type NiftiDataTypeCode =
  (typeof NiftiDataType)[keyof typeof NiftiDataType]

/**
 * Information about a channel (component) dimension in the image.
 */
export interface ChannelInfo {
  /** Index of the `"c"` dimension in `ngffImage.dims` */
  channelAxis: number
  /** Number of components (e.g. 3 for RGB, 4 for RGBA) */
  components: number
}

/**
 * Detect whether an NgffImage has a channel (`"c"`) dimension.
 *
 * @param ngffImage - The NgffImage to inspect
 * @returns Channel information, or `null` if no `"c"` dimension exists
 */
export function getChannelInfo(ngffImage: NgffImage): ChannelInfo | null {
  const channelAxis = ngffImage.dims.indexOf("c")
  if (channelAxis === -1) return null
  const components = ngffImage.data.shape[channelAxis]
  return { channelAxis, components }
}

/**
 * Check whether an NgffImage represents an RGB or RGBA image.
 *
 * An image is considered RGB/RGBA when it has a `"c"` dimension with
 * 3 or 4 components. Any dtype is supported — non-uint8 data is
 * normalized to uint8 at load time (see {@link needsRGBNormalization}).
 *
 * @param ngffImage - The NgffImage to inspect
 * @returns `true` if the image is RGB (3 components) or RGBA (4 components)
 */
export function isRGBImage(ngffImage: NgffImage): boolean {
  const info = getChannelInfo(ngffImage)
  if (!info) return false
  return info.components === 3 || info.components === 4
}

/**
 * Check whether a multi-component RGB/RGBA image needs normalization
 * to uint8 before NiiVue can render it.
 *
 * NiiVue only supports `DT_RGB24` (3×uint8) and `DT_RGBA32` (4×uint8)
 * color rendering. Non-uint8 multi-component images must be normalized
 * to uint8 using OMERO window metadata (or computed min/max).
 *
 * @param ngffImage - The NgffImage to inspect
 * @param dtype - The parsed zarr dtype
 * @returns `true` if the image is RGB/RGBA with a non-uint8 dtype
 */
export function needsRGBNormalization(
  ngffImage: NgffImage,
  dtype: ZarrDtype,
): boolean {
  return isRGBImage(ngffImage) && dtype !== "uint8"
}

/**
 * Get the NIfTI data type code for a multi-component image.
 *
 * Returns `RGB24` for 3 components and `RGBA32` for 4 components,
 * regardless of the source dtype. Non-uint8 data is normalized to
 * uint8 at load time before being stored in the NVImage buffer.
 *
 * @param channelInfo - Channel information from `getChannelInfo()`
 * @returns The NIfTI data type code (`RGB24` or `RGBA32`)
 * @throws If the component count is not 3 or 4
 */
export function getRGBNiftiDataType(
  channelInfo: ChannelInfo,
): NiftiDataTypeCode {
  if (channelInfo.components === 3) return NiftiDataType.RGB24
  if (channelInfo.components === 4) return NiftiDataType.RGBA32
  throw new Error(
    `Unsupported multi-component image: ` +
      `components=${channelInfo.components}. ` +
      `Only 3 (RGB) or 4 (RGBA) components are supported.`,
  )
}

/**
 * Map zarr dtype to typed array constructor.
 */
export function getTypedArrayConstructor(
  dtype: ZarrDtype,
): TypedArrayConstructor {
  switch (dtype) {
    case "uint8":
      return Uint8Array
    case "uint16":
      return Uint16Array
    case "uint32":
      return Uint32Array
    case "int8":
      return Int8Array
    case "int16":
      return Int16Array
    case "int32":
      return Int32Array
    case "float32":
      return Float32Array
    case "float64":
      return Float64Array
    default:
      throw new Error(`Unsupported dtype: ${dtype}`)
  }
}

/**
 * Get bytes per pixel for a dtype.
 */
export function getBytesPerPixel(dtype: ZarrDtype): number {
  switch (dtype) {
    case "uint8":
    case "int8":
      return 1
    case "uint16":
    case "int16":
      return 2
    case "uint32":
    case "int32":
    case "float32":
      return 4
    case "float64":
      return 8
    default:
      throw new Error(`Unsupported dtype: ${dtype}`)
  }
}

/**
 * Map zarr dtype to NIfTI data type code.
 */
export function getNiftiDataType(dtype: ZarrDtype): NiftiDataTypeCode {
  switch (dtype) {
    case "uint8":
      return NiftiDataType.UINT8
    case "uint16":
      return NiftiDataType.UINT16
    case "uint32":
      return NiftiDataType.UINT32
    case "int8":
      return NiftiDataType.INT8
    case "int16":
      return NiftiDataType.INT16
    case "int32":
      return NiftiDataType.INT32
    case "float32":
      return NiftiDataType.FLOAT32
    case "float64":
      return NiftiDataType.FLOAT64
    default:
      throw new Error(`Unsupported dtype: ${dtype}`)
  }
}

/**
 * Parse a zarrita dtype string to our ZarrDtype.
 * Handles formats like "|u1", "<u2", "<f4", etc.
 */
export function parseZarritaDtype(dtype: string): ZarrDtype {
  // Remove endianness prefix if present
  const normalized = dtype.replace(/^[|<>]/, "")

  switch (normalized) {
    case "u1":
    case "uint8":
      return "uint8"
    case "u2":
    case "uint16":
      return "uint16"
    case "u4":
    case "uint32":
      return "uint32"
    case "i1":
    case "int8":
      return "int8"
    case "i2":
    case "int16":
      return "int16"
    case "i4":
    case "int32":
      return "int32"
    case "f4":
    case "float32":
      return "float32"
    case "f8":
    case "float64":
      return "float64"
    default:
      throw new Error(`Unsupported zarrita dtype: ${dtype}`)
  }
}
