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
  ClipPlane,
  ClipPlanes,
  VolumeBounds,
  PixelRegion,
  ChunkAlignedRegion,
  ResolutionSelection,
  OMEZarrNVImageOptions,
  RegionFetchResult,
  ZarrDtype,
  TypedArray,
} from "./types.js";

// Clip planes utilities
export {
  createClipPlane,
  normalizeVector,
  createDefaultClipPlanes,
  getVolumeBoundsFromMultiscales,
  normalToAzimuthElevation,
  azimuthElevationToNormal,
  calculateNiivueDepth,
  clipPlaneToNiivue,
  clipPlanesToNiivue,
  pointToPlaneDistance,
  isInsideClipPlanes,
  clipPlanesToBoundingBox,
  clipPlanesToPixelRegion,
  alignToChunks,
  createAxisAlignedClipPlane,
  validateClipPlanes,
  MAX_CLIP_PLANES,
} from "./ClipPlanes.js";

// Resolution selector utilities
export {
  selectResolution,
  getChunkShape,
  getVolumeShape,
  alignRegionToChunks,
  getMiddleResolutionIndex,
  calculateUpsampleFactor,
  getFullVolumeDimensions,
} from "./ResolutionSelector.js";

// Buffer manager
export { BufferManager } from "./BufferManager.js";

// Region coalescer
export { RegionCoalescer } from "./RegionCoalescer.js";

// Coordinate utilities
export {
  worldToPixel,
  pixelToWorld,
  worldToPixelAffine,
  pixelToWorldAffine,
  normalizedToWorld,
  worldToNormalized,
  clampPixelCoord,
  roundPixelCoord,
  floorPixelCoord,
  ceilPixelCoord,
} from "./utils/coordinates.js";

// Affine utilities
export {
  createAffineFromOMEZarr,
  createAffineFromNgffImage,
  affineToNiftiSrows,
  getPixelDimensions,
  updateAffineForRegion,
  calculateWorldBounds,
} from "./utils/affine.js";

// Type utilities
export {
  getTypedArrayConstructor,
  getBytesPerPixel,
  getNiftiDataType,
  parseZarritaDtype,
  NiftiDataType,
} from "./types.js";

// Worker pool lifecycle (re-exported from ngff-zarr)
export { terminateWorkerPool } from "@fideus-labs/ngff-zarr/browser";

// Event system (browser-native EventTarget API)
export { OMEZarrNVImageEvent } from "./events.js";
export type {
  OMEZarrNVImageEventMap,
  OMEZarrNVImageEventListener,
  OMEZarrNVImageEventListenerOptions,
  PopulateTrigger,
} from "./events.js";
