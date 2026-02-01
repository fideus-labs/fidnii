// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { NIFTI1 } from "nifti-reader-js";
import { NVImage } from "@niivue/niivue";
import type { Niivue } from "@niivue/niivue";
import type { Multiscales, NgffImage } from "@fideus-labs/ngff-zarr";

import type {
  CroppingPlanes,
  OMEZarrNVImageOptions,
  ZarrDtype,
  PixelRegion,
} from "./types.js";
import {
  parseZarritaDtype,
  getNiftiDataType,
  getBytesPerPixel,
} from "./types.js";
import { BufferManager } from "./BufferManager.js";
import { RegionCoalescer } from "./RegionCoalescer.js";
import {
  selectResolution,
  getAspectRatio,
  getChunkShape,
  getVolumeShape,
} from "./ResolutionSelector.js";
import {
  createDefaultCroppingPlanes,
  worldToPixelRegion,
  alignToChunks,
  croppingPlanesToNiivueClipPlanes,
} from "./CroppingPlanes.js";
import {
  createAffineFromNgffImage,
  calculateWorldBounds,
  affineToNiftiSrows,
  getPixelDimensions,
} from "./utils/affine.js";
import { upsampleNearestNeighbor } from "./utils/upsample.js";

const DEFAULT_MAX_PIXELS = 50_000_000;

/**
 * OMEZarrNVImage extends NVImage to support rendering OME-Zarr images in NiiVue.
 *
 * Features:
 * - Progressive multi-resolution loading from lowest to target resolution
 * - Six axis-aligned cropping planes in world space
 * - Pre-allocated pixel buffer for efficient memory usage
 * - Request coalescing for efficient chunk fetching
 * - Automatic metadata updates to reflect OME-Zarr coordinate transforms
 */
export class OMEZarrNVImage extends NVImage {
  /** The OME-Zarr multiscales data */
  readonly multiscales: Multiscales;

  /** Maximum number of pixels to use */
  readonly maxPixels: number;

  /** Reference to NiiVue instance */
  private readonly niivue: Niivue;

  /** Buffer manager for pre-allocated pixel data */
  private readonly bufferManager: BufferManager;

  /** Region coalescer for efficient chunk fetching */
  private readonly coalescer: RegionCoalescer;

  /** Current cropping planes in world space */
  private _croppingPlanes: CroppingPlanes;

  /** Target resolution level index (based on maxPixels) */
  private targetLevelIndex: number;

  /** Current resolution level index during progressive loading */
  private currentLevelIndex: number;

  /** True if currently loading data */
  private isLoading: boolean = false;

  /** Data type of the volume */
  private readonly dtype: ZarrDtype;

  /** Full volume bounds in world space */
  private readonly volumeBounds: {
    min: [number, number, number];
    max: [number, number, number];
  };

  /** Previous clip plane change handler (to restore later) */
  private previousOnClipPlaneChange?: (clipPlane: number[]) => void;

  /**
   * Private constructor. Use OMEZarrNVImage.create() for instantiation.
   */
  private constructor(options: OMEZarrNVImageOptions) {
    // Call NVImage constructor with no data buffer
    super();

    this.multiscales = options.multiscales;
    this.maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
    this.niivue = options.niivue;
    this.coalescer = new RegionCoalescer();

    // Initialize cropping planes to full volume extent
    this._croppingPlanes = createDefaultCroppingPlanes(this.multiscales);

    // Get data type from highest resolution image
    const highResImage = this.multiscales.images[0];
    this.dtype = parseZarritaDtype(highResImage.data.dtype);

    // Calculate target resolution based on pixel budget
    const selection = selectResolution(
      this.multiscales,
      this.maxPixels,
      this._croppingPlanes
    );
    this.targetLevelIndex = selection.levelIndex;
    this.currentLevelIndex = this.multiscales.images.length - 1;

    // Get aspect ratio from middle resolution
    const middleIndex = Math.floor(this.multiscales.images.length / 2);
    const middleImage = this.multiscales.images[middleIndex];
    const aspectRatio = getAspectRatio(middleImage);
    const chunkShape = getChunkShape(middleImage);

    // Create buffer manager
    this.bufferManager = new BufferManager(
      this.maxPixels,
      aspectRatio,
      chunkShape,
      this.dtype
    );

    // Calculate volume bounds
    const targetImage = this.multiscales.images[this.targetLevelIndex];
    const affine = createAffineFromNgffImage(targetImage);
    const targetShape = getVolumeShape(targetImage);
    this.volumeBounds = calculateWorldBounds(affine, targetShape);

    // Initialize NVImage properties
    this.initializeNVImageProperties();
  }

