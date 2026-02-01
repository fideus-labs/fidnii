// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { PixelRegion, TypedArray, TypedArrayConstructor, ZarrDtype } from "./types.js";
import { getTypedArrayConstructor, getBytesPerPixel } from "./types.js";

/**
 * Manages a pre-allocated pixel buffer for volume data.
 *
 * The buffer is sized to:
 * 1. Fit within the maxPixels budget
 * 2. Maintain the aspect ratio of the source volume
 * 3. Have dimensions that are integer multiples of chunk size
 */
export class BufferManager {
  private readonly buffer: ArrayBuffer;
  private readonly dimensions: [number, number, number];
  private readonly TypedArrayCtor: TypedArrayConstructor;
  private readonly bytesPerPixel: number;
  private readonly dtype: ZarrDtype;

  constructor(
    maxPixels: number,
    aspectRatio: [number, number, number],
    chunkShape: [number, number, number],
    dtype: ZarrDtype
  ) {
    this.dtype = dtype;
    this.TypedArrayCtor = getTypedArrayConstructor(dtype);
    this.bytesPerPixel = getBytesPerPixel(dtype);

    // Calculate dimensions that fit maxPixels while maintaining aspect ratio
    // and aligning to chunk boundaries
    this.dimensions = this.calculateAlignedDimensions(
      maxPixels,
      aspectRatio,
      chunkShape
    );

    const totalPixels =
      this.dimensions[0] * this.dimensions[1] * this.dimensions[2];
    this.buffer = new ArrayBuffer(totalPixels * this.bytesPerPixel);
  }

  /**
   * Calculate buffer dimensions that:
   * 1. Maintain the aspect ratio
   * 2. Fit within maxPixels
   * 3. Are integer multiples of chunk shape
   */
  private calculateAlignedDimensions(
    maxPixels: number,
    aspectRatio: [number, number, number],
    chunkShape: [number, number, number]
  ): [number, number, number] {
    // Normalize aspect ratio so the smallest dimension is 1
    const minAspect = Math.min(...aspectRatio);
    const normalizedRatio: [number, number, number] = [
      aspectRatio[0] / minAspect,
      aspectRatio[1] / minAspect,
      aspectRatio[2] / minAspect,
    ];

    // Calculate the scale factor to fit within maxPixels
    // volume = scale^3 * (r0 * r1 * r2)
    const ratioProduct =
      normalizedRatio[0] * normalizedRatio[1] * normalizedRatio[2];
    const scale = Math.cbrt(maxPixels / ratioProduct);

    // Calculate raw dimensions
    const rawDims: [number, number, number] = [
      Math.floor(scale * normalizedRatio[0]),
      Math.floor(scale * normalizedRatio[1]),
      Math.floor(scale * normalizedRatio[2]),
    ];

    // Align each dimension to chunk boundaries (round down to nearest chunk)
    const alignedDims: [number, number, number] = [
      Math.max(chunkShape[0], Math.floor(rawDims[0] / chunkShape[0]) * chunkShape[0]),
      Math.max(chunkShape[1], Math.floor(rawDims[1] / chunkShape[1]) * chunkShape[1]),
      Math.max(chunkShape[2], Math.floor(rawDims[2] / chunkShape[2]) * chunkShape[2]),
    ];

    // Verify we're still within budget (should be, but double-check)
    let totalPixels = alignedDims[0] * alignedDims[1] * alignedDims[2];
    if (totalPixels > maxPixels) {
      // Reduce the largest dimension by one chunk
      const largestIdx = alignedDims.indexOf(Math.max(...alignedDims));
      alignedDims[largestIdx] -= chunkShape[largestIdx];
      totalPixels = alignedDims[0] * alignedDims[1] * alignedDims[2];
    }

    return alignedDims;
  }

  /**
   * Get the underlying ArrayBuffer.
   */
  getBuffer(): ArrayBuffer {
    return this.buffer;
  }

  /**
   * Get the buffer as a typed array.
   */
  getTypedArray(): TypedArray {
    return new this.TypedArrayCtor(this.buffer);
  }

  /**
   * Get the buffer dimensions [z, y, x].
   */
  getDimensions(): [number, number, number] {
    return [...this.dimensions];
  }

  /**
   * Get the total number of pixels in the buffer.
   */
  getPixelCount(): number {
    return this.dimensions[0] * this.dimensions[1] * this.dimensions[2];
  }

  /**
   * Get the bytes per pixel.
   */
  getBytesPerPixel(): number {
    return this.bytesPerPixel;
  }

