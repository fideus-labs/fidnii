// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { Multiscales, NgffImage } from "@fideus-labs/ngff-zarr";
import type { ClipPlane, ClipPlanes, PixelRegion, ChunkAlignedRegion, VolumeBounds } from "./types.js";
import { worldToPixel, pixelToWorld } from "./utils/coordinates.js";
import { getVolumeShape, getChunkShape } from "./ResolutionSelector.js";

/** Maximum number of clip planes supported by NiiVue */
export const MAX_CLIP_PLANES = 6;

/**
 * Normalize a 3D vector to unit length.
 *
 * @param v - Vector to normalize [x, y, z]
 * @returns Normalized vector [x, y, z]
 * @throws Error if vector has zero length
 */
export function normalizeVector(v: [number, number, number]): [number, number, number] {
  const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (length === 0) {
    throw new Error("Cannot normalize zero-length vector");
  }
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * Create a clip plane from a point and normal vector.
 * The normal is automatically normalized to unit length.
 *
 * @param point - A point on the plane [x, y, z] in world coordinates
 * @param normal - Normal vector pointing toward visible region [x, y, z]
 * @returns ClipPlane with normalized normal
 */
export function createClipPlane(
  point: [number, number, number],
  normal: [number, number, number]
): ClipPlane {
  return {
    point: [...point],
    normal: normalizeVector(normal),
  };
}

/**
 * Create default clip planes (empty array = full volume visible).
 *
 * @param _multiscales - The OME-Zarr multiscales data (unused, kept for API consistency)
 * @returns Empty ClipPlanes array
 */
export function createDefaultClipPlanes(_multiscales: Multiscales): ClipPlanes {
  return [];
}

/**
 * Get volume bounds from multiscales metadata.
 *
 * @param multiscales - The OME-Zarr multiscales data
 * @returns Volume bounds in world space
 */
export function getVolumeBoundsFromMultiscales(multiscales: Multiscales): VolumeBounds {
  // Use highest resolution for most accurate bounds
  const image = multiscales.images[0];
  const shape = getVolumeShape(image);

  const minPixel: [number, number, number] = [0, 0, 0];
  const maxPixel: [number, number, number] = [shape[0], shape[1], shape[2]];

  const minWorld = pixelToWorld(minPixel, image);
  const maxWorld = pixelToWorld(maxPixel, image);

  return {
    min: [
      Math.min(minWorld[0], maxWorld[0]),
      Math.min(minWorld[1], maxWorld[1]),
      Math.min(minWorld[2], maxWorld[2]),
    ],
    max: [
      Math.max(minWorld[0], maxWorld[0]),
      Math.max(minWorld[1], maxWorld[1]),
      Math.max(minWorld[2], maxWorld[2]),
    ],
  };
}

/**
 * Convert a normal vector to azimuth and elevation angles (for NiiVue).
 *
 * NiiVue convention:
 * - Azimuth: 0 = posterior (+Y), 90 = right (+X), 180 = anterior (-Y), 270 = left (-X)
 * - Elevation: 0 = horizontal, 90 = superior (+Z), -90 = inferior (-Z)
 *
 * @param normal - Unit normal vector [x, y, z]
 * @returns Object with azimuth and elevation in degrees
 */
export function normalToAzimuthElevation(
  normal: [number, number, number]
): { azimuth: number; elevation: number } {
  const [x, y, z] = normal;

  // Elevation: angle from XY plane (arcsin of z component)
  // Clamp to [-1, 1] to handle floating point errors
  const elevation = Math.asin(Math.max(-1, Math.min(1, z))) * (180 / Math.PI);

  // Azimuth: angle in XY plane from +Y axis
  // atan2(x, y) gives angle from +Y, which matches NiiVue's azimuth=0 = posterior (+Y)
  let azimuth = Math.atan2(x, y) * (180 / Math.PI);
  // Normalize to [0, 360)
  azimuth = ((azimuth % 360) + 360) % 360;

  return { azimuth, elevation };
}

/**
 * Convert azimuth and elevation angles to a unit normal vector.
 *
 * @param azimuth - Azimuth angle in degrees (0 = +Y, 90 = +X)
 * @param elevation - Elevation angle in degrees (0 = horizontal, 90 = +Z)
 * @returns Unit normal vector [x, y, z]
 */
export function azimuthElevationToNormal(
  azimuth: number,
  elevation: number
): [number, number, number] {
  const azRad = (azimuth * Math.PI) / 180;
  const elRad = (elevation * Math.PI) / 180;

  const cosEl = Math.cos(elRad);
  const x = cosEl * Math.sin(azRad);
  const y = cosEl * Math.cos(azRad);
  const z = Math.sin(elRad);

  return [x, y, z];
}

/**
 * Calculate the NiiVue depth parameter for a clip plane.
 *
 * NiiVue's clip plane depth is in normalized texture coordinates where
 * the volume center is at 0.5. Depth represents the signed distance from
 * the center (0) to the plane, where -0.5 is at min boundary and +0.5 is
 * at max boundary. Values beyond [-0.5, 0.5] place the plane outside the volume.
 *
 * @param plane - The clip plane
 * @param volumeBounds - Volume bounds in world space
 * @returns Depth value for NiiVue (typically in range [-0.5, 0.5] for planes within volume)
 */
export function calculateNiivueDepth(
  plane: ClipPlane,
  volumeBounds: VolumeBounds
): number {
  const { min, max } = volumeBounds;

  // Volume center
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];

  // Volume extent
  const extent: [number, number, number] = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ];

  // Signed distance from center to plane along normal
  const { point, normal } = plane;
  const signedDistance =
    normal[0] * (point[0] - center[0]) +
    normal[1] * (point[1] - center[1]) +
    normal[2] * (point[2] - center[2]);

  // Full extent along normal direction (using absolute value of each component)
  // This is the "width" of the bounding box when projected onto the normal direction
  const extentAlongNormal =
    Math.abs(normal[0]) * extent[0] +
    Math.abs(normal[1]) * extent[1] +
    Math.abs(normal[2]) * extent[2];

  // Avoid division by zero
  if (extentAlongNormal === 0) {
    return 0;
  }

  // Normalize to NiiVue's coordinate system where volume spans -0.5 to 0.5 from center
  return signedDistance / extentAlongNormal;
}

