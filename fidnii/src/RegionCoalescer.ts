// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import * as zarr from "zarrita";
import type { NgffImage } from "@fideus-labs/ngff-zarr";
import { zarrGet } from "@fideus-labs/ngff-zarr/browser";
import type {
  ChunkCache,
  PixelRegion,
  RegionFetchResult,
  TypedArray,
} from "./types.js";

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
 * 2. Parallel fetching - Uses fizarrita's worker-pool-accelerated zarrGet
 *    for concurrent, worker-offloaded chunk fetches
 * 3. Requester tracking - Tracks who is waiting for each request
 * 4. Chunk caching - Optional decoded-chunk cache to avoid redundant
 *    decompression on repeated or overlapping reads
 *
 * This design supports future scenarios where multiple UI events may trigger
 * overlapping region requests simultaneously.
 */
export class RegionCoalescer {
  private readonly pending: Map<string, PendingRequest> = new Map();

  /** Optional decoded-chunk cache forwarded to fizarrita's getWorker. */
  private readonly _cache: ChunkCache | undefined;

  /**
   * @param cache - Optional decoded-chunk cache. When provided, `zarrGet`
   *   caches decoded chunks to avoid redundant decompression on repeated
   *   or overlapping reads.
   */
  constructor(cache?: ChunkCache) {
    this._cache = cache;
  }

  /**
   * Generate a unique key for a request based on image path, level index, and region.
   */
  private makeKey(
    imagePath: string,
    levelIndex: number,
    region: PixelRegion,
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
    requesterId: string = "default",
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

    // Fetch using fizarrita's worker-accelerated zarrGet
    try {
      const selection = [
        zarr.slice(region.start[0], region.end[0]),
        zarr.slice(region.start[1], region.end[1]),
        zarr.slice(region.start[2], region.end[2]),
      ];
      // Pass the chunk cache to fizarrita's getWorker via zarrGet.
      // The `cache` option is available in @fideus-labs/fizarrita >=1.2.0.
      const zarrOpts = this._cache
        ? { cache: this._cache } as Record<string, unknown>
        : undefined;
      const result = await zarrGet(ngffImage.data, selection, zarrOpts);

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
    requesterId: string = "default",
  ): Promise<RegionFetchResult[]> {
    return Promise.all(
      regions.map((region) =>
        this.fetchRegion(ngffImage, levelIndex, region, requesterId)
      ),
    );
  }

  /**
   * Check if there's a pending request for the given parameters.
   */
  hasPending(
    ngffImage: NgffImage,
    levelIndex: number,
    region: PixelRegion,
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
    region: PixelRegion,
  ): Set<string> | undefined {
    const key = this.makeKey(ngffImage.data.path, levelIndex, region);
    return this.pending.get(key)?.requesters;
  }

  /**
   * Wait for all pending fetches to complete.
   */
  async onIdle(): Promise<void> {
    // Wait for all in-flight requests to settle
    const promises = Array.from(this.pending.values()).map((p) =>
      p.promise.catch(() => {})
    );
    await Promise.all(promises);
  }

  /**
   * Get the number of pending requests (unique region requests).
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Clear all pending requests.
   * Note: Does not resolve or reject pending promises.
   */
  clear(): void {
    this.pending.clear();
  }
}