  /**
   * Create a new OMEZarrNVImage instance.
   *
   * @param options - Options including multiscales, niivue reference, and optional maxPixels
   * @returns Promise resolving to the OMEZarrNVImage instance
   */
  static async create(options: OMEZarrNVImageOptions): Promise<OMEZarrNVImage> {
    const image = new OMEZarrNVImage(options);

    // Store and replace the clip plane change handler
    image.previousOnClipPlaneChange = image.niivue.onClipPlaneChange;
    image.niivue.onClipPlaneChange = (clipPlane: number[]) => {
      // Call original handler if it exists
      if (image.previousOnClipPlaneChange) {
        image.previousOnClipPlaneChange(clipPlane);
      }
      // Handle clip plane change for cropping
      image.onClipPlaneChange(clipPlane);
    };

    return image;
  }

  /**
   * Initialize NVImage properties from OME-Zarr metadata.
   */
  private initializeNVImageProperties(): void {
    const bufferDims = this.bufferManager.getDimensions();
    const targetImage = this.multiscales.images[this.targetLevelIndex];

    // Create NIfTI header
    const hdr = new NIFTI1();
    this.hdr = hdr;

    // Set dimensions [ndim, x, y, z, t, ...]
    // NIfTI uses [x, y, z] order, OME-Zarr uses [z, y, x]
    hdr.dims = [3, bufferDims[2], bufferDims[1], bufferDims[0], 1, 1, 1, 1];

    // Set data type
    hdr.datatypeCode = getNiftiDataType(this.dtype);
    hdr.numBitsPerVoxel = getBytesPerPixel(this.dtype) * 8;

    // Set pixel dimensions from OME-Zarr scale
    const scale = targetImage.scale;
    const sx = scale.x ?? scale.X ?? 1;
    const sy = scale.y ?? scale.Y ?? 1;
    const sz = scale.z ?? scale.Z ?? 1;
    hdr.pixDims = [1, sx, sy, sz, 0, 0, 0, 0];

    // Set affine from OME-Zarr coordinate transforms
    const affine = createAffineFromNgffImage(targetImage);
    const srows = affineToNiftiSrows(affine);

    hdr.affine = [
      srows.srow_x,
      srows.srow_y,
      srows.srow_z,
      [0, 0, 0, 1],
    ];

    hdr.sform_code = 1; // Scanner coordinates

    // Set name
    this.name = this.multiscales.metadata?.name ?? "OME-Zarr";

    // Initialize the image buffer
    // Cast to any because NiiVue's TypedVoxelArray is a subset of our TypedArray
    this.img = this.bufferManager.getTypedArray() as any;

    // Calculate RAS orientation
    this.calculateRAS();

    // Set default colormap
    this._colormap = "gray";
    this._opacity = 1.0;
  }