  /**
   * Get the data type.
   */
  getDtype(): ZarrDtype {
    return this.dtype;
  }

  /**
   * Clear the buffer to zeros.
   */
  clear(): void {
    const view = new Uint8Array(this.buffer);
    view.fill(0);
  }

  /**
   * Fill a region of the buffer with source data, applying upsampling if needed.
   *
   * @param sourceData - Source pixel data
   * @param sourceShape - Shape of source data [z, y, x]
   * @param targetRegion - Region in the buffer to fill
   * @param upsampleFactor - Factor to upsample by (1 = no upsampling)
   */
  fillRegion(
    sourceData: TypedArray,
    sourceShape: [number, number, number],
    targetRegion: PixelRegion,
    upsampleFactor: number = 1
  ): void {
    const target = this.getTypedArray();
    const [_targetZ, _targetY, _targetX] = this.dimensions;

    if (upsampleFactor === 1) {
      // Direct copy without upsampling
      this.copyRegion(sourceData, sourceShape, target, targetRegion);
    } else {
      // Nearest-neighbor upsampling
      this.upsampleRegion(
        sourceData,
        sourceShape,
        target,
        targetRegion,
        upsampleFactor
      );
    }
  }

  /**
   * Copy source data directly to target region (no upsampling).
   */
  private copyRegion(
    source: TypedArray,
    sourceShape: [number, number, number],
    target: TypedArray,
    region: PixelRegion
  ): void {
    const [srcZ, srcY, srcX] = sourceShape;
    const [tgtZ, tgtY, tgtX] = this.dimensions;

    const zStart = region.start[0];
    const yStart = region.start[1];
    const xStart = region.start[2];

    for (let sz = 0; sz < srcZ; sz++) {
      const tz = zStart + sz;
      if (tz >= tgtZ) break;

      for (let sy = 0; sy < srcY; sy++) {
        const ty = yStart + sy;
        if (ty >= tgtY) break;

        // Copy entire row at once for efficiency
        const srcRowStart = sz * srcY * srcX + sy * srcX;
        const tgtRowStart = tz * tgtY * tgtX + ty * tgtX + xStart;
        const copyLength = Math.min(srcX, tgtX - xStart);

        for (let i = 0; i < copyLength; i++) {
          target[tgtRowStart + i] = source[srcRowStart + i];
        }
      }
    }
  }

  /**
   * Upsample source data into target region using nearest-neighbor interpolation.
   */
  private upsampleRegion(
    source: TypedArray,
    sourceShape: [number, number, number],
    target: TypedArray,
    region: PixelRegion,
    factor: number
  ): void {
    const [srcZ, srcY, srcX] = sourceShape;
    const [tgtZ, tgtY, tgtX] = this.dimensions;

    const zStart = region.start[0];
    const yStart = region.start[1];
    const xStart = region.start[2];

    const zEnd = Math.min(region.end[0], tgtZ);
    const yEnd = Math.min(region.end[1], tgtY);
    const xEnd = Math.min(region.end[2], tgtX);

    for (let tz = zStart; tz < zEnd; tz++) {
      const sz = Math.floor((tz - zStart) / factor);
      if (sz >= srcZ) continue;

      for (let ty = yStart; ty < yEnd; ty++) {
        const sy = Math.floor((ty - yStart) / factor);
        if (sy >= srcY) continue;

        for (let tx = xStart; tx < xEnd; tx++) {
          const sx = Math.floor((tx - xStart) / factor);
          if (sx >= srcX) continue;

          const srcIdx = sz * srcY * srcX + sy * srcX + sx;
          const tgtIdx = tz * tgtY * tgtX + ty * tgtX + tx;

          target[tgtIdx] = source[srcIdx];
        }
      }
    }
  }

  /**
   * Fill the entire buffer with data from a source, upsampling as needed
   * to fill the buffer completely.
   */
  fillEntireBuffer(sourceData: TypedArray, sourceShape: [number, number, number]): void {
    // Calculate upsample factor for each dimension
    const factors: [number, number, number] = [
      this.dimensions[0] / sourceShape[0],
      this.dimensions[1] / sourceShape[1],
      this.dimensions[2] / sourceShape[2],
    ];

    // Use the minimum factor to ensure we fill the buffer
    // (assumes isotropic scaling for simplicity)
    const factor = Math.min(...factors);

    this.fillRegion(
      sourceData,
      sourceShape,
      {
        start: [0, 0, 0],
        end: this.dimensions,
      },
      factor
    );
  }
}
