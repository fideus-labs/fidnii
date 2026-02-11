// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { Niivue } from "@niivue/niivue";
import { SLICE_TYPE } from "@niivue/niivue";
import type { VolumeBounds } from "./types.js";

/**
 * Intersect two axis-aligned bounding boxes.
 * Returns the overlapping region, clamped so max >= min.
 */
export function intersectBounds(
  a: VolumeBounds,
  b: VolumeBounds,
): VolumeBounds {
  const min: [number, number, number] = [
    Math.max(a.min[0], b.min[0]),
    Math.max(a.min[1], b.min[1]),
    Math.max(a.min[2], b.min[2]),
  ];
  const max: [number, number, number] = [
    Math.min(a.max[0], b.max[0]),
    Math.min(a.max[1], b.max[1]),
    Math.min(a.max[2], b.max[2]),
  ];
  // Ensure valid bounds (max >= min)
  return {
    min: [
      Math.min(min[0], max[0]),
      Math.min(min[1], max[1]),
      Math.min(min[2], max[2]),
    ],
    max: [
      Math.max(min[0], max[0]),
      Math.max(min[1], max[1]),
      Math.max(min[2], max[2]),
    ],
  };
}

/**
 * Compute the world-space axis-aligned bounding box of the visible region
 * in a 3D render view.
 *
 * NiiVue uses an orthographic projection whose extents depend on
 * `volScaleMultiplier`, `renderAzimuth`, and `renderElevation`.
 * We build the 8 corners of the ortho frustum, rotate them by the inverse
 * of the view rotation, and take the AABB.
 *
 * @param nv - The Niivue instance
 * @param volumeBounds - Full volume bounds to intersect with
 * @returns Viewport bounds in world space, intersected with volumeBounds
 */
export function computeViewportBounds3D(
  nv: Niivue,
  volumeBounds: VolumeBounds,
): VolumeBounds {
  // Get scene extents: [min, max, range]
  const extents = nv.sceneExtentsMinMax(true);
  const mn = extents[0]; // vec3
  const mx = extents[1]; // vec3
  const range = extents[2]; // vec3

  // Pivot = center of scene
  const pivotX = (mn[0] + mx[0]) * 0.5;
  const pivotY = (mn[1] + mx[1]) * 0.5;
  const pivotZ = (mn[2] + mx[2]) * 0.5;

  // furthestFromPivot = half-diagonal of bounding box
  const furthest = Math.sqrt(
    range[0] * range[0] + range[1] * range[1] + range[2] * range[2],
  ) * 0.5;

  // NiiVue's orthographic scale (matches calculateMvpMatrix)
  const scale = (0.8 * furthest) / (nv.scene.volScaleMultiplier || 1);

  // Canvas aspect ratio
  const canvas = nv.canvas;
  const canvasW = canvas?.width ?? 1;
  const canvasH = canvas?.height ?? 1;
  const whratio = canvasW / canvasH;

  // Ortho extents in view space (before rotation)
  let halfW: number, halfH: number;
  if (whratio < 1) {
    // Portrait
    halfW = scale;
    halfH = scale / whratio;
  } else {
    // Landscape
    halfW = scale * whratio;
    halfH = scale;
  }
  // For viewport-aware resolution, we need the world-space extent that is
  // visible on screen. Rather than rotating a full 3D frustum box (whose depth
  // dominates the AABB after rotation), we compute the extent differently:
  //
  // Project the view-space axes onto world space and accumulate the half-extents
  // contributed by each view axis. The view X axis (with extent halfW) and view
  // Y axis (with extent halfH) determine what is visible on screen. The depth
  // axis does NOT constrain visibility — we see through the full depth of the
  // volume — so we include the full volume extent along the view Z axis.

  // Build the inverse of NiiVue's view rotation.
  // NiiVue applies: rotateX(270 - elevation) then rotateZ(azimuth - 180)
  // Also mirrors X (modelMatrix[0] = -1).
  // We need the inverse rotation to go from view space back to world space.
  const azimuth = nv.scene.renderAzimuth ?? 0;
  const elevation = nv.scene.renderElevation ?? 0;
  const azRad = ((azimuth - 180) * Math.PI) / 180;
  const elRad = ((270 - elevation) * Math.PI) / 180;

  const cosAz = Math.cos(azRad);
  const sinAz = Math.sin(azRad);
  const cosEl = Math.cos(elRad);
  const sinEl = Math.sin(elRad);

  // Compute inverse rotation of unit view-space axes to world space.
  // Inverse: un-mirror X, then rotateZ(-azRad), then rotateX(-elRad).
  //
  // View X axis (1, 0, 0) after un-mirror: (-1, 0, 0)
  const viewXinWorld: [number, number, number] = [
    -cosAz, // wx
    sinAz * cosEl, // wy
    -sinAz * sinEl, // wz
  ];
  // View Y axis (0, 1, 0) — no mirror effect
  const viewYinWorld: [number, number, number] = [
    sinAz, // wx
    cosAz * cosEl, // wy
    -cosAz * sinEl, // wz
  ];
  // View Z axis (0, 0, 1) — no mirror effect
  const viewZinWorld: [number, number, number] = [
    0, // wx
    sinEl, // wy
    cosEl, // wz
  ];

  // For each world axis, the visible half-extent is:
  //   halfW * |viewXinWorld[axis]| + halfH * |viewYinWorld[axis]|
  //   + furthest * |viewZinWorld[axis]|  (full volume depth along view Z)
  const worldHalfExtent: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    worldHalfExtent[axis] = halfW * Math.abs(viewXinWorld[axis]) +
      halfH * Math.abs(viewYinWorld[axis]) +
      furthest * Math.abs(viewZinWorld[axis]);
  }

  const frustumBounds: VolumeBounds = {
    min: [
      pivotX - worldHalfExtent[0],
      pivotY - worldHalfExtent[1],
      pivotZ - worldHalfExtent[2],
    ],
    max: [
      pivotX + worldHalfExtent[0],
      pivotY + worldHalfExtent[1],
      pivotZ + worldHalfExtent[2],
    ],
  };

  return intersectBounds(frustumBounds, volumeBounds);
}

