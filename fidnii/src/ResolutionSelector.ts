// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { Multiscales, NgffImage } from "@fideus-labs/ngff-zarr";
import type { ClipPlanes, PixelRegion, ResolutionSelection, VolumeBounds } from "./types.js";
import { clipPlanesToPixelRegion } from "./ClipPlanes.js";

/**
 * Orthogonal axis index in [z, y, x] order.
 * 0 = Z (axial view), 1 = Y (coronal view), 2 = X (sagittal view)
 */
export type OrthogonalAxis = 0 | 1 | 2;

/**
 * Select the appropriate resolution level based on pixel budget and clip planes.
 *
 * The selection process:
 * 1. Starts from the highest resolution (level 0)
 * 2. Finds the highest resolution that fits within maxPixels
 * 3. Considers the clipped region size, not full volume
 *
 * @param multiscales - The OME-Zarr multiscales data
 * @param maxPixels - Maximum number of pixels to use
 * @param clipPlanes - Current clip planes in world space
 * @param volumeBounds - Full volume bounds in world space
 * @returns The selected resolution level and buffer dimensions
 */
export function selectResolution(
  multiscales: Multiscales,
  maxPixels: number,
  clipPlanes: ClipPlanes,
  volumeBounds: VolumeBounds
): ResolutionSelection {
  const images = multiscales.images;

  // Try each resolution from highest to lowest
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const region = clipPlanesToPixelRegion(clipPlanes, volumeBounds, image);
    const alignedRegion = alignRegionToChunks(region, image);

    const dimensions: [number, number, number] = [
      alignedRegion.end[0] - alignedRegion.start[0],
      alignedRegion.end[1] - alignedRegion.start[1],
      alignedRegion.end[2] - alignedRegion.start[2],
    ];

    const pixelCount = dimensions[0] * dimensions[1] * dimensions[2];

    if (pixelCount <= maxPixels) {
      return {
        levelIndex: i,
        dimensions,
        pixelCount,
      };
    }
  }

  // Fall back to lowest resolution
  const lowestImage = images[images.length - 1];
  const region = clipPlanesToPixelRegion(clipPlanes, volumeBounds, lowestImage);
  const alignedRegion = alignRegionToChunks(region, lowestImage);

  const dimensions: [number, number, number] = [
    alignedRegion.end[0] - alignedRegion.start[0],
    alignedRegion.end[1] - alignedRegion.start[1],
    alignedRegion.end[2] - alignedRegion.start[2],
  ];

  return {
    levelIndex: images.length - 1,
    dimensions,
    pixelCount: dimensions[0] * dimensions[1] * dimensions[2],
  };
}

/**
 * Get the chunk shape for a volume.
 *
 * @param ngffImage - The NgffImage to get chunk shape from
 * @returns Chunk shape as [z, y, x]
 */
export function getChunkShape(ngffImage: NgffImage): [number, number, number] {
  const chunks = ngffImage.data.chunks;
  const dims = ngffImage.dims;

  // Find z, y, x indices in dims
  const zIdx = dims.indexOf("z");
  const yIdx = dims.indexOf("y");
  const xIdx = dims.indexOf("x");

  if (zIdx === -1 || yIdx === -1 || xIdx === -1) {
    // Fallback: assume last 3 dimensions are z, y, x
    const n = chunks.length;
    return [chunks[n - 3] || 1, chunks[n - 2] || 1, chunks[n - 1] || 1];
  }

  return [chunks[zIdx], chunks[yIdx], chunks[xIdx]];
}

/**
 * Get the shape of a volume as [z, y, x].
 *
 * @param ngffImage - The NgffImage
 * @returns Shape as [z, y, x]
 */
export function getVolumeShape(ngffImage: NgffImage): [number, number, number] {
  const shape = ngffImage.data.shape;
  const dims = ngffImage.dims;

  // Find z, y, x indices in dims
  const zIdx = dims.indexOf("z");
  const yIdx = dims.indexOf("y");
  const xIdx = dims.indexOf("x");

  if (zIdx === -1 || yIdx === -1 || xIdx === -1) {
    // Fallback: assume last 3 dimensions are z, y, x
    const n = shape.length;
    return [shape[n - 3] || 1, shape[n - 2] || 1, shape[n - 1] || 1];
  }

  return [shape[zIdx], shape[yIdx], shape[xIdx]];
}

/**
 * Align a pixel region to chunk boundaries.
 * Expands the region to include complete chunks.
 *
 * @param region - The pixel region to align
 * @param ngffImage - The NgffImage (for chunk shape)
 * @returns Aligned region
 */
