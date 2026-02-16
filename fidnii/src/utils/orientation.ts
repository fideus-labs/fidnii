// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { AnatomicalOrientation } from "@fideus-labs/ngff-zarr"
import type { mat4 } from "gl-matrix"

/**
 * Sign multipliers for each spatial axis, used to encode anatomical
 * orientation into the NIfTI affine matrix.
 *
 * A value of `1` means the axis increases in the RAS+ direction
 * (Right, Anterior, Superior). A value of `-1` means it increases
 * in the opposite direction (Left, Posterior, Inferior).
 */
export interface OrientationSigns {
  readonly x: 1 | -1
  readonly y: 1 | -1
  readonly z: 1 | -1
}

/**
 * Map of RFC-4 anatomical orientation values that are opposite to
 * the NIfTI RAS+ convention. For each axis, if the orientation
 * matches the value here, the affine diagonal entry must be negated.
 *
 * RAS+ expects:
 * - x: left-to-right (R)
 * - y: posterior-to-anterior (A)
 * - z: inferior-to-superior (S)
 *
 * These are the "negative" (anti-RAS+) orientations:
 * - x: right-to-left (L)
 * - y: anterior-to-posterior (P)
 * - z: superior-to-inferior (I)
 */
const NEGATIVE_ORIENTATIONS: Record<string, string> = {
  x: "right-to-left",
  y: "anterior-to-posterior",
  z: "superior-to-inferior",
}

/**
 * Set of RFC-4 anatomical orientation values that are recognized for
 * RAS sign determination. Orientations outside this set (e.g.
 * dorsal-to-ventral, rostral-to-caudal) are treated as unknown and
 * default to the positive (+1) sign.
 */
const KNOWN_ORIENTATIONS = new Set<string>([
  // L/R pair
  "left-to-right",
  "right-to-left",
  // A/P pair
  "anterior-to-posterior",
  "posterior-to-anterior",
  // I/S pair
  "inferior-to-superior",
  "superior-to-inferior",
])

/**
 * Determine the sign multiplier for a single axis based on its
 * anatomical orientation relative to the NIfTI RAS+ convention.
 *
 * @param axis - Axis name ("x", "y", or "z")
 * @param orientation - The anatomical orientation for this axis
 * @returns `1` if the axis is RAS+ aligned (or unknown), `-1` if opposite
 */
function signForAxis(axis: string, orientation: AnatomicalOrientation): 1 | -1 {
  const value = orientation.value
  if (!KNOWN_ORIENTATIONS.has(value)) {
    return 1
  }
  return value === NEGATIVE_ORIENTATIONS[axis] ? -1 : 1
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
  if (!axesOrientations) {
    return { x: 1, y: 1, z: 1 }
  }

  const xOrientation = axesOrientations.x ?? axesOrientations.X
  const yOrientation = axesOrientations.y ?? axesOrientations.Y
  const zOrientation = axesOrientations.z ?? axesOrientations.Z

  return {
    x: xOrientation ? signForAxis("x", xOrientation) : 1,
    y: yOrientation ? signForAxis("y", yOrientation) : 1,
    z: zOrientation ? signForAxis("z", zOrientation) : 1,
  }
}

/**
 * Apply anatomical orientation sign flips to an affine matrix in place.
 *
 * For each axis whose orientation is opposite to NIfTI RAS+, negates
 * the corresponding column vector in the affine. This encodes the
 * orientation direction into the matrix so that NiiVue's
 * `calculateRAS()` correctly interprets the anatomical layout.
 *
 * The affine is expected to be in gl-matrix column-major format:
 * - Column 0 (indices 0-3): x direction
 * - Column 1 (indices 4-7): y direction
 * - Column 2 (indices 8-11): z direction
 * - Column 3 (indices 12-15): translation
 *
 * When a column is negated, the corresponding translation component is
 * also negated to maintain the correct world-space origin.
 *
 * @param affine - 4x4 affine matrix (column-major, modified in place)
 * @param axesOrientations - Orientation metadata from `NgffImage.axesOrientations`
 * @returns The same affine matrix (for chaining)
 */
export function applyOrientationToAffine(
  affine: mat4,
  axesOrientations: Record<string, AnatomicalOrientation> | undefined,
): mat4 {
  const signs = getOrientationSigns(axesOrientations)

  if (signs.x === -1) {
    // Negate column 0 (x direction) and x translation
    affine[0] = -affine[0]
    affine[1] = -affine[1]
    affine[2] = -affine[2]
    affine[12] = -affine[12]
  }

  if (signs.y === -1) {
    // Negate column 1 (y direction) and y translation
    affine[4] = -affine[4]
    affine[5] = -affine[5]
    affine[6] = -affine[6]
    affine[13] = -affine[13]
  }

  if (signs.z === -1) {
    // Negate column 2 (z direction) and z translation
    affine[8] = -affine[8]
    affine[9] = -affine[9]
    affine[10] = -affine[10]
    affine[14] = -affine[14]
  }

  return affine
}