/**
 * Compute the world-space bounding box of the visible region in a 2D slice
 * view, accounting for pan and zoom.
 *
 * NiiVue's 2D slice renderer applies pan (`pan2Dxyzmm[0..2]`) and zoom
 * (`pan2Dxyzmm[3]`) to the base field of view. We replicate this math to
 * determine what mm range is visible on screen.
 *
 * @param nv - The Niivue instance
 * @param sliceType - Current 2D slice type (AXIAL, CORONAL, SAGITTAL)
 * @param volumeBounds - Full volume bounds to intersect with
 * @param normalizationScale - If the NVImage affine was normalized (multiplied
 *   by 1/maxVoxelSize to avoid NiiVue precision issues), pass that scale here
 *   so we can convert the NiiVue mm-space FOV back to physical world
 *   coordinates. Pass 1.0 if no normalization was applied.
 * @returns Viewport bounds in world space, intersected with volumeBounds
 */
export function computeViewportBounds2D(
  nv: Niivue,
  sliceType: SLICE_TYPE,
  volumeBounds: VolumeBounds,
  normalizationScale: number = 1.0,
): VolumeBounds {
  // Compute the base field of view from the FULL volume bounds (in normalized
  // mm space), then swizzle to screen axes for this slice orientation.
  //
  // IMPORTANT: We intentionally do NOT use nv.screenFieldOfViewExtendedMM()
  // because that returns the extents of the *currently loaded* NVImage (the
  // slab). After a viewport-aware reload shrinks the slab, the next call to
  // screenFieldOfViewExtendedMM() would return a smaller FOV, creating a
  // feedback loop that progressively shrinks the slab to nothing.
  //
  // Instead, we derive the base FOV from the constant full-volume bounds,
  // scaled to normalized mm space (matching the slab NVImage's affine).
  // We then apply the same swizzle that NiiVue uses, giving us a stable
  // base FOV that doesn't depend on the current slab geometry.
  const normMin: [number, number, number] = [
    volumeBounds.min[0] * normalizationScale,
    volumeBounds.min[1] * normalizationScale,
    volumeBounds.min[2] * normalizationScale,
  ];
  const normMax: [number, number, number] = [
    volumeBounds.max[0] * normalizationScale,
    volumeBounds.max[1] * normalizationScale,
    volumeBounds.max[2] * normalizationScale,
  ];

  // Swizzle to screen axes (same mapping as NiiVue's swizzleVec3MM):
  //   AXIAL:    screen X = mm X, screen Y = mm Y
  //   CORONAL:  screen X = mm X, screen Y = mm Z
  //   SAGITTAL: screen X = mm Y, screen Y = mm Z
  let mnMM0: number, mxMM0: number, mnMM1: number, mxMM1: number;
  switch (sliceType) {
    case SLICE_TYPE.CORONAL:
      mnMM0 = normMin[0];
      mxMM0 = normMax[0]; // screen X = mm X
      mnMM1 = normMin[2];
      mxMM1 = normMax[2]; // screen Y = mm Z
      break;
    case SLICE_TYPE.SAGITTAL:
      mnMM0 = normMin[1];
      mxMM0 = normMax[1]; // screen X = mm Y
      mnMM1 = normMin[2];
      mxMM1 = normMax[2]; // screen Y = mm Z
      break;
    default: // AXIAL
      mnMM0 = normMin[0];
      mxMM0 = normMax[0]; // screen X = mm X
      mnMM1 = normMin[1];
      mxMM1 = normMax[1]; // screen Y = mm Y
      break;
  }

  // Account for canvas aspect ratio stretching (matches draw2DMain logic)
  // NiiVue stretches the FOV to fill the canvas while preserving aspect ratio
  const canvas = nv.canvas;
  if (canvas) {
    const canvasW = canvas.width || 1;
    const canvasH = canvas.height || 1;
    const fovW = Math.abs(mxMM0 - mnMM0);
    const fovH = Math.abs(mxMM1 - mnMM1);
    if (fovW > 0 && fovH > 0) {
      const canvasAspect = canvasW / canvasH;
      const fovAspect = fovW / fovH;
      if (canvasAspect > fovAspect) {
        // Canvas is wider than FOV: expand X
        const midX = (mnMM0 + mxMM0) * 0.5;
        const newHalfW = (fovH * canvasAspect) * 0.5;
        mnMM0 = midX - newHalfW;
        mxMM0 = midX + newHalfW;
      } else {
        // Canvas is taller than FOV: expand Y
        const midY = (mnMM1 + mxMM1) * 0.5;
        const newHalfH = (fovW / canvasAspect) * 0.5;
        mnMM1 = midY - newHalfH;
        mxMM1 = midY + newHalfH;
      }
    }
  }

  // Apply pan and zoom (matching NiiVue's draw2DMain logic)
  const pan = nv.scene.pan2Dxyzmm; // vec4: [panX, panY, panZ, zoom]
  // Swizzle the pan vector to match the current orientation
  const panSwizzled = nv.swizzleVec3MM(
    [pan[0], pan[1], pan[2]] as unknown as import("gl-matrix").vec3,
    sliceType,
  );
  const zoom = pan[3] || 1;

  // Apply pan: shift visible window
  mnMM0 -= panSwizzled[0];
  mxMM0 -= panSwizzled[0];
  mnMM1 -= panSwizzled[1];
  mxMM1 -= panSwizzled[1];

  // Apply zoom: divide by zoom factor (zoom > 1 = zoomed in = smaller FOV)
  mnMM0 /= zoom;
  mxMM0 /= zoom;
  mnMM1 /= zoom;
  mxMM1 /= zoom;

  // Convert from NiiVue's mm space back to physical world coordinates.
  // If the slab affine was normalized (multiplied by normalizationScale),
  // NiiVue's mm values are world * normalizationScale. Dividing by the
  // normalization scale recovers physical coordinates.
  if (normalizationScale !== 1.0 && normalizationScale > 0) {
    const invNorm = 1.0 / normalizationScale;
    mnMM0 *= invNorm;
    mxMM0 *= invNorm;
    mnMM1 *= invNorm;
    mxMM1 *= invNorm;
  }

  // Now un-swizzle back to RAS world coordinates.
  // The swizzle maps depend on the slice orientation:
  // AXIAL:    screen X = R/L (world X), screen Y = A/P (world Y)
  // CORONAL:  screen X = R/L (world X), screen Y = S/I (world Z)
  // SAGITTAL: screen X = A/P (world Y), screen Y = S/I (world Z)
  //
  // The orthogonal axis (depth) is left as full volume extent.
  const result: VolumeBounds = {
    min: [...volumeBounds.min],
    max: [...volumeBounds.max],
  };

  // Ensure min < max for each swizzled axis
  const visMin0 = Math.min(mnMM0, mxMM0);
  const visMax0 = Math.max(mnMM0, mxMM0);
  const visMin1 = Math.min(mnMM1, mxMM1);
  const visMax1 = Math.max(mnMM1, mxMM1);

  switch (sliceType) {
    case SLICE_TYPE.AXIAL:
      // screen X = world X (R/L), screen Y = world Y (A/P)
      result.min[0] = visMin0;
      result.max[0] = visMax0;
      result.min[1] = visMin1;
      result.max[1] = visMax1;
      // Z (S/I) = full extent (orthogonal axis)
      break;
    case SLICE_TYPE.CORONAL:
      // screen X = world X (R/L), screen Y = world Z (S/I)
      result.min[0] = visMin0;
      result.max[0] = visMax0;
      result.min[2] = visMin1;
      result.max[2] = visMax1;
      // Y (A/P) = full extent (orthogonal axis)
      break;
    case SLICE_TYPE.SAGITTAL:
      // screen X = world Y (A/P), screen Y = world Z (S/I)
      result.min[1] = visMin0;
      result.max[1] = visMax0;
      result.min[2] = visMin1;
      result.max[2] = visMax1;
      // X (R/L) = full extent (orthogonal axis)
      break;
  }

  return intersectBounds(result, volumeBounds);
}

/**
 * Check if two VolumeBounds are approximately equal.
 *
 * @param a - First bounds
 * @param b - Second bounds
 * @param tolerance - Relative tolerance (default: 0.01 = 1%)
 * @returns True if bounds are within tolerance
 */
export function boundsApproxEqual(
  a: VolumeBounds,
  b: VolumeBounds,
  tolerance: number = 0.01,
): boolean {
  for (let i = 0; i < 3; i++) {
    const rangeA = a.max[i] - a.min[i];
    const rangeB = b.max[i] - b.min[i];
    const maxRange = Math.max(Math.abs(rangeA), Math.abs(rangeB), 1e-10);

    if (Math.abs(a.min[i] - b.min[i]) / maxRange > tolerance) return false;
    if (Math.abs(a.max[i] - b.max[i]) / maxRange > tolerance) return false;
  }
  return true;
}
