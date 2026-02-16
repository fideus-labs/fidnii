// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { NgffImage } from "@fideus-labs/ngff-zarr"
import { mat4 } from "gl-matrix"

import { applyOrientationToAffine } from "./orientation.js"

/**
 * Create a 4x4 affine transformation matrix from OME-Zarr scale and translation.
 *
 * The affine matrix transforms from pixel indices to world coordinates.
 * NIfTI uses a column-major 4x4 matrix stored as a flat array of 16 elements.
 *
 * For OME-Zarr, the transformation is:
 *   world = scale * pixel + translation
 *
 * The matrix form is:
 *   | sx  0   0  tx |
 *   | 0   sy  0  ty |
 *   | 0   0   sz tz |
 *   | 0   0   0  1  |
 *
 * @param scale - Scale factors { x, y, z }
 * @param translation - Translation offsets { x, y, z }
 * @returns 4x4 affine matrix as a flat Float32Array (column-major)
 */
export function createAffineFromOMEZarr(
  scale: Record<string, number>,
  translation: Record<string, number>,
): mat4 {
  const affine = mat4.create()

  // NIfTI expects the matrix in a specific orientation
  // The affine maps from (i, j, k) voxel indices to (x, y, z) world coordinates
  // For OME-Zarr with [z, y, x] ordering, we need to handle the axis mapping

  // Extract scale and translation for each axis
  const sx = scale.x ?? scale.X ?? 1
  const sy = scale.y ?? scale.Y ?? 1
  const sz = scale.z ?? scale.Z ?? 1

  const tx = translation.x ?? translation.X ?? 0
  const ty = translation.y ?? translation.Y ?? 0
  const tz = translation.z ?? translation.Z ?? 0

  // Build affine matrix
  // NIfTI convention: first index (i) -> x, second (j) -> y, third (k) -> z
  // OME-Zarr stores data as [z, y, x], so we need to account for this

  // Column 0: x direction (from third array index in [z,y,x])
  affine[0] = sx
  affine[1] = 0
  affine[2] = 0
  affine[3] = 0

  // Column 1: y direction (from second array index in [z,y,x])
  affine[4] = 0
  affine[5] = sy
  affine[6] = 0
  affine[7] = 0

  // Column 2: z direction (from first array index in [z,y,x])
  affine[8] = 0
  affine[9] = 0
  affine[10] = sz
  affine[11] = 0

  // Column 3: translation
  affine[12] = tx
  affine[13] = ty
  affine[14] = tz
  affine[15] = 1

  return affine
}

/**
 * Create an affine matrix from an NgffImage.
 *
 * If the image has RFC-4 anatomical orientation metadata
 * (`axesOrientations`), the affine column vectors and translations
 * are sign-flipped so the matrix encodes direction relative to
 * the NIfTI RAS+ convention. This allows NiiVue's `calculateRAS()`
 * to correctly determine the anatomical layout.
 *
 * When no orientation metadata is present, the matrix is identical
 * to a plain scale + translation affine (backward-compatible).
 *
 * @param ngffImage - The NgffImage containing scale, translation,
 *   and optional `axesOrientations`
 * @returns 4x4 affine matrix with orientation signs applied
 */
export function createAffineFromNgffImage(ngffImage: NgffImage): mat4 {
  const affine = createAffineFromOMEZarr(ngffImage.scale, ngffImage.translation)
  return applyOrientationToAffine(affine, ngffImage.axesOrientations)
}

/**
 * Convert an affine matrix to a flat array for NIfTI header.
 * NIfTI uses srow_x, srow_y, srow_z which are the first 3 rows of the affine.
 *
 * @param affine - The 4x4 affine matrix
 * @returns Object with srow_x, srow_y, srow_z arrays
 */
export function affineToNiftiSrows(affine: mat4): {
  srow_x: [number, number, number, number]
  srow_y: [number, number, number, number]
  srow_z: [number, number, number, number]
} {
  // gl-matrix uses column-major order
  // Row 0 (srow_x): elements 0, 4, 8, 12
  // Row 1 (srow_y): elements 1, 5, 9, 13
  // Row 2 (srow_z): elements 2, 6, 10, 14
  return {
    srow_x: [affine[0], affine[4], affine[8], affine[12]],
    srow_y: [affine[1], affine[5], affine[9], affine[13]],
    srow_z: [affine[2], affine[6], affine[10], affine[14]],
  }
}