export function alignRegionToChunks(
  region: PixelRegion,
  ngffImage: NgffImage
): PixelRegion {
  const chunkShape = getChunkShape(ngffImage);
  const volumeShape = getVolumeShape(ngffImage);

  // Align start down to chunk boundary
  const alignedStart: [number, number, number] = [
    Math.floor(region.start[0] / chunkShape[0]) * chunkShape[0],
    Math.floor(region.start[1] / chunkShape[1]) * chunkShape[1],
    Math.floor(region.start[2] / chunkShape[2]) * chunkShape[2],
  ];

  // Align end up to chunk boundary (but don't exceed volume size)
  const alignedEnd: [number, number, number] = [
    Math.min(
      Math.ceil(region.end[0] / chunkShape[0]) * chunkShape[0],
      volumeShape[0]
    ),
    Math.min(
      Math.ceil(region.end[1] / chunkShape[1]) * chunkShape[1],
      volumeShape[1]
    ),
    Math.min(
      Math.ceil(region.end[2] / chunkShape[2]) * chunkShape[2],
      volumeShape[2]
    ),
  ];

  return {
    start: alignedStart,
    end: alignedEnd,
  };
}

/**
 * Calculate the middle resolution level index.
 *
 * @param multiscales - The OME-Zarr multiscales data
 * @returns Middle resolution level index
 */
export function getMiddleResolutionIndex(multiscales: Multiscales): number {
  return Math.floor(multiscales.images.length / 2);
}

/**
 * Calculate upsample factor from one resolution level to another.
 *
 * @param multiscales - The OME-Zarr multiscales data
 * @param fromLevel - Source resolution level
 * @param toLevel - Target resolution level (should be higher resolution, i.e., lower index)
 * @returns Upsample factor for each dimension [z, y, x]
 */
export function calculateUpsampleFactor(
  multiscales: Multiscales,
  fromLevel: number,
  toLevel: number
): [number, number, number] {
  const fromImage = multiscales.images[fromLevel];
  const toImage = multiscales.images[toLevel];

  const fromShape = getVolumeShape(fromImage);
  const toShape = getVolumeShape(toImage);

  return [
    toShape[0] / fromShape[0],
    toShape[1] / fromShape[1],
    toShape[2] / fromShape[2],
  ];
}

/**
 * Get dimensions for the full volume at a given resolution level.
 */
export function getFullVolumeDimensions(
  multiscales: Multiscales,
  levelIndex: number
): [number, number, number] {
  return getVolumeShape(multiscales.images[levelIndex]);
}

/**
 * Select the appropriate resolution level for a 2D slice view.
 *
 * Unlike `selectResolution` which counts all 3D pixels (z*y*x), this function
 * counts only the 2D in-plane pixels (e.g., x*y for axial), ignoring the
 * orthogonal axis. This allows much higher resolution for 2D slice views.
 *
 * The slab dimensions returned include one chunk of thickness in the
 * orthogonal direction (needed for zarr fetching efficiency).
 *
 * @param multiscales - The OME-Zarr multiscales data
 * @param maxPixels - Maximum number of pixels to use (applied to 2D plane)
 * @param clipPlanes - Current clip planes in world space
 * @param volumeBounds - Full volume bounds in world space
 * @param orthogonalAxis - The axis perpendicular to the slice plane (0=Z, 1=Y, 2=X)
 * @returns The selected resolution level and slab dimensions
 */
export function select2DResolution(
  multiscales: Multiscales,
  maxPixels: number,
  clipPlanes: ClipPlanes,
  volumeBounds: VolumeBounds,
  orthogonalAxis: OrthogonalAxis
): ResolutionSelection {
  const images = multiscales.images;

  // Try each resolution from highest to lowest
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const region = clipPlanesToPixelRegion(clipPlanes, volumeBounds, image);
    const alignedRegion = alignRegionToChunks(region, image);

    const dimensions: [number, number, number] = [
      alignedRegion.end[0] - alignedRegion.start[0],
      alignedRegion.end[1] - alignedRegion.start[1],
      alignedRegion.end[2] - alignedRegion.start[2],
    ];

    // Count only the 2D in-plane pixels (exclude orthogonal axis)
    const inPlaneAxes = ([0, 1, 2] as const).filter(a => a !== orthogonalAxis);
    const pixelCount2D = dimensions[inPlaneAxes[0]] * dimensions[inPlaneAxes[1]];

    if (pixelCount2D <= maxPixels) {
      return {
        levelIndex: i,
        dimensions,
        pixelCount: pixelCount2D,
      };
    }
  }

  // Fall back to lowest resolution
  const lowestImage = images[images.length - 1];
  const region = clipPlanesToPixelRegion(clipPlanes, volumeBounds, lowestImage);
  const alignedRegion = alignRegionToChunks(region, lowestImage);

  const dimensions: [number, number, number] = [
    alignedRegion.end[0] - alignedRegion.start[0],
    alignedRegion.end[1] - alignedRegion.start[1],
    alignedRegion.end[2] - alignedRegion.start[2],
  ];

  const inPlaneAxes = ([0, 1, 2] as const).filter(a => a !== orthogonalAxis);

  return {
    levelIndex: images.length - 1,
    dimensions,
    pixelCount: dimensions[inPlaneAxes[0]] * dimensions[inPlaneAxes[1]],
  };
}
