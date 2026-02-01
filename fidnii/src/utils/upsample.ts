// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { TypedArray } from "../types.js";

/**
 * Upsample 3D volume data using nearest-neighbor interpolation.
 *
 * This is used when progressively loading from lower resolutions
 * to fill the buffer before higher resolution data arrives.
 *
 * @param source - Source data array
 * @param sourceShape - Shape of source [z, y, x]
 * @param targetShape - Shape of target [z, y, x]
 * @param target - Optional target array (created if not provided)
 * @returns Upsampled data array
 */
export function upsampleNearestNeighbor<T extends TypedArray>(
  source: T,
  sourceShape: [number, number, number],
  targetShape: [number, number, number],
  target?: T
): T {
  const [srcZ, srcY, srcX] = sourceShape;
  const [tgtZ, tgtY, tgtX] = targetShape;

  // Create target array if not provided
  const result =
    target ??
    (new (source.constructor as { new (length: number): T })(
      tgtZ * tgtY * tgtX
    ) as T);

  // Calculate scale factors
  const scaleZ = srcZ / tgtZ;
  const scaleY = srcY / tgtY;
  const scaleX = srcX / tgtX;

  // Perform nearest-neighbor upsampling
  for (let tz = 0; tz < tgtZ; tz++) {
    const sz = Math.min(Math.floor(tz * scaleZ), srcZ - 1);

    for (let ty = 0; ty < tgtY; ty++) {
      const sy = Math.min(Math.floor(ty * scaleY), srcY - 1);

      for (let tx = 0; tx < tgtX; tx++) {
        const sx = Math.min(Math.floor(tx * scaleX), srcX - 1);

        const srcIdx = sz * srcY * srcX + sy * srcX + sx;
        const tgtIdx = tz * tgtY * tgtX + ty * tgtX + tx;

        result[tgtIdx] = source[srcIdx];
      }
    }
  }

  return result;
}

/**
 * Upsample 3D volume data using trilinear interpolation.
 *
 * Produces smoother results than nearest-neighbor but is more computationally expensive.
 * Best for float data types.
 *
 * @param source - Source data array
 * @param sourceShape - Shape of source [z, y, x]
 * @param targetShape - Shape of target [z, y, x]
 * @param target - Optional target array (created if not provided)
 * @returns Upsampled data array
 */
export function upsampleTrilinear(
  source: Float32Array | Float64Array,
  sourceShape: [number, number, number],
  targetShape: [number, number, number],
  target?: Float32Array | Float64Array
): Float32Array | Float64Array {
  const [srcZ, srcY, srcX] = sourceShape;
  const [tgtZ, tgtY, tgtX] = targetShape;

  // Create target array if not provided
  const result =
    target ??
    new (source.constructor as { new (length: number): Float32Array })(
      tgtZ * tgtY * tgtX
    );

  // Calculate scale factors (mapping from target to source coordinates)
  const scaleZ = (srcZ - 1) / (tgtZ - 1 || 1);
  const scaleY = (srcY - 1) / (tgtY - 1 || 1);
  const scaleX = (srcX - 1) / (tgtX - 1 || 1);

  for (let tz = 0; tz < tgtZ; tz++) {
    const srcZf = tz * scaleZ;
    const sz0 = Math.floor(srcZf);
    const sz1 = Math.min(sz0 + 1, srcZ - 1);
    const zFrac = srcZf - sz0;

    for (let ty = 0; ty < tgtY; ty++) {
      const srcYf = ty * scaleY;
      const sy0 = Math.floor(srcYf);
      const sy1 = Math.min(sy0 + 1, srcY - 1);
      const yFrac = srcYf - sy0;

      for (let tx = 0; tx < tgtX; tx++) {
        const srcXf = tx * scaleX;
        const sx0 = Math.floor(srcXf);
        const sx1 = Math.min(sx0 + 1, srcX - 1);
        const xFrac = srcXf - sx0;

        // Get 8 corner values
        const c000 = source[sz0 * srcY * srcX + sy0 * srcX + sx0];
        const c001 = source[sz0 * srcY * srcX + sy0 * srcX + sx1];
        const c010 = source[sz0 * srcY * srcX + sy1 * srcX + sx0];
        const c011 = source[sz0 * srcY * srcX + sy1 * srcX + sx1];
        const c100 = source[sz1 * srcY * srcX + sy0 * srcX + sx0];
        const c101 = source[sz1 * srcY * srcX + sy0 * srcX + sx1];
        const c110 = source[sz1 * srcY * srcX + sy1 * srcX + sx0];
        const c111 = source[sz1 * srcY * srcX + sy1 * srcX + sx1];

        // Trilinear interpolation
        const c00 = c000 * (1 - xFrac) + c001 * xFrac;
        const c01 = c010 * (1 - xFrac) + c011 * xFrac;
        const c10 = c100 * (1 - xFrac) + c101 * xFrac;
        const c11 = c110 * (1 - xFrac) + c111 * xFrac;

        const c0 = c00 * (1 - yFrac) + c01 * yFrac;
        const c1 = c10 * (1 - yFrac) + c11 * yFrac;

        const value = c0 * (1 - zFrac) + c1 * zFrac;

        result[tz * tgtY * tgtX + ty * tgtX + tx] = value;
      }
    }
  }

  return result;
}

/**
 * Calculate the upsample factor between two shapes.
 *
 * @param sourceShape - Source shape [z, y, x]
 * @param targetShape - Target shape [z, y, x]
 * @returns Upsample factors [z, y, x]
 */
export function calculateUpsampleFactors(
  sourceShape: [number, number, number],
  targetShape: [number, number, number]
): [number, number, number] {
  return [
    targetShape[0] / sourceShape[0],
    targetShape[1] / sourceShape[1],
    targetShape[2] / sourceShape[2],
  ];
}

/**
 * Check if upsampling is needed between two shapes.
 *
 * @param sourceShape - Source shape [z, y, x]
 * @param targetShape - Target shape [z, y, x]
 * @returns True if any dimension needs upsampling
 */
export function needsUpsampling(
  sourceShape: [number, number, number],
  targetShape: [number, number, number]
): boolean {
  return (
    targetShape[0] > sourceShape[0] ||
    targetShape[1] > sourceShape[1] ||
    targetShape[2] > sourceShape[2]
  );
}

/**
 * Get the integer upsample factor (for nearest-neighbor).
 * Returns the minimum factor across all dimensions rounded down.
 *
 * @param sourceShape - Source shape [z, y, x]
 * @param targetShape - Target shape [z, y, x]
 * @returns Integer upsample factor
 */
export function getIntegerUpsampleFactor(
  sourceShape: [number, number, number],
  targetShape: [number, number, number]
): number {
  const factors = calculateUpsampleFactors(sourceShape, targetShape);
  return Math.floor(Math.min(...factors));
}
