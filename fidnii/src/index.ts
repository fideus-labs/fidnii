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
 * const image = await OMEZarrNVImage.create({
 *   multiscales,
 *   niivue: nv,
 *   maxPixels: 50_000_000
 * });
 *
 * nv.volumes.push(image);
 * await image.populateVolume();
 * ```
 */

// Main class
export { OMEZarrNVImage } from "./OMEZarrNVImage.js";

// Types
export type {
  CroppingPlanes,
  PixelRegion,
  ChunkAlignedRegion,
  ResolutionSelection,
  OMEZarrNVImageOptions,
  RegionFetchResult,
  ZarrDtype,
  TypedArray,
} from "./types.js";

// Cropping planes utilities
export {
  createDefaultCroppingPlanes,
  worldToPixelRegion,
  pixelRegionToWorld,
  alignToChunks,
  croppingPlanesToNiivueClipPlanes,
  isInsideCroppingPlanes,
  getCroppingVolume,
  intersectCroppingPlanes,
  expandCroppingPlanes,
} from "./CroppingPlanes.js";

// Resolution selector utilities
export {
  selectResolution,
  getAspectRatio,
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

// Upsample utilities
export {
  upsampleNearestNeighbor,
  upsampleTrilinear,
  calculateUpsampleFactors,
  needsUpsampling,
  getIntegerUpsampleFactor,
} from "./utils/upsample.js";

// Type utilities
export {
  getTypedArrayConstructor,
  getBytesPerPixel,
  getNiftiDataType,
  parseZarritaDtype,
  NiftiDataType,
} from "./types.js";
