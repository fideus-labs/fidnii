// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { Multiscales, NgffImage } from "@fideus-labs/ngff-zarr";
import type { CroppingPlanes, PixelRegion, ChunkAlignedRegion } from "./types.js";
import { worldToPixel, pixelToWorld } from "./utils/coordinates.js";
import { getVolumeShape, getChunkShape } from "./ResolutionSelector.js";

/**
 * Create default cropping planes that encompass the full volume extent.
 *
 * @param multiscales - The OME-Zarr multiscales data
 * @returns CroppingPlanes covering the full volume in world space
 */
export function createDefaultCroppingPlanes(
  multiscales: Multiscales
): CroppingPlanes {
  // Use the highest resolution image to determine full extent
  const image = multiscales.images[0];
  const shape = getVolumeShape(image);

  // Get world coordinates of volume corners
  const minPixel: [number, number, number] = [0, 0, 0];
  const maxPixel: [number, number, number] = [shape[0], shape[1], shape[2]];

  const minWorld = pixelToWorld(minPixel, image);
  const maxWorld = pixelToWorld(maxPixel, image);

  // Ensure min < max for each axis
  return {
    xMin: Math.min(minWorld[0], maxWorld[0]),
    xMax: Math.max(minWorld[0], maxWorld[0]),
    yMin: Math.min(minWorld[1], maxWorld[1]),
    yMax: Math.max(minWorld[1], maxWorld[1]),
    zMin: Math.min(minWorld[2], maxWorld[2]),
    zMax: Math.max(minWorld[2], maxWorld[2]),
  };
}

/**
 * Convert world-space cropping planes to a pixel region for a specific NgffImage.
 *
 * @param planes - Cropping planes in world space
 * @param ngffImage - The NgffImage to convert to
 * @returns Pixel region [z, y, x] start and end indices
 */
export function worldToPixelRegion(
  planes: CroppingPlanes,
  ngffImage: NgffImage
): PixelRegion {
  const shape = getVolumeShape(ngffImage);

  // Convert world corners to pixel coordinates
  const minWorld: [number, number, number] = [
    planes.xMin,
    planes.yMin,
    planes.zMin,
  ];
  const maxWorld: [number, number, number] = [
    planes.xMax,
    planes.yMax,
    planes.zMax,
  ];

  const minPixel = worldToPixel(minWorld, ngffImage);
  const maxPixel = worldToPixel(maxWorld, ngffImage);

  // Ensure proper ordering and clamp to valid range
  const start: [number, number, number] = [
    Math.max(0, Math.floor(Math.min(minPixel[0], maxPixel[0]))),
    Math.max(0, Math.floor(Math.min(minPixel[1], maxPixel[1]))),
    Math.max(0, Math.floor(Math.min(minPixel[2], maxPixel[2]))),
  ];

  const end: [number, number, number] = [
    Math.min(shape[0], Math.ceil(Math.max(minPixel[0], maxPixel[0]))),
    Math.min(shape[1], Math.ceil(Math.max(minPixel[1], maxPixel[1]))),
    Math.min(shape[2], Math.ceil(Math.max(minPixel[2], maxPixel[2]))),
  ];

  return { start, end };
}

/**
 * Convert a pixel region back to world-space cropping planes.
 *
 * @param region - Pixel region
 * @param ngffImage - The NgffImage
 * @returns Cropping planes in world space
 */
export function pixelRegionToWorld(
  region: PixelRegion,
  ngffImage: NgffImage
): CroppingPlanes {
  const minWorld = pixelToWorld(region.start, ngffImage);
  const maxWorld = pixelToWorld(region.end, ngffImage);

  return {
    xMin: Math.min(minWorld[0], maxWorld[0]),
    xMax: Math.max(minWorld[0], maxWorld[0]),
    yMin: Math.min(minWorld[1], maxWorld[1]),
    yMax: Math.max(minWorld[1], maxWorld[1]),
    zMin: Math.min(minWorld[2], maxWorld[2]),
    zMax: Math.max(minWorld[2], maxWorld[2]),
  };
}

/**
 * Align a pixel region to chunk boundaries.
 *
 * This expands the region to include complete chunks, which is necessary
 * for efficient zarr fetching.
 *
 * @param region - The pixel region to align
 * @param ngffImage - The NgffImage (for chunk shape)
 * @returns Chunk-aligned region with clipping information
 */
