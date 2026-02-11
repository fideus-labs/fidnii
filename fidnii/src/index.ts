// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

/**
 * @fideus-labs/fidnii
 *
 * Render OME-Zarr images in NiiVue with progressive multi-resolution loading.
 *
 * @example
 * ```typescript
 * import { Niivue } from '@niivue/niivue';
 * import { fromNgffZarr } from '@fideus-labs/ngff-zarr';
 * import { OMEZarrNVImage } from '@fideus-labs/fidnii';
 *
 * const nv = new Niivue();
 * await nv.attachToCanvas(document.getElementById('canvas'));
 *
 * const multiscales = await fromNgffZarr('/path/to/data.ome.zarr');
 *
 * // Image is automatically added to NiiVue and loads progressively
 * const image = await OMEZarrNVImage.create({ multiscales, niivue: nv });
 *
 * // Listen for loading complete if needed
 * image.addEventListener('populateComplete', () => console.log('Loaded!'));
 *
 * // For manual control, use autoLoad: false
 * // const image = await OMEZarrNVImage.create({
 * //   multiscales,
 * //   niivue: nv,
 * //   autoLoad: false,
 * // });
 * // nv.addVolume(image);
 * // await image.populateVolume();
 * ```
 */

// Main class
export { OMEZarrNVImage } from "./OMEZarrNVImage.js";

// Types
export type {
  AttachedNiivueState,
  ChunkAlignedRegion,
  ChunkCache,
  ClipPlane,
  ClipPlanes,
  OMEZarrNVImageOptions,
  PixelRegion,
  RegionFetchResult,
  ResolutionSelection,
  SlabBufferState,
  SlabSliceType,
  TypedArray,
  VolumeBounds,
  ZarrDtype,
} from "./types.js";

// Re-export SLICE_TYPE from types (which re-exports from niivue)
export { SLICE_TYPE } from "./types.js";

// Clip planes utilities
export {
  alignToChunks,
  azimuthElevationToNormal,
  calculateNiivueDepth,
  clipPlanesToBoundingBox,
  clipPlanesToNiivue,
  clipPlanesToPixelRegion,
  clipPlaneToNiivue,
  createAxisAlignedClipPlane,
  createClipPlane,
  createDefaultClipPlanes,
  getVolumeBoundsFromMultiscales,
  isInsideClipPlanes,
  MAX_CLIP_PLANES,
  normalizeVector,
  normalToAzimuthElevation,
  pointToPlaneDistance,
  validateClipPlanes,
} from "./ClipPlanes.js";

// Resolution selector utilities
export {
  alignRegionToChunks,
  calculateUpsampleFactor,
  getChunkShape,
  getFullVolumeDimensions,
  getMiddleResolutionIndex,
  getVolumeShape,
  select2DResolution,
  selectResolution,
} from "./ResolutionSelector.js";

export type { OrthogonalAxis } from "./ResolutionSelector.js";

// Buffer manager
export { BufferManager } from "./BufferManager.js";

// Region coalescer
export { RegionCoalescer } from "./RegionCoalescer.js";

// Coordinate utilities
export {
  ceilPixelCoord,
  clampPixelCoord,
  floorPixelCoord,
  normalizedToWorld,
  pixelToWorld,
  pixelToWorldAffine,
  roundPixelCoord,
  worldToNormalized,
  worldToPixel,
  worldToPixelAffine,
} from "./utils/coordinates.js";

// Affine utilities
export {
  affineToNiftiSrows,
  calculateWorldBounds,
  createAffineFromNgffImage,
  createAffineFromOMEZarr,
  getPixelDimensions,
  updateAffineForRegion,
} from "./utils/affine.js";

// Type utilities
export {
  getBytesPerPixel,
  getNiftiDataType,
  getTypedArrayConstructor,
  NiftiDataType,
  parseZarritaDtype,
} from "./types.js";

// Worker pool lifecycle (re-exported from ngff-zarr)
export { terminateWorkerPool } from "@fideus-labs/ngff-zarr/browser";

// Viewport bounds utilities
export {
  boundsApproxEqual,
  computeViewportBounds2D,
  computeViewportBounds3D,
  intersectBounds,
} from "./ViewportBounds.js";

// Event system (browser-native EventTarget API)
export { OMEZarrNVImageEvent } from "./events.js";
export type {
  OMEZarrNVImageEventListener,
  OMEZarrNVImageEventListenerOptions,
  OMEZarrNVImageEventMap,
  PopulateTrigger,
} from "./events.js";