/**
 * Convert a single clip plane to NiiVue format [depth, azimuth, elevation].
 *
 * NiiVue's shader convention:
 * - The "back" side of the plane (sampleSide > 0) is VISIBLE
 * - The "front" side of the plane (sampleSide < 0) is CLIPPED
 * - sampleSide = dot(shaderNormal, p - 0.5) + depth
 * - NiiVue internally adds 180° to azimuth, which flips the normal direction
 *
 * Our convention:
 * - Normal points toward the VISIBLE region
 *
 * To reconcile these conventions:
 * 1. We negate the normal before computing azimuth/elevation
 * 2. After NiiVue's +180° flip, the shader sees our original normal direction
 * 3. We also negate the depth to match the flipped normal
 *
 * @param plane - The clip plane
 * @param volumeBounds - Volume bounds in world space
 * @returns [depth, azimuth, elevation] for NiiVue
 */
export function clipPlaneToNiivue(
  plane: ClipPlane,
  volumeBounds: VolumeBounds
): [number, number, number] {
  const depth = calculateNiivueDepth(plane, volumeBounds);
  
  // Negate the normal for azimuth/elevation calculation.
  // After NiiVue adds 180° to azimuth, the shader will see our original normal.
  const negatedNormal: [number, number, number] = [
    -plane.normal[0],
    -plane.normal[1],
    -plane.normal[2],
  ];
  const { azimuth, elevation } = normalToAzimuthElevation(negatedNormal);
  
  // Also negate the depth to be consistent with the flipped normal.
  // The plane equation dot(n, p-center) + d = 0 changes sign when n is negated.
  const negatedDepth = -depth;

  // Debug logging
  console.log("[fidnii] clipPlaneToNiivue:", {
    input: {
      point: plane.point,
      normal: plane.normal,
    },
    computed: {
      depth,
      negatedNormal,
      negatedDepth,
    },
    volumeBounds: {
      min: volumeBounds.min,
      max: volumeBounds.max,
      center: [
        (volumeBounds.min[0] + volumeBounds.max[0]) / 2,
        (volumeBounds.min[1] + volumeBounds.max[1]) / 2,
        (volumeBounds.min[2] + volumeBounds.max[2]) / 2,
      ],
    },
    output: {
      depth: negatedDepth,
      azimuth,
      elevation,
    },
  });

  return [negatedDepth, azimuth, elevation];
}

/**
 * Convert clip planes to NiiVue format.
 *
 * @param clipPlanes - Array of clip planes
 * @param volumeBounds - Volume bounds in world space
 * @returns Array of [depth, azimuth, elevation] for NiiVue
 */
