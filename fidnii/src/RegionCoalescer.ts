// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import PQueue from "p-queue";
import * as zarr from "zarrita";
import type { NgffImage } from "@fideus-labs/ngff-zarr";
import type { PixelRegion, RegionFetchResult, TypedArray } from "./types.js";

/**
 * Represents a pending request that may have multiple consumers waiting for the result.
 */
interface PendingRequest {
  /** The promise that resolves when the request completes */
  promise: Promise<RegionFetchResult>;
  /** Function to resolve the promise with the result */
  resolve: (data: RegionFetchResult) => void;
  /** Function to reject the promise with an error */
  reject: (error: Error) => void;
  /** Set of requester IDs waiting for this result */
  requesters: Set<string>;
}

/**
 * RegionCoalescer handles fetching sub-regions from OME-Zarr images with:
 *
 * 1. Request deduplication - Multiple async triggers (zoom, crop changes, etc.)
 *    requesting the same region receive the same promise
 * 2. Parallel fetching - Uses p-queue for concurrency-controlled chunk fetches
 * 3. Requester tracking - Tracks who is waiting for each request
 *
 * This design supports future scenarios where multiple UI events may trigger
 * overlapping region requests simultaneously.
 */
export class RegionCoalescer {
  private readonly queue: PQueue;
  private readonly pending: Map<string, PendingRequest> = new Map();

  constructor() {
    const concurrency = Math.min(navigator?.hardwareConcurrency || 4, 128);
    this.queue = new PQueue({ concurrency });
  }

  /**
   * Generate a unique key for a request based on image path, level index, and region.
   */
  private makeKey(
    imagePath: string,
    levelIndex: number,
    region: PixelRegion
  ): string {
    const start = region.start.join(",");
    const end = region.end.join(",");
    return `${imagePath}:${levelIndex}:${start}:${end}`;
  }

  /**
   * Request a region, coalescing with any in-flight request for the same data.
   *
   * @param ngffImage - The NgffImage to fetch from
   * @param levelIndex - The resolution level index
   * @param region - The pixel region to fetch
   * @param requesterId - ID of the requester (e.g., 'zoom', 'crop-change', 'progressive-load')
   * @returns The fetched region data
   */
  async fetchRegion(
    ngffImage: NgffImage,
    levelIndex: number,
    region: PixelRegion,
    requesterId: string = "default"
  ): Promise<RegionFetchResult> {
    const key = this.makeKey(ngffImage.data.path, levelIndex, region);

    // Check if there's already a pending request for this data
    const existing = this.pending.get(key);
    if (existing) {
      // Add this requester to the waiters and return the existing promise
      existing.requesters.add(requesterId);
      return existing.promise;
    }

    // Create a new pending request
    let resolvePromise!: (data: RegionFetchResult) => void;
    let rejectPromise!: (error: Error) => void;

    const promise = new Promise<RegionFetchResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const pendingRequest: PendingRequest = {
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      requesters: new Set([requesterId]),
    };

    this.pending.set(key, pendingRequest);

    // Queue the actual fetch
    try {
      const result = await this.queue.add(async () => {
        const selection = [
          zarr.slice(region.start[0], region.end[0]),
          zarr.slice(region.start[1], region.end[1]),
          zarr.slice(region.start[2], region.end[2]),
        ];
        return zarr.get(ngffImage.data, selection);
      });

      if (!result) {
        throw new Error("Failed to fetch region: no result returned");
      }

      const fetchResult: RegionFetchResult = {
        data: result.data as TypedArray,
        shape: result.shape,
        stride: result.stride,
      };

      pendingRequest.resolve(fetchResult);
      return fetchResult;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      pendingRequest.reject(err);
      throw err;
    } finally {
      this.pending.delete(key);
    }
  }

  /**
   * Fetch multiple regions in parallel, with deduplication.
   * Useful for fetching multiple chunks for a single view update.
   *
   * @param ngffImage - The NgffImage to fetch from
   * @param levelIndex - The resolution level index
   * @param regions - Array of pixel regions to fetch
   * @param requesterId - ID of the requester
   * @returns Array of fetched region data
   */
  async fetchRegions(
    ngffImage: NgffImage,
    levelIndex: number,
    regions: PixelRegion[],
    requesterId: string = "default"
  ): Promise<RegionFetchResult[]> {
    return Promise.all(
      regions.map((region) =>
        this.fetchRegion(ngffImage, levelIndex, region, requesterId)
      )
    );
  }

  /**
   * Check if there's a pending request for the given parameters.
   */
  hasPending(
    ngffImage: NgffImage,
    levelIndex: number,
    region: PixelRegion
  ): boolean {
    const key = this.makeKey(ngffImage.data.path, levelIndex, region);
    return this.pending.has(key);
  }

  /**
   * Get the set of requesters waiting for a pending request.
   * Returns undefined if no pending request exists.
   */
  getPendingRequesters(
    ngffImage: NgffImage,
    levelIndex: number,
    region: PixelRegion
  ): Set<string> | undefined {
    const key = this.makeKey(ngffImage.data.path, levelIndex, region);
    return this.pending.get(key)?.requesters;
  }

  /**
   * Wait for all pending fetches to complete.
   */
  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }

  /**
   * Get the number of pending requests (unique region requests).
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Get the number of items waiting in the fetch queue.
   */
  get queueSize(): number {
    return this.queue.size;
  }

  /**
   * Get the number of items currently being processed.
   */
  get queuePending(): number {
    return this.queue.pending;
  }

  /**
   * Clear all pending requests and the queue.
   * Note: Does not resolve or reject pending promises.
   */
  clear(): void {
    this.pending.clear();
    this.queue.clear();
  }
}