/**
 * Get pixel dimensions (voxel sizes) from an affine matrix.
 *
 * @param affine - The 4x4 affine matrix
 * @returns Pixel dimensions [x, y, z]
 */
export function getPixelDimensions(affine: mat4): [number, number, number] {
  // The pixel dimensions are the lengths of the column vectors
  const dx = Math.sqrt(affine[0] ** 2 + affine[1] ** 2 + affine[2] ** 2)
  const dy = Math.sqrt(affine[4] ** 2 + affine[5] ** 2 + affine[6] ** 2)
  const dz = Math.sqrt(affine[8] ** 2 + affine[9] ** 2 + affine[10] ** 2)

  return [dx, dy, dz]
}

/**
 * Update affine matrix for a cropped/subsampled region.
 *
 * When we load a subregion or at a different resolution, we need to update
 * the affine to reflect the new origin and voxel sizes.
 *
 * @param originalAffine - Original affine matrix
 * @param regionStart - Start pixel indices [z, y, x] of the region
 * @param scaleFactor - Scale factor applied (> 1 means downsampled)
 * @returns Updated affine matrix
 */
export function updateAffineForRegion(
  originalAffine: mat4,
  regionStart: [number, number, number],
  scaleFactor: [number, number, number],
): mat4 {
  const result = mat4.clone(originalAffine)

  // Scale the voxel dimensions
  // Column 0 (x direction)
  result[0] *= scaleFactor[2] // x scale factor
  result[1] *= scaleFactor[2]
  result[2] *= scaleFactor[2]

  // Column 1 (y direction)
  result[4] *= scaleFactor[1] // y scale factor
  result[5] *= scaleFactor[1]
  result[6] *= scaleFactor[1]

  // Column 2 (z direction)
  result[8] *= scaleFactor[0] // z scale factor
  result[9] *= scaleFactor[0]
  result[10] *= scaleFactor[0]

  // Update translation for region offset
  // New origin = original_origin + regionStart * original_voxel_size
  const originalPixelDims = getPixelDimensions(originalAffine)

  result[12] += regionStart[2] * originalPixelDims[0] // x offset
  result[13] += regionStart[1] * originalPixelDims[1] // y offset
  result[14] += regionStart[0] * originalPixelDims[2] // z offset

  return result
}

/**
 * Calculate the world-space bounding box from an affine and dimensions.
 *
 * @param affine - The 4x4 affine matrix
 * @param dimensions - Volume dimensions [z, y, x]
 * @returns Bounding box { min: [x,y,z], max: [x,y,z] }
 */
export function calculateWorldBounds(
  affine: mat4,
  dimensions: [number, number, number],
): { min: [number, number, number]; max: [number, number, number] } {
  // Calculate all 8 corners of the volume in world space
  const [dimZ, dimY, dimX] = dimensions
  const corners = [
    [0, 0, 0],
    [dimX, 0, 0],
    [0, dimY, 0],
    [0, 0, dimZ],
    [dimX, dimY, 0],
    [dimX, 0, dimZ],
    [0, dimY, dimZ],
    [dimX, dimY, dimZ],
  ]

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity

  for (const [i, j, k] of corners) {
    // Apply affine: world = affine * [i, j, k, 1]^T
    const wx = affine[0] * i + affine[4] * j + affine[8] * k + affine[12]
    const wy = affine[1] * i + affine[5] * j + affine[9] * k + affine[13]
    const wz = affine[2] * i + affine[6] * j + affine[10] * k + affine[14]

    minX = Math.min(minX, wx)
    minY = Math.min(minY, wy)
    minZ = Math.min(minZ, wz)
    maxX = Math.max(maxX, wx)
    maxY = Math.max(maxY, wy)
    maxZ = Math.max(maxZ, wz)
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  }
}