  /**
   * Progressively populate the volume from lowest to target resolution.
   *
   * This method:
   * 1. Fetches data starting from the lowest resolution
   * 2. Upsamples and fills the buffer
   * 3. Updates NiiVue at each step for progressive refinement
   * 4. Continues until target resolution is reached
   */
  async populateVolume(): Promise<void> {
    if (this.isLoading) {
      return;
    }
    this.isLoading = true;

    try {
      const numLevels = this.multiscales.images.length;

      // Progressive loading from lowest to target resolution
      for (
        let level = numLevels - 1;
        level >= this.targetLevelIndex;
        level--
      ) {
        await this.loadResolutionLevel(level, "progressive-load");
        this.currentLevelIndex = level;
      }
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Load data at a specific resolution level.
   *
   * @param levelIndex - Resolution level index
   * @param requesterId - ID for request coalescing
   */
  private async loadResolutionLevel(
    levelIndex: number,
    requesterId: string
  ): Promise<void> {
    const ngffImage = this.multiscales.images[levelIndex];
    const bufferDims = this.bufferManager.getDimensions();

    // Get the pixel region for current cropping planes
    const pixelRegion = worldToPixelRegion(this._croppingPlanes, ngffImage);
    const alignedRegion = alignToChunks(pixelRegion, ngffImage);

    // Fetch the data
    const fetchRegion: PixelRegion = {
      start: alignedRegion.chunkAlignedStart,
      end: alignedRegion.chunkAlignedEnd,
    };

    const result = await this.coalescer.fetchRegion(
      ngffImage,
      levelIndex,
      fetchRegion,
      requesterId
    );

    // Calculate the shape of fetched data
    const fetchedShape: [number, number, number] = [
      fetchRegion.end[0] - fetchRegion.start[0],
      fetchRegion.end[1] - fetchRegion.start[1],
      fetchRegion.end[2] - fetchRegion.start[2],
    ];

    // Upsample if needed to fill buffer
    const targetData = this.bufferManager.getTypedArray();

    if (
      fetchedShape[0] === bufferDims[0] &&
      fetchedShape[1] === bufferDims[1] &&
      fetchedShape[2] === bufferDims[2]
    ) {
      // Direct copy if shapes match
      targetData.set(result.data);
    } else {
      // Upsample to fill buffer
      upsampleNearestNeighbor(
        result.data,
        fetchedShape,
        bufferDims,
        targetData
      );
    }

    // Update NVImage header to reflect actual loaded region
    this.updateHeaderForRegion(ngffImage, alignedRegion);

    // Set clip planes if region doesn't align with cropping planes
    if (alignedRegion.needsClipping) {
      this.updateNiivueClipPlanes(alignedRegion, ngffImage);
    }

    // Refresh NiiVue
    this.niivue.updateGLVolume();
  }

  /**
   * Update NVImage header for a loaded region.
   */
  private updateHeaderForRegion(
    ngffImage: NgffImage,
    _region: PixelRegion
  ): void {
    if (!this.hdr) return;

    const affine = createAffineFromNgffImage(ngffImage);
    const srows = affineToNiftiSrows(affine);

    this.hdr.affine = [
      srows.srow_x,
      srows.srow_y,
      srows.srow_z,
      [0, 0, 0, 1],
    ];

    // Update pixel dimensions
    const pixDims = getPixelDimensions(affine);
    this.hdr.pixDims = [1, pixDims[0], pixDims[1], pixDims[2], 0, 0, 0, 0];

    // Recalculate RAS
    this.calculateRAS();
  }

  /**
   * Update NiiVue clip planes to hide pixels beyond cropping planes.
   */
  private updateNiivueClipPlanes(
    _alignedRegion: PixelRegion,
    ngffImage: NgffImage
  ): void {
    const clipPlanes = croppingPlanesToNiivueClipPlanes(
      this._croppingPlanes,
      ngffImage,
      this.volumeBounds
    );

    if (clipPlanes.length > 0) {
      this.niivue.scene.clipPlaneDepthAziElevs = clipPlanes;
    }
  }

  /**
   * Handle clip plane change from NiiVue.
   * This is called when the user interacts with clip planes in NiiVue.
   */
  private onClipPlaneChange(_clipPlane: number[]): void {
    // For now, we don't update cropping planes from NiiVue clip planes
    // This could be extended in the future to support bidirectional sync
  }

  /**
   * Set cropping planes.
   *
   * @param planes - Partial cropping planes to update
   */
  setCroppingPlanes(planes: Partial<CroppingPlanes>): void {
    const newPlanes = { ...this._croppingPlanes, ...planes };

    // Check if new region requires refetch
    const needsRefetch = this.checkNeedsRefetch(newPlanes);

    this._croppingPlanes = newPlanes;

    if (needsRefetch) {
      // Re-select resolution based on new cropping planes
      const selection = selectResolution(
        this.multiscales,
        this.maxPixels,
        this._croppingPlanes
      );
      this.targetLevelIndex = selection.levelIndex;

      // Reload the volume
      this.populateVolume();
    } else {
      // Just update clip planes
      const targetImage = this.multiscales.images[this.targetLevelIndex];
      const pixelRegion = worldToPixelRegion(this._croppingPlanes, targetImage);
      const alignedRegion = alignToChunks(pixelRegion, targetImage);
      this.updateNiivueClipPlanes(alignedRegion, targetImage);
      this.niivue.drawScene();
    }
  }

  /**
   * Get current cropping planes.
   */
  getCroppingPlanes(): CroppingPlanes {
    return { ...this._croppingPlanes };
  }

  /**
   * Check if new cropping planes require refetching data.
   */
  private checkNeedsRefetch(newPlanes: CroppingPlanes): boolean {
    const targetImage = this.multiscales.images[this.targetLevelIndex];

    const currentRegion = worldToPixelRegion(this._croppingPlanes, targetImage);
    const currentAligned = alignToChunks(currentRegion, targetImage);

    const newRegion = worldToPixelRegion(newPlanes, targetImage);
    const newAligned = alignToChunks(newRegion, targetImage);

    // Check if aligned regions are different
    return (
      currentAligned.chunkAlignedStart[0] !== newAligned.chunkAlignedStart[0] ||
      currentAligned.chunkAlignedStart[1] !== newAligned.chunkAlignedStart[1] ||
      currentAligned.chunkAlignedStart[2] !== newAligned.chunkAlignedStart[2] ||
      currentAligned.chunkAlignedEnd[0] !== newAligned.chunkAlignedEnd[0] ||
      currentAligned.chunkAlignedEnd[1] !== newAligned.chunkAlignedEnd[1] ||
      currentAligned.chunkAlignedEnd[2] !== newAligned.chunkAlignedEnd[2]
    );
  }

  /**
   * Get the current resolution level index.
   */
  getCurrentLevelIndex(): number {
    return this.currentLevelIndex;
  }

  /**
   * Get the target resolution level index.
   */
  getTargetLevelIndex(): number {
    return this.targetLevelIndex;
  }

  /**
   * Get the number of resolution levels.
   */
  getNumLevels(): number {
    return this.multiscales.images.length;
  }

  /**
   * Get the volume bounds in world space.
   */
  getVolumeBounds(): {
    min: [number, number, number];
    max: [number, number, number];
  } {
    return { ...this.volumeBounds };
  }

  /**
   * Get whether the image is currently loading.
   */
  getIsLoading(): boolean {
    return this.isLoading;
  }

  /**
   * Wait for all pending fetches to complete.
   */
  async waitForIdle(): Promise<void> {
    await this.coalescer.onIdle();
  }
}