export function alignToChunks(
  region: PixelRegion,
  ngffImage: NgffImage
): ChunkAlignedRegion {
  const chunkShape = getChunkShape(ngffImage);
  const volumeShape = getVolumeShape(ngffImage);

  // Align start down to chunk boundary
  const chunkAlignedStart: [number, number, number] = [
    Math.floor(region.start[0] / chunkShape[0]) * chunkShape[0],
    Math.floor(region.start[1] / chunkShape[1]) * chunkShape[1],
    Math.floor(region.start[2] / chunkShape[2]) * chunkShape[2],
  ];

  // Align end up to chunk boundary (but don't exceed volume size)
  const chunkAlignedEnd: [number, number, number] = [
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

  // Check if alignment changed the region
  const needsClipping =
    chunkAlignedStart[0] !== region.start[0] ||
    chunkAlignedStart[1] !== region.start[1] ||
    chunkAlignedStart[2] !== region.start[2] ||
    chunkAlignedEnd[0] !== region.end[0] ||
    chunkAlignedEnd[1] !== region.end[1] ||
    chunkAlignedEnd[2] !== region.end[2];

  return {
    start: region.start,
    end: region.end,
    chunkAlignedStart,
    chunkAlignedEnd,
    needsClipping,
  };
}

/**
 * Convert cropping planes to NiiVue clip plane format.
 *
 * NiiVue uses depth/azimuth/elevation format for clip planes:
 * - depth: distance from center (0-1 in normalized coords, >1.8 means no clip)
 * - azimuth: rotation around vertical axis (degrees)
 * - elevation: rotation from horizontal plane (degrees)
 *
 * For axis-aligned planes:
 * - X plane: azimuth=90 (positive X) or 270 (negative X), elevation=0
 * - Y plane: azimuth=0 (positive Y) or 180 (negative Y), elevation=0
 * - Z plane: azimuth=0, elevation=90 (positive Z) or -90 (negative Z)
 *
 * @param planes - Cropping planes in world space
 * @param ngffImage - The NgffImage for coordinate conversion
 * @param volumeBounds - Full volume bounds { min, max } in world space
 * @returns Array of NiiVue clip planes [depth, azimuth, elevation][]
 */
export function croppingPlanesToNiivueClipPlanes(
  planes: CroppingPlanes,
  _ngffImage: NgffImage,
  volumeBounds: { min: [number, number, number]; max: [number, number, number] }
): number[][] {
  const clipPlanes: number[][] = [];

  const { min, max } = volumeBounds;
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const extent: [number, number, number] = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ];

  // Helper to convert world position to normalized depth
  const toNormalizedDepth = (worldPos: number, axis: 0 | 1 | 2): number => {
    return (worldPos - center[axis]) / (extent[axis] / 2);
  };

  // X min plane (clips from negative X direction)
  if (planes.xMin > min[0]) {
    const depth = toNormalizedDepth(planes.xMin, 0);
    clipPlanes.push([-depth, 270, 0]); // Negative depth, azimuth 270 for -X
  }

  // X max plane (clips from positive X direction)
  if (planes.xMax < max[0]) {
    const depth = toNormalizedDepth(planes.xMax, 0);
    clipPlanes.push([depth, 90, 0]); // Positive depth, azimuth 90 for +X
  }

  // Y min plane
  if (planes.yMin > min[1]) {
    const depth = toNormalizedDepth(planes.yMin, 1);
    clipPlanes.push([-depth, 180, 0]); // Azimuth 180 for -Y
  }

  // Y max plane
  if (planes.yMax < max[1]) {
    const depth = toNormalizedDepth(planes.yMax, 1);
    clipPlanes.push([depth, 0, 0]); // Azimuth 0 for +Y
  }

  // Z min plane
  if (planes.zMin > min[2]) {
    const depth = toNormalizedDepth(planes.zMin, 2);
    clipPlanes.push([-depth, 0, -90]); // Elevation -90 for -Z
  }

  // Z max plane
  if (planes.zMax < max[2]) {
    const depth = toNormalizedDepth(planes.zMax, 2);
    clipPlanes.push([depth, 0, 90]); // Elevation 90 for +Z
  }

  return clipPlanes;
}

/**
 * Check if a point is inside the cropping planes.
 *
 * @param worldCoord - World coordinate [x, y, z]
 * @param planes - Cropping planes
 * @returns True if the point is inside all cropping planes
 */
export function isInsideCroppingPlanes(
  worldCoord: [number, number, number],
  planes: CroppingPlanes
): boolean {
  return (
    worldCoord[0] >= planes.xMin &&
    worldCoord[0] <= planes.xMax &&
    worldCoord[1] >= planes.yMin &&
    worldCoord[1] <= planes.yMax &&
    worldCoord[2] >= planes.zMin &&
    worldCoord[2] <= planes.zMax
  );
}

/**
 * Calculate the volume of the cropping region in world units.
 *
 * @param planes - Cropping planes
 * @returns Volume in world units cubed
 */
export function getCroppingVolume(planes: CroppingPlanes): number {
  return (
    (planes.xMax - planes.xMin) *
    (planes.yMax - planes.yMin) *
    (planes.zMax - planes.zMin)
  );
}

/**
 * Merge two cropping planes, taking the intersection.
 *
 * @param a - First cropping planes
 * @param b - Second cropping planes
 * @returns Intersection of the two cropping planes
 */
export function intersectCroppingPlanes(
  a: CroppingPlanes,
  b: CroppingPlanes
): CroppingPlanes {
  return {
    xMin: Math.max(a.xMin, b.xMin),
    xMax: Math.min(a.xMax, b.xMax),
    yMin: Math.max(a.yMin, b.yMin),
    yMax: Math.min(a.yMax, b.yMax),
    zMin: Math.max(a.zMin, b.zMin),
    zMax: Math.min(a.zMax, b.zMax),
  };
}

/**
 * Expand cropping planes by a margin in world units.
 *
 * @param planes - Original cropping planes
 * @param margin - Margin to expand by (can be negative to shrink)
 * @returns Expanded cropping planes
 */
export function expandCroppingPlanes(
  planes: CroppingPlanes,
  margin: number
): CroppingPlanes {
  return {
    xMin: planes.xMin - margin,
    xMax: planes.xMax + margin,
    yMin: planes.yMin - margin,
    yMax: planes.yMax + margin,
    zMin: planes.zMin - margin,
    zMax: planes.zMax + margin,
  };
}