export function clipPlanesToNiivue(
  clipPlanes: ClipPlanes,
  volumeBounds: VolumeBounds
): number[][] {
  return clipPlanes.map((plane) => clipPlaneToNiivue(plane, volumeBounds));
}

/**
 * Calculate the signed distance from a point to a plane.
 *
 * Positive = point is on the visible side (same side as normal)
 * Negative = point is on the clipped side (opposite side from normal)
 *
 * @param testPoint - Point to test [x, y, z]
 * @param plane - The clip plane
 * @returns Signed distance
 */
export function pointToPlaneDistance(
  testPoint: [number, number, number],
  plane: ClipPlane
): number {
  const { point, normal } = plane;
  return (
    normal[0] * (testPoint[0] - point[0]) +
    normal[1] * (testPoint[1] - point[1]) +
    normal[2] * (testPoint[2] - point[2])
  );
}

/**
 * Check if a point is inside all clip planes (on the visible side).
 *
 * @param worldCoord - World coordinate [x, y, z]
 * @param clipPlanes - Array of clip planes
 * @returns True if the point is inside all clip planes (or if there are no planes)
 */
export function isInsideClipPlanes(
  worldCoord: [number, number, number],
  clipPlanes: ClipPlanes
): boolean {
  for (const plane of clipPlanes) {
    if (pointToPlaneDistance(worldCoord, plane) < 0) {
      return false;
    }
  }
  return true;
}

/**
 * Calculate the axis-aligned bounding box that contains the clipped region.
 *
 * For oblique clip planes, this finds the intersection of the clip planes
 * with the volume bounds and returns the AABB of that intersection.
 *
 * This is used for data fetching (zarr is always axis-aligned).
 *
 * @param clipPlanes - Array of clip planes
 * @param volumeBounds - Full volume bounds in world space
 * @returns Bounding box of the clipped region
 */
export function clipPlanesToBoundingBox(
  clipPlanes: ClipPlanes,
  volumeBounds: VolumeBounds
): VolumeBounds {
  // If no clip planes, return full volume
  if (clipPlanes.length === 0) {
    return {
      min: [...volumeBounds.min],
      max: [...volumeBounds.max],
    };
  }

  // Start with full volume bounds
  let minX = volumeBounds.min[0];
  let maxX = volumeBounds.max[0];
  let minY = volumeBounds.min[1];
  let maxY = volumeBounds.max[1];
  let minZ = volumeBounds.min[2];
  let maxZ = volumeBounds.max[2];

  // For each clip plane, constrain the bounding box
  // This is an approximation: we check the 8 corners and constrain based on
  // which corners are clipped. For axis-aligned planes, this is exact.
  // For oblique planes, it's a conservative approximation.
  for (const plane of clipPlanes) {
    const { point, normal } = plane;

    // For axis-aligned normals, we can compute exact bounds
    const absNx = Math.abs(normal[0]);
    const absNy = Math.abs(normal[1]);
    const absNz = Math.abs(normal[2]);

    // Check if plane is approximately axis-aligned
    const tolerance = 0.001;

    if (absNx > 1 - tolerance && absNy < tolerance && absNz < tolerance) {
      // X-aligned plane
      if (normal[0] > 0) {
        // Normal points +X, clips -X side
        minX = Math.max(minX, point[0]);
      } else {
        // Normal points -X, clips +X side
        maxX = Math.min(maxX, point[0]);
      }
    } else if (absNy > 1 - tolerance && absNx < tolerance && absNz < tolerance) {
      // Y-aligned plane
      if (normal[1] > 0) {
        minY = Math.max(minY, point[1]);
      } else {
        maxY = Math.min(maxY, point[1]);
      }
    } else if (absNz > 1 - tolerance && absNx < tolerance && absNy < tolerance) {
      // Z-aligned plane
      if (normal[2] > 0) {
        minZ = Math.max(minZ, point[2]);
      } else {
        maxZ = Math.min(maxZ, point[2]);
      }
    } else {
      // Oblique plane - use conservative approximation
      // Find the extent of the plane intersection with the volume
      // For simplicity, we use the point on the plane as a bound hint
      // This is conservative (may fetch more data than needed)

      // Project the plane point onto each axis and use as potential bound
      // Only constrain if the plane actually intersects that face
      if (normal[0] > tolerance) {
        minX = Math.max(minX, Math.min(point[0], maxX));
      } else if (normal[0] < -tolerance) {
        maxX = Math.min(maxX, Math.max(point[0], minX));
      }

      if (normal[1] > tolerance) {
        minY = Math.max(minY, Math.min(point[1], maxY));
      } else if (normal[1] < -tolerance) {
        maxY = Math.min(maxY, Math.max(point[1], minY));
      }

      if (normal[2] > tolerance) {
        minZ = Math.max(minZ, Math.min(point[2], maxZ));
      } else if (normal[2] < -tolerance) {
        maxZ = Math.min(maxZ, Math.max(point[2], minZ));
      }
    }
  }

  // Ensure valid bounds (min <= max)
  return {
    min: [
      Math.min(minX, maxX),
      Math.min(minY, maxY),
      Math.min(minZ, maxZ),
    ],
    max: [
      Math.max(minX, maxX),
      Math.max(minY, maxY),
      Math.max(minZ, maxZ),
    ],
  };
}

