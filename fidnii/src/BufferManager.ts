// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { TypedArray, TypedArrayConstructor, ZarrDtype } from "./types.js"
import { getBytesPerPixel, getTypedArrayConstructor } from "./types.js"

/**
 * Manages a dynamically-sized pixel buffer for volume data.
 *
 * The buffer is resized to match the fetched data dimensions exactly.
 * Memory is reused when possible to avoid unnecessary allocations.
 *
 * For multi-component images (RGB/RGBA), `componentsPerVoxel` controls
 * how many scalar elements each spatial voxel occupies. The buffer is
 * sized to hold `spatialPixels * componentsPerVoxel` elements, and the
 * typed array view spans all of them. Spatial dimensions (`[z, y, x]`)
 * track only the spatial extent; the component count is a fixed
 * multiplier on the element count.
 *
 * Memory reuse strategy:
 * - Reuse buffer if newSize <= currentCapacity
 * - Reallocate if newSize > currentCapacity OR newSize < 25% of currentCapacity
 */
export class BufferManager {
  private buffer: ArrayBuffer
  private currentDimensions: [number, number, number]
  private readonly maxPixels: number
  private readonly TypedArrayCtor: TypedArrayConstructor
  private readonly bytesPerPixel: number
  private readonly dtype: ZarrDtype

  /**
   * Number of scalar components per spatial voxel.
   * 1 for scalar images, 3 for RGB, 4 for RGBA.
   */
  readonly componentsPerVoxel: number

  /**
   * Create a new BufferManager.
   *
   * @param maxPixels - Maximum number of pixels allowed (budget)
   * @param dtype - Data type for the buffer
   * @param componentsPerVoxel - Number of components per spatial voxel
   *   (default: 1; pass 3 for RGB, 4 for RGBA)
   */
  constructor(
    maxPixels: number,
    dtype: ZarrDtype,
    componentsPerVoxel: number = 1,
  ) {
    this.maxPixels = maxPixels
    this.dtype = dtype
    this.TypedArrayCtor = getTypedArrayConstructor(dtype)
    this.bytesPerPixel = getBytesPerPixel(dtype)
    this.componentsPerVoxel = componentsPerVoxel

    // Initialize with empty buffer - will be allocated on first resize
    this.currentDimensions = [0, 0, 0]
    this.buffer = new ArrayBuffer(0)
  }

  /**
   * Resize the buffer to fit the given dimensions.
   *
   * Reuses existing buffer if large enough, otherwise allocates new buffer.
   * Will also reallocate if the buffer is significantly oversized (< 25% utilization).
   *
   * If dimensions exceed maxPixels, a warning is logged but the buffer is still
   * allocated. This handles the case where even the lowest resolution exceeds the
   * pixel budget - we still want to load something rather than failing.
   *
   * @param dimensions - New dimensions [z, y, x]
   * @returns TypedArray view over the (possibly new) buffer
   */
  resize(dimensions: [number, number, number]): TypedArray {
    const spatialPixels = dimensions[0] * dimensions[1] * dimensions[2]

    if (spatialPixels > this.maxPixels) {
      console.warn(
        `[fidnii] BufferManager: Requested dimensions [${dimensions.join(
          ", ",
        )}] = ${spatialPixels} pixels exceeds maxPixels (${this.maxPixels}). ` +
          `Proceeding anyway (likely at lowest resolution).`,
      )
    }

    // Total elements = spatial pixels × components per voxel
    const requiredElements = spatialPixels * this.componentsPerVoxel
    const currentCapacityElements = this.buffer.byteLength / this.bytesPerPixel
    const utilizationRatio =
      currentCapacityElements > 0
        ? requiredElements / currentCapacityElements
        : 0

    const needsReallocation =
      requiredElements > currentCapacityElements || utilizationRatio < 0.25

    if (needsReallocation) {
      const newByteLength = requiredElements * this.bytesPerPixel
      this.buffer = new ArrayBuffer(newByteLength)
    }

    this.currentDimensions = [...dimensions]
    return this.getTypedArray()
  }

  /**
   * Get the underlying ArrayBuffer.
   */
  getBuffer(): ArrayBuffer {
    return this.buffer
  }

  /**
   * Get a typed array view over the current buffer region.
   *
   * The view is sized to match `spatialPixels × componentsPerVoxel`,
   * not the full buffer capacity.
   */
  getTypedArray(): TypedArray {
    const spatialPixels =
      this.currentDimensions[0] *
      this.currentDimensions[1] *
      this.currentDimensions[2]
    return new this.TypedArrayCtor(
      this.buffer,
      0,
      spatialPixels * this.componentsPerVoxel,
    )
  }

  /**
   * Get the current buffer dimensions [z, y, x].
   */
  getDimensions(): [number, number, number] {
    return [...this.currentDimensions]
  }

  /**
   * Get the total number of spatial pixels in the current buffer region.
   * This does NOT include the component multiplier.
   */
  getPixelCount(): number {
    return (
      this.currentDimensions[0] *
      this.currentDimensions[1] *
      this.currentDimensions[2]
    )
  }

  /**
   * Get the total number of scalar elements in the current buffer region.
   * For multi-component images, this is `spatialPixels × componentsPerVoxel`.
   */
  getElementCount(): number {
    return this.getPixelCount() * this.componentsPerVoxel
  }

  /**
   * Get the buffer capacity in scalar elements.
   */
  getCapacity(): number {
    return this.buffer.byteLength / this.bytesPerPixel
  }

  /**
   * Get the bytes per pixel.
   */
  getBytesPerPixel(): number {
    return this.bytesPerPixel
  }

  /**
   * Get the data type.
   */
  getDtype(): ZarrDtype {
    return this.dtype
  }

  /**
   * Get the maximum pixels budget.
   */
  getMaxPixels(): number {
    return this.maxPixels
  }

  /**
   * Clear the current buffer region to zeros.
   */
  clear(): void {
    const elementCount = this.getElementCount()
    if (elementCount > 0) {
      const view = new Uint8Array(
        this.buffer,
        0,
        elementCount * this.bytesPerPixel,
      )
      view.fill(0)
    }
  }

  /**
   * Check if the buffer can accommodate the given dimensions without reallocation.
   *
   * @param dimensions - Dimensions to check [z, y, x]
   * @returns True if current buffer can fit the dimensions
   */
  canAccommodate(dimensions: [number, number, number]): boolean {
    const requiredElements =
      dimensions[0] * dimensions[1] * dimensions[2] * this.componentsPerVoxel
    const currentCapacityElements = this.buffer.byteLength / this.bytesPerPixel
    return requiredElements <= currentCapacityElements
  }
}
