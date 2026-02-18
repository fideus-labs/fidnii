// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { AnatomicalOrientation } from "@fideus-labs/ngff-zarr"
import type { mat4 } from "gl-matrix"

/**
 * Mapping from an array axis orientation to the physical (RAS) row
 * and sign it should occupy in the NIfTI affine.
 *
 * - `physicalRow`: which row of the 4x4 affine the scale/translation
 *   should be placed in (0 = R/L, 1 = A/P, 2 = S/I)
 * - `sign`: `1` if the orientation is in the RAS+ direction,
 *   `-1` if opposite
 */
export interface OrientationMapping {
  readonly physicalRow: 0 | 1 | 2
  readonly sign: 1 | -1
}

/**
 * Sign multipliers for each spatial axis, used to encode anatomical
 * orientation into the NIfTI affine matrix.
 *
 * A value of `1` means the axis increases in the RAS+ direction
 * (Right, Anterior, Superior). A value of `-1` means it increases
 * in the opposite direction (Left, Posterior, Inferior).
 *
 * @deprecated Use {@link getOrientationMapping} for full permutation
 *   support. This interface only captures sign, not axis permutations.
 */
export interface OrientationSigns {
  readonly x: 1 | -1
  readonly y: 1 | -1
  readonly z: 1 | -1
}

/**
 * Lookup table mapping each RFC-4 anatomical orientation string to
 * its NIfTI RAS+ physical row and sign.
 *
 * RAS+ convention:
 * - Row 0 (X): left-to-right (R+)
 * - Row 1 (Y): posterior-to-anterior (A+)
 * - Row 2 (Z): inferior-to-superior (S+)
 */
const ORIENTATION_INFO: Record<string, OrientationMapping> = {
  // L/R pair → physical row 0
  "left-to-right": { physicalRow: 0, sign: 1 },
  "right-to-left": { physicalRow: 0, sign: -1 },
  // A/P pair → physical row 1
  "posterior-to-anterior": { physicalRow: 1, sign: 1 },
  "anterior-to-posterior": { physicalRow: 1, sign: -1 },
  // S/I pair → physical row 2
  "inferior-to-superior": { physicalRow: 2, sign: 1 },
  "superior-to-inferior": { physicalRow: 2, sign: -1 },
}

/**
 * Get the orientation mapping (physical row + RAS sign) for a single
 * axis orientation.
 *
 * For unknown/exotic orientations, returns `undefined`.
 *
 * @param orientation - The anatomical orientation for one axis
 * @returns The physical row and sign, or `undefined` if not a standard
 *   L/R, A/P, or S/I orientation
 */
export function getOrientationInfo(
  orientation: AnatomicalOrientation,
): OrientationMapping | undefined {
  return ORIENTATION_INFO[orientation.value]
}

/**
 * Get orientation mappings for all three spatial axes.
 *
 * Each mapping tells you which physical (RAS) row the array axis
 * maps to and what sign to apply. This supports both sign flips
 * (e.g. LPS) and axis permutations (e.g. when the OME-Zarr y axis
 * encodes S/I instead of A/P).
 *
 * When no orientation metadata is present, returns the identity
 * mapping: x→row 0 sign +1, y→row 1 sign +1, z→row 2 sign +1.
 *
 * @param axesOrientations - Orientation metadata from
 *   `NgffImage.axesOrientations`, or `undefined`
 * @returns Mappings for x, y, and z axes
 *
 * @example
 * ```typescript
 * // LPS data: x→row0 sign-1, y→row1 sign-1, z→row2 sign+1
 * getOrientationMapping(LPS)
 *
 * // Permuted (mri.nii.gz): x→row0 sign-1, y→row2 sign-1, z→row1 sign+1
 * getOrientationMapping(permutedOrientations)
 * ```
 */
export function getOrientationMapping(
  axesOrientations: Record<string, AnatomicalOrientation> | undefined,
): { x: OrientationMapping; y: OrientationMapping; z: OrientationMapping } {
  const defaultMapping = {
    x: { physicalRow: 0 as const, sign: 1 as const },
    y: { physicalRow: 1 as const, sign: 1 as const },
    z: { physicalRow: 2 as const, sign: 1 as const },
  }

  if (!axesOrientations) {
    return defaultMapping
  }

  const xOrientation = axesOrientations.x ?? axesOrientations.X
  const yOrientation = axesOrientations.y ?? axesOrientations.Y
  const zOrientation = axesOrientations.z ?? axesOrientations.Z

  const mapping = {
    x:
      (xOrientation ? getOrientationInfo(xOrientation) : undefined) ??
      defaultMapping.x,
    y:
      (yOrientation ? getOrientationInfo(yOrientation) : undefined) ??
      defaultMapping.y,
    z:
      (zOrientation ? getOrientationInfo(zOrientation) : undefined) ??
      defaultMapping.z,
  }

  // Validate that each physicalRow is used exactly once to prevent
  // degenerate affine matrices where columns overwrite each other
  const rowsUsed = new Set([
    mapping.x.physicalRow,
    mapping.y.physicalRow,
    mapping.z.physicalRow,
  ])

  if (rowsUsed.size !== 3) {
    console.warn(
      "[fidnii] Invalid orientation metadata: multiple axes map to the same physical row. Falling back to identity mapping.",
    )
    return defaultMapping
  }

  return mapping
}

