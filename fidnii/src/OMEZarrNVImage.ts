// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { NIFTI1 } from "nifti-reader-js";
import { NVImage } from "@niivue/niivue";
import type { Niivue } from "@niivue/niivue";
import type { Multiscales, NgffImage } from "@fideus-labs/ngff-zarr";

import type {
  ClipPlane,
  ClipPlanes,
  OMEZarrNVImageOptions,
  ZarrDtype,
  PixelRegion,
  ChunkAlignedRegion,
  VolumeBounds,
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
  getVolumeShape,
} from "./ResolutionSelector.js";
import {
  createDefaultClipPlanes,
  clipPlanesToPixelRegion,
  clipPlanesToNiivue,
  alignToChunks,
  validateClipPlanes,
  normalizeVector,
  MAX_CLIP_PLANES,
} from "./ClipPlanes.js";
import {
  createAffineFromNgffImage,
  calculateWorldBounds,
  affineToNiftiSrows,
} from "./utils/affine.js";

const DEFAULT_MAX_PIXELS = 50_000_000;

/**
 * OMEZarrNVImage extends NVImage to support rendering OME-Zarr images in NiiVue.
 *
 * Features:
 * - Progressive loading: quick preview from lowest resolution, then target resolution
 * - Arbitrary clip planes defined by point + normal (up to 6)
 * - Dynamic buffer sizing to match fetched data exactly (no upsampling)
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

  /** Buffer manager for dynamically-sized pixel data */
  private readonly bufferManager: BufferManager;

  /** Region coalescer for efficient chunk fetching */
  private readonly coalescer: RegionCoalescer;

  /** Current clip planes in world space */
  private _clipPlanes: ClipPlanes;

  /** Target resolution level index (based on maxPixels) */
  private targetLevelIndex: number;

  /** Current resolution level index during progressive loading */
  private currentLevelIndex: number;

  /** True if currently loading data */
  private isLoading: boolean = false;

  /** Data type of the volume */
  private readonly dtype: ZarrDtype;

  /** Full volume bounds in world space */
  private readonly _volumeBounds: VolumeBounds;

  /** Current buffer bounds in world space (may differ from full volume when clipped) */
  private _currentBufferBounds: VolumeBounds;

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

    // Initialize clip planes to empty (full volume visible)
    this._clipPlanes = createDefaultClipPlanes(this.multiscales);

    // Get data type from highest resolution image
    const highResImage = this.multiscales.images[0];
    this.dtype = parseZarritaDtype(highResImage.data.dtype);

    // Calculate volume bounds from highest resolution for most accurate bounds
    const highResAffine = createAffineFromNgffImage(highResImage);
    const highResShape = getVolumeShape(highResImage);
    this._volumeBounds = calculateWorldBounds(highResAffine, highResShape);
    
    // Initially, buffer bounds = full volume bounds (no clipping yet)
    this._currentBufferBounds = { ...this._volumeBounds };

    // Calculate target resolution based on pixel budget
    const selection = selectResolution(
      this.multiscales,
      this.maxPixels,
      this._clipPlanes,
      this._volumeBounds
    );
    this.targetLevelIndex = selection.levelIndex;
    this.currentLevelIndex = this.multiscales.images.length - 1;

    // Create buffer manager (dynamic sizing, no pre-allocation)
    this.bufferManager = new BufferManager(this.maxPixels, this.dtype);

    console.log("[fidnii] OMEZarrNVImage created:", {
      numLevels: this.multiscales.images.length,
      targetLevel: this.targetLevelIndex,
      maxPixels: this.maxPixels,
      dtype: this.dtype,
      volumeBounds: this._volumeBounds,
    });

    // Initialize NVImage properties with placeholder values
    // Actual values will be set when data is first loaded
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
      // Handle clip plane change
      image.onNiivueClipPlaneChange(clipPlane);
    };

    return image;
  }

  /**
   * Initialize NVImage properties with placeholder values.
   * Actual values will be set by loadResolutionLevel() after first data fetch.
   */
  private initializeNVImageProperties(): void {
    // Create NIfTI header with placeholder values
    const hdr = new NIFTI1();
    this.hdr = hdr;

    // Placeholder dimensions (will be updated when data loads)
    hdr.dims = [3, 1, 1, 1, 1, 1, 1, 1];

    // Set data type
    hdr.datatypeCode = getNiftiDataType(this.dtype);
    hdr.numBitsPerVoxel = getBytesPerPixel(this.dtype) * 8;

    // Placeholder pixel dimensions
    hdr.pixDims = [1, 1, 1, 1, 0, 0, 0, 0];

    // Placeholder affine (identity)
    hdr.affine = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];

    hdr.sform_code = 1; // Scanner coordinates

    // Set name
    this.name = this.multiscales.metadata?.name ?? "OME-Zarr";

    // Initialize with empty typed array (will be replaced when data loads)
    // We need at least 1 element to avoid issues
    this.img = this.bufferManager.resize([1, 1, 1]) as any;

    // Set default colormap
    this._colormap = "gray";
    this._opacity = 1.0;
  }

  /**
   * Populate the volume with data.
   *
   * Loading strategy:
   * 1. Load lowest resolution first for quick preview
   * 2. Jump directly to target resolution (skip intermediate levels)
   */
  async populateVolume(): Promise<void> {
    if (this.isLoading) {
      return;
    }
    this.isLoading = true;

    try {
      const numLevels = this.multiscales.images.length;
      const lowestLevel = numLevels - 1;

      console.log("[fidnii] populateVolume starting:", {
        lowestLevel,
        targetLevel: this.targetLevelIndex,
      });

      // Quick preview from lowest resolution (if different from target)
      if (lowestLevel !== this.targetLevelIndex) {
        await this.loadResolutionLevel(lowestLevel, "preview");
        this.currentLevelIndex = lowestLevel;
      }

      // Final quality at target resolution
      await this.loadResolutionLevel(this.targetLevelIndex, "target");
      this.currentLevelIndex = this.targetLevelIndex;

      console.log("[fidnii] populateVolume complete:", {
        currentLevel: this.currentLevelIndex,
      });
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Load data at a specific resolution level.
   *
   * With dynamic buffer sizing:
   * 1. Fetch data for the aligned region
   * 2. Resize buffer to match fetched data exactly (no upsampling)
   * 3. Update header with correct dimensions and voxel sizes
   * 4. Refresh NiiVue
   *
   * @param levelIndex - Resolution level index
   * @param requesterId - ID for request coalescing
   */
  private async loadResolutionLevel(
    levelIndex: number,
    requesterId: string
  ): Promise<void> {
    const ngffImage = this.multiscales.images[levelIndex];

    // Get the pixel region for current clip planes
    const pixelRegion = clipPlanesToPixelRegion(
      this._clipPlanes,
      this._volumeBounds,
      ngffImage
    );
    const alignedRegion = alignToChunks(pixelRegion, ngffImage);

    // Calculate the shape of data to fetch
    const fetchedShape: [number, number, number] = [
      alignedRegion.chunkAlignedEnd[0] - alignedRegion.chunkAlignedStart[0],
      alignedRegion.chunkAlignedEnd[1] - alignedRegion.chunkAlignedStart[1],
      alignedRegion.chunkAlignedEnd[2] - alignedRegion.chunkAlignedStart[2],
    ];

    // Get voxel size from this resolution level
    const scale = ngffImage.scale;
    const sx = scale.x ?? scale.X ?? 1;
    const sy = scale.y ?? scale.Y ?? 1;
    const sz = scale.z ?? scale.Z ?? 1;

    console.log("[fidnii] loadResolutionLevel:", {
      levelIndex,
      requesterId,
      fetchedShape,
      regionStart: alignedRegion.chunkAlignedStart,
      voxelSize: [sx, sy, sz],
    });

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

    // Resize buffer to match fetched data exactly (no upsampling!)
    const targetData = this.bufferManager.resize(fetchedShape);

    // Direct copy of fetched data
    targetData.set(result.data);

    // Update this.img to point to the (possibly new) buffer
    this.img = this.bufferManager.getTypedArray() as any;

    // Update NVImage header with correct dimensions and transforms
    this.updateHeaderForRegion(ngffImage, alignedRegion, fetchedShape);

    // Update NiiVue clip planes
    this.updateNiivueClipPlanes();

    // Refresh NiiVue
    this.niivue.updateGLVolume();
  }

  /**
   * Update NVImage header for a loaded region.
   *
   * With dynamic buffer sizing, the buffer dimensions equal the fetched dimensions.
   * We set pixDims directly from the resolution level's voxel size (no upsampling correction).
   * The affine translation is adjusted to account for the region offset.
   *
   * @param ngffImage - The NgffImage at the current resolution level
   * @param region - The chunk-aligned region that was loaded
   * @param fetchedShape - The shape of the fetched data [z, y, x]
   */
  private updateHeaderForRegion(
    ngffImage: NgffImage,
    region: ChunkAlignedRegion,
    fetchedShape: [number, number, number]
  ): void {
    if (!this.hdr) return;

    // Get voxel size from this resolution level (no upsampling adjustment needed!)
    const scale = ngffImage.scale;
    const sx = scale.x ?? scale.X ?? 1;
    const sy = scale.y ?? scale.Y ?? 1;
    const sz = scale.z ?? scale.Z ?? 1;

    // Set pixDims directly from resolution's voxel size
    this.hdr.pixDims = [1, sx, sy, sz, 0, 0, 0, 0];

    // Set dims to match fetched data (buffer now equals fetched size)
    // NIfTI dims: [ndim, x, y, z, t, ...]
    this.hdr.dims = [3, fetchedShape[2], fetchedShape[1], fetchedShape[0], 1, 1, 1, 1];

    // Build affine with offset for region start
    const affine = createAffineFromNgffImage(ngffImage);

    // Adjust translation for region offset
    // Buffer pixel [0,0,0] corresponds to source pixel region.chunkAlignedStart
    const regionStart = region.chunkAlignedStart;
    // regionStart is [z, y, x], affine translation is [x, y, z] (indices 12, 13, 14)
    affine[12] += regionStart[2] * sx; // x offset
    affine[13] += regionStart[1] * sy; // y offset
    affine[14] += regionStart[0] * sz; // z offset

    // Update affine in header
    const srows = affineToNiftiSrows(affine);
    this.hdr.affine = [
      srows.srow_x,
      srows.srow_y,
      srows.srow_z,
      [0, 0, 0, 1],
    ];

    // Update current buffer bounds
    // Buffer starts at region.chunkAlignedStart and has extent fetchedShape
    this._currentBufferBounds = {
      min: [
        affine[12],  // x offset (world coord of buffer origin)
        affine[13],  // y offset
        affine[14],  // z offset
      ],
      max: [
        affine[12] + fetchedShape[2] * sx,
        affine[13] + fetchedShape[1] * sy,
        affine[14] + fetchedShape[0] * sz,
      ],
    };

    console.log("[fidnii] updateHeaderForRegion:", {
      dims: this.hdr.dims,
      pixDims: this.hdr.pixDims,
      affineTranslation: [affine[12], affine[13], affine[14]],
      physicalExtent: [
        fetchedShape[2] * sx,
        fetchedShape[1] * sy,
        fetchedShape[0] * sz,
      ],
      currentBufferBounds: this._currentBufferBounds,
    });

    // Recalculate RAS orientation
    this.calculateRAS();
  }

  /**
   * Update NiiVue clip planes from current _clipPlanes.
   * 
   * Clip planes are converted relative to the CURRENT BUFFER bounds,
   * not the full volume bounds. This is because NiiVue's shader works
   * in texture coordinates of the currently loaded data.
   */
  private updateNiivueClipPlanes(): void {
    // Use current buffer bounds for clip plane conversion
    // This ensures clip planes are relative to the currently loaded data
    const niivueClipPlanes = clipPlanesToNiivue(this._clipPlanes, this._currentBufferBounds);

    console.log("[fidnii] updateNiivueClipPlanes:", {
      numPlanes: this._clipPlanes.length,
      fullVolumeBounds: this._volumeBounds,
      currentBufferBounds: this._currentBufferBounds,
      niivueClipPlanes,
    });

    if (niivueClipPlanes.length > 0) {
      this.niivue.scene.clipPlaneDepthAziElevs = niivueClipPlanes;
    } else {
      // Clear clip planes - set to "disabled" state (depth > 1.8)
      this.niivue.scene.clipPlaneDepthAziElevs = [[2, 0, 0]];
    }
  }

  /**
   * Handle clip plane change from NiiVue.
   * This is called when the user interacts with clip planes in NiiVue.
   */
  private onNiivueClipPlaneChange(_clipPlane: number[]): void {
    // For now, we don't update our clip planes from NiiVue interactions
    // This could be extended in the future to support bidirectional sync
  }

  /**
   * Set clip planes.
   *
   * @param planes - Array of clip planes (max 6). Empty array = full volume visible.
   * @throws Error if more than 6 planes provided or if planes are invalid
   */
  setClipPlanes(planes: ClipPlanes): void {
    // Validate the planes
    validateClipPlanes(planes);

    // Check if new clip planes require refetch
    const needsRefetch = this.checkNeedsRefetch(planes);

    this._clipPlanes = planes.map((p) => ({
      point: [...p.point] as [number, number, number],
      normal: normalizeVector([...p.normal] as [number, number, number]),
    }));

    if (needsRefetch) {
      // Re-select resolution based on new clip planes
      const selection = selectResolution(
        this.multiscales,
        this.maxPixels,
        this._clipPlanes,
        this._volumeBounds
      );
      this.targetLevelIndex = selection.levelIndex;

      console.log("[fidnii] setClipPlanes - refetching:", {
        newTargetLevel: this.targetLevelIndex,
        numPlanes: planes.length,
      });

      // Reload the volume
      this.populateVolume();
    } else {
      // Just update NiiVue clip planes
      this.updateNiivueClipPlanes();
      this.niivue.drawScene();
    }
  }

  /**
   * Get current clip planes.
   *
   * @returns Copy of current clip planes array
   */
  getClipPlanes(): ClipPlanes {
    return this._clipPlanes.map((p) => ({
      point: [...p.point] as [number, number, number],
      normal: [...p.normal] as [number, number, number],
    }));
  }

  /**
   * Add a single clip plane.
   *
   * @param plane - Clip plane to add
   * @throws Error if already at maximum (6) clip planes
   */
  addClipPlane(plane: ClipPlane): void {
    if (this._clipPlanes.length >= MAX_CLIP_PLANES) {
      throw new Error(
        `Cannot add clip plane: already at maximum of ${MAX_CLIP_PLANES} planes`
      );
    }

    const newPlanes = [
      ...this._clipPlanes,
      {
        point: [...plane.point] as [number, number, number],
        normal: [...plane.normal] as [number, number, number],
      },
    ];

    this.setClipPlanes(newPlanes);
  }

  /**
   * Remove a clip plane by index.
   *
   * @param index - Index of plane to remove
   * @throws Error if index is out of bounds
   */
  removeClipPlane(index: number): void {
    if (index < 0 || index >= this._clipPlanes.length) {
      throw new Error(
        `Invalid clip plane index: ${index} (have ${this._clipPlanes.length} planes)`
      );
    }

    const newPlanes = this._clipPlanes.filter((_, i) => i !== index);
    this.setClipPlanes(newPlanes);
  }

  /**
   * Clear all clip planes (show full volume).
   */
  clearClipPlanes(): void {
    this.setClipPlanes([]);
  }

  /**
   * Check if new clip planes require refetching data.
   */
  private checkNeedsRefetch(newPlanes: ClipPlanes): boolean {
    const targetImage = this.multiscales.images[this.targetLevelIndex];

    // Convert to pixel regions
    const currentRegion = clipPlanesToPixelRegion(
      this._clipPlanes,
      this._volumeBounds,
      targetImage
    );
    const currentAligned = alignToChunks(currentRegion, targetImage);

    const newRegion = clipPlanesToPixelRegion(
      newPlanes,
      this._volumeBounds,
      targetImage
    );
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
  getVolumeBounds(): VolumeBounds {
    return {
      min: [...this._volumeBounds.min],
      max: [...this._volumeBounds.max],
    };
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