/**
 * Convert clip planes to a pixel region for a specific NgffImage.
 *
 * This calculates the axis-aligned bounding box of the clipped region
 * and converts it to pixel coordinates.
 *
 * @param clipPlanes - Array of clip planes
 * @param volumeBounds - Full volume bounds in world space
 * @param ngffImage - The NgffImage to convert to
 * @returns Pixel region [z, y, x] start and end indices
 */
export function clipPlanesToPixelRegion(
  clipPlanes: ClipPlanes,
  volumeBounds: VolumeBounds,
  ngffImage: NgffImage
): PixelRegion {
  const bounds = clipPlanesToBoundingBox(clipPlanes, volumeBounds);
  const shape = getVolumeShape(ngffImage);

  // Convert world corners to pixel coordinates
  const minWorld: [number, number, number] = [bounds.min[0], bounds.min[1], bounds.min[2]];
  const maxWorld: [number, number, number] = [bounds.max[0], bounds.max[1], bounds.max[2]];

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
 * Create an axis-aligned clip plane at a specific position.
 *
 * The normal points toward the VISIBLE region (the region to keep).
 * NiiVue's shader convention is that the "back" side of the plane (where
 * dot(n, p-center) + depth > 0) is visible.
 *
 * @param axis - The axis ('x', 'y', or 'z')
 * @param position - Position along the axis in world coordinates
 * @param direction - Which side to keep visible ('positive' or 'negative')
 * @param volumeBounds - Volume bounds for centering the point
 * @returns ClipPlane with point at center of volume projected to the plane
 */
export function createAxisAlignedClipPlane(
  axis: "x" | "y" | "z",
  position: number,
  direction: "positive" | "negative",
  volumeBounds: VolumeBounds
): ClipPlane {
  const { min, max } = volumeBounds;
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];

  let point: [number, number, number];
  let normal: [number, number, number];

  // Normal points toward the visible region
  const sign = direction === "positive" ? 1 : -1;

  switch (axis) {
    case "x":
      point = [position, center[1], center[2]];
      normal = [sign, 0, 0];
      break;
    case "y":
      point = [center[0], position, center[2]];
      normal = [0, sign, 0];
      break;
    case "z":
      point = [center[0], center[1], position];
      normal = [0, 0, sign];
      break;
  }

  return { point, normal };
}

/**
 * Validate clip planes array.
 *
 * @param clipPlanes - Array of clip planes to validate
 * @throws Error if validation fails
 */
export function validateClipPlanes(clipPlanes: ClipPlanes): void {
  if (clipPlanes.length > MAX_CLIP_PLANES) {
    throw new Error(
      `Too many clip planes: ${clipPlanes.length} exceeds maximum of ${MAX_CLIP_PLANES}`
    );
  }

  for (let i = 0; i < clipPlanes.length; i++) {
    const plane = clipPlanes[i];

    // Check point is valid
    if (
      !Array.isArray(plane.point) ||
      plane.point.length !== 3 ||
      plane.point.some((v) => typeof v !== "number" || !isFinite(v))
    ) {
      throw new Error(`Invalid point in clip plane ${i}`);
    }

    // Check normal is valid
    if (
      !Array.isArray(plane.normal) ||
      plane.normal.length !== 3 ||
      plane.normal.some((v) => typeof v !== "number" || !isFinite(v))
    ) {
      throw new Error(`Invalid normal in clip plane ${i}`);
    }

    // Check normal is not zero
    const length = Math.sqrt(
      plane.normal[0] ** 2 + plane.normal[1] ** 2 + plane.normal[2] ** 2
    );
    if (length < 0.0001) {
      throw new Error(`Zero-length normal in clip plane ${i}`);
    }
  }
}