/**
 * Compute RAS+ sign multipliers from RFC-4 anatomical orientation metadata.
 *
 * For each spatial axis, determines whether the axis direction is aligned
 * with (+1) or opposite to (-1) the NIfTI RAS+ convention:
 * - x: positive = left-to-right (R), negative = right-to-left (L)
 * - y: positive = posterior-to-anterior (A), negative = anterior-to-posterior (P)
 * - z: positive = inferior-to-superior (S), negative = superior-to-inferior (I)
 *
 * Only the 6 standard L/R, A/P, I/S orientations are handled. Exotic
 * orientations (dorsal/ventral, rostral/caudal, etc.) are treated as
 * unknown and default to +1.
 *
 * **Note**: This function only returns sign information, not axis
 * permutation. For full permutation support, use
 * {@link getOrientationMapping} and {@link applyOrientationToAffine}.
 *
 * @param axesOrientations - Orientation metadata from `NgffImage.axesOrientations`,
 *   or `undefined` if no orientation metadata is present
 * @returns Sign multipliers for x, y, and z axes
 *
 * @example
 * ```typescript
 * import { LPS, RAS } from "@fideus-labs/ngff-zarr"
 *
 * // LPS data: x and y are anti-RAS+
 * getOrientationSigns(LPS)
 * // => { x: -1, y: -1, z: 1 }
 *
 * // RAS data: all axes are RAS+
 * getOrientationSigns(RAS)
 * // => { x: 1, y: 1, z: 1 }
 *
 * // No orientation: defaults to all positive
 * getOrientationSigns(undefined)
 * // => { x: 1, y: 1, z: 1 }
 * ```
 */
export function getOrientationSigns(
  axesOrientations: Record<string, AnatomicalOrientation> | undefined,
): OrientationSigns {
  const mapping = getOrientationMapping(axesOrientations)
  return {
    x: mapping.x.sign,
    y: mapping.y.sign,
    z: mapping.z.sign,
  }
}

/**
 * Apply anatomical orientation to an affine matrix in place.
 *
 * Builds a rotation/permutation matrix from the orientation metadata
 * and applies it to the affine's 3x3 rotation/scale submatrix. This
 * supports both simple sign flips (e.g. LPS where axes align with
 * physical axes but directions differ) and full axis permutations
 * (e.g. when OME-Zarr y axis encodes S/I instead of A/P).
 *
 * The input affine is expected to be a diagonal scale+translation
 * matrix in gl-matrix column-major format, as produced by
 * `createAffineFromOMEZarr()`:
 *
 * ```
 * | sx  0   0  tx |
 * | 0   sy  0  ty |
 * | 0   0   sz tz |
 * | 0   0   0  1  |
 * ```
 *
 * **3x3 submatrix**: Each column's scale is placed in the row
 * corresponding to the physical RAS axis the array axis maps to,
 * with the appropriate sign:
 *
 * ```
 * Column j (array axis j):
 *   row = physicalRow for axis j
 *   affine[j*4 + row] = sign * scale_j
 * ```
 *
 * **Translation column**: Sign-flipped for LPS→RAS conversion but
 * NOT row-permuted. This is because `itkImageToNgffImage` stores
 * the ITK LPS origin values in array-axis-label order without
 * transforming them through the direction matrix. The label
 * assignment (x/y/z) follows the reversed ITK axis indices, so the
 * physical meaning of each translation value matches its original
 * LPS axis, regardless of axis permutation.
 *
 * When `axesOrientations` is `undefined`, the affine is left
 * unchanged (backward-compatible identity mapping).
 *
 * @param affine - 4x4 affine matrix (column-major, modified in place)
 * @param axesOrientations - Orientation metadata from `NgffImage.axesOrientations`
 * @returns The same affine matrix (for chaining)
 */
export function applyOrientationToAffine(
  affine: mat4,
  axesOrientations: Record<string, AnatomicalOrientation> | undefined,
): mat4 {
  if (!axesOrientations) {
    return affine
  }

  const mapping = getOrientationMapping(axesOrientations)

  // Extract the current diagonal scale and translation values
  // (the input affine is expected to be diagonal from createAffineFromOMEZarr)
  const sx = affine[0]
  const sy = affine[5]
  const sz = affine[10]
  const tx = affine[12]
  const ty = affine[13]
  const tz = affine[14]

  // Clear the 3x3 submatrix (translation will be overwritten below)
  // Column 0
  affine[0] = 0
  affine[1] = 0
  affine[2] = 0
  // Column 1
  affine[4] = 0
  affine[5] = 0
  affine[6] = 0
  // Column 2
  affine[8] = 0
  affine[9] = 0
  affine[10] = 0

  // Place each axis' scale into the correct physical row.
  // gl-matrix is column-major: index = col * 4 + row

  // Column 0 (array x axis): place sx at physicalRow for x
  affine[0 + mapping.x.physicalRow] = mapping.x.sign * sx

  // Column 1 (array y axis): place sy at physicalRow for y
  affine[4 + mapping.y.physicalRow] = mapping.y.sign * sy

  // Column 2 (array z axis): place sz at physicalRow for z
  affine[8 + mapping.z.physicalRow] = mapping.z.sign * sz

  // Translation: sign-flip for LPS→RAS but keep at original row
  // positions (x→row 0, y→row 1, z→row 2). See JSDoc for why.
  affine[12] = mapping.x.sign * tx
  affine[13] = mapping.y.sign * ty
  affine[14] = mapping.z.sign * tz

  return affine
}
