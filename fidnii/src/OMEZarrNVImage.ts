// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { Multiscales, NgffImage, Omero } from "@fideus-labs/ngff-zarr"
import { Methods } from "@fideus-labs/ngff-zarr"
import {
  computeOmeroFromNgffImage,
  GLASBEY_COLORS,
} from "@fideus-labs/ngff-zarr/browser"
import type { Niivue } from "@niivue/niivue"
import { NVImage, SLICE_TYPE } from "@niivue/niivue"
import { LRUCache } from "lru-cache"
import { NIFTI1 } from "nifti-reader-js"

import { BufferManager } from "./BufferManager.js"
import {
  alignToChunks,
  clipPlanesToNiivue,
  clipPlanesToPixelRegion,
  createDefaultClipPlanes,
  MAX_CLIP_PLANES,
  normalizeVector,
  validateClipPlanes,
} from "./ClipPlanes.js"
import {
  OMEZarrNVImageEvent,
  type OMEZarrNVImageEventListener,
  type OMEZarrNVImageEventListenerOptions,
  type OMEZarrNVImageEventMap,
  type PopulateTrigger,
} from "./events.js"
import type { ChannelWindow } from "./normalize.js"
import { computeChannelMinMax, normalizeToUint8 } from "./normalize.js"
import { RegionCoalescer } from "./RegionCoalescer.js"
import type { OrthogonalAxis } from "./ResolutionSelector.js"
import {
  getChunkShape,
  getVolumeShape,
  select2DResolution,
  selectResolution,
} from "./ResolutionSelector.js"
import type {
  AttachedNiivueState,
  CachedTimeFrame,
  ChannelInfo,
  ChunkAlignedRegion,
  ChunkCache,
  ClipPlane,
  ClipPlanes,
  OMEZarrNVImageOptions,
  PixelRegion,
  SlabBufferState,
  SlabSliceType,
  TimeAxisInfo,
  TimeUnit,
  TypedArray,
  VolumeBounds,
  ZarrDtype,
} from "./types.js"
import {
  getBytesPerPixel,
  getChannelInfo,
  getNiftiDataType,
  getRGBNiftiDataType,
  isRGBImage,
  NiftiDataType,
  needsRGBNormalization,
  parseZarritaDtype,
} from "./types.js"
import {
  affineToNiftiSrows,
  calculateWorldBounds,
  createAffineFromNgffImage,
  createAffineFromOMEZarr,
} from "./utils/affine.js"
import { worldToPixelAffine } from "./utils/coordinates.js"
import { getOrientationMapping } from "./utils/orientation.js"
import {
  boundsApproxEqual,
  computeViewportBounds2D,
  computeViewportBounds3D,
} from "./ViewportBounds.js"

const DEFAULT_MAX_PIXELS = 50_000_000
const DEFAULT_MAX_CACHE_ENTRIES = 200

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
  readonly multiscales: Multiscales

  /** Maximum number of pixels to use */
  readonly maxPixels: number

  /**
   * True when `multiscales.method` is `Methods.ITKWASM_LABEL_IMAGE`.
   *
   * Label images are rendered with a discrete colormap
   * (`setColormapLabel()`) instead of a continuous colormap, and
   * OMERO intensity windowing is skipped.
   */
  readonly isLabelImage: boolean

  // ============================================================
  // Colormap Override
  // ============================================================

  /**
   * The continuous colormap name used for rendering.
   *
   * Overrides the NVImage setter so that changing the colormap on this
   * image automatically propagates to all slab (2D slice) NVImages.
   * Label images are unaffected — they use `setColormapLabel()` instead.
   */
  override get colormap(): string {
    return this._colormap
  }

  override set colormap(cm: string) {
    // Use NVImage's setter (calls calMinMax + onColormapChange)
    super.colormap = cm
    // Propagate to all existing slab NVImages
    if (!this.isLabelImage) {
      for (const slab of this._slabBuffers.values()) {
        slab.nvImage.colormap = cm
      }
    }
  }

  /** Reference to NiiVue instance */
  private readonly niivue: Niivue

  /** Buffer manager for dynamically-sized pixel data */
  private readonly bufferManager: BufferManager

  /** Region coalescer for efficient chunk fetching */
  private readonly coalescer: RegionCoalescer

  /** Decoded-chunk cache shared across 3D and 2D slab loads. */
  private readonly _chunkCache: ChunkCache | undefined

  /** Current clip planes in world space */
  private _clipPlanes: ClipPlanes

  /** Target resolution level index (based on maxPixels) */
  private targetLevelIndex: number

  /** Current resolution level index during progressive loading */
  private currentLevelIndex: number

  /** True if currently loading data */
  private isLoading: boolean = false

  /** Data type of the volume */
  private readonly dtype: ZarrDtype

  /**
   * Channel dimension info, or `null` for scalar (single-component) images.
   * When non-null, the image has a `"c"` dimension and is treated as
   * multi-component (RGB/RGBA) data.
   */
  private readonly _channelInfo: ChannelInfo | null

  /**
   * Whether the image is 2D (no `"z"` dimension).
   */
  private readonly _is2D: boolean

  /**
   * Whether to negate the y-scale in the NIfTI affine for 2D images
   * so that NiiVue renders them right-side up.
   */
  private readonly _flipY2D: boolean

  /** Full volume bounds in world space */
  private readonly _volumeBounds: VolumeBounds

  /** Current buffer bounds in world space (may differ from full volume when clipped) */
  private _currentBufferBounds: VolumeBounds

  /** Previous clip plane change handler (to restore later) */
  private previousOnClipPlaneChange?: (clipPlane: number[]) => void

  /** Debounce delay for clip plane updates (ms) */
  private readonly clipPlaneDebounceMs: number

  /** Timeout handle for debounced clip plane refetch */
  private clipPlaneRefetchTimeout: ReturnType<typeof setTimeout> | null = null

  /** Previous clip planes state for direction comparison */
  private _previousClipPlanes: ClipPlanes = []

  /** Previous pixel count at current resolution (for direction comparison) */
  private _previousPixelCount: number = 0

  /** Cached/computed OMERO metadata for visualization (cal_min/cal_max) */
  private _omero: Omero | undefined

  /** Active channel index for OMERO window selection (default: 0) */
  private _activeChannel: number = 0

  /** Resolution level at which OMERO was last computed (to track recomputation) */
  private _omeroComputedForLevel: number = -1

  /** Internal EventTarget for event dispatching (composition pattern) */
  private readonly _eventTarget = new EventTarget()

  /** Pending populate request (latest wins - replaces any previous pending) */
  private _pendingPopulateRequest: {
    skipPreview: boolean
    trigger: PopulateTrigger
  } | null = null

  /**
   * AbortController for the in-flight `populateVolume` fetch.
   * Aborted when a new `populateVolume` call supersedes the current one,
   * allowing in-flight HTTP requests to be cancelled promptly.
   */
  private _populateAbortController: AbortController | null = null

  /** Current populate trigger (set at start of populateVolume, used by events) */
  private _currentPopulateTrigger: PopulateTrigger = "initial"

  // ============================================================
  // Multi-NV / Slab Buffer State
  // ============================================================

  /** Attached Niivue instances and their state */
  private _attachedNiivues: Map<Niivue, AttachedNiivueState> = new Map()

  /** Per-slice-type slab buffers (lazily created) */
  private _slabBuffers: Map<SlabSliceType, SlabBufferState> = new Map()

  /** Debounce timeout for slab reload per slice type */
  private _slabReloadTimeouts: Map<
    SlabSliceType,
    ReturnType<typeof setTimeout>
  > = new Map()

  // ============================================================
  // Viewport-Aware Resolution State
  // ============================================================

  /** Whether viewport-aware resolution selection is enabled */
  private _viewportAwareEnabled: boolean = false

  /**
   * Viewport bounds for the 3D render volume (union of all RENDER/MULTIPLANAR NVs).
   * Null = full volume, no viewport constraint.
   */
  private _viewportBounds3D: VolumeBounds | null = null

  /**
   * Per-slab viewport bounds (from the NV instance that displays each slab).
   * Null entry = full volume, no viewport constraint for that slab.
   */
  private _viewportBoundsPerSlab: Map<SlabSliceType, VolumeBounds | null> =
    new Map()

  /** Timeout handle for debounced viewport update */
  private _viewportUpdateTimeout: ReturnType<typeof setTimeout> | null = null

  /** Per-slab AbortController to cancel in-flight progressive loads */
  private _slabAbortControllers: Map<SlabSliceType, AbortController> = new Map()

  // ============================================================
  // Time Dimension State
  // ============================================================

  /**
   * Time axis metadata, or `null` if the dataset has no `"t"` dimension.
   * Populated during construction by inspecting `NgffImage.dims`.
   */
  private readonly _timeAxisInfo: TimeAxisInfo | null = null

  /** Current time index (0-based). Always 0 for non-time datasets. */
  private _timeIndex: number = 0

  /** Number of adjacent time frames to pre-fetch in each direction. */
  private readonly _timePrefetchCount: number

  /**
   * LRU cache of pre-fetched 3D time frames, keyed by time index.
   * Only used when `_timeAxisInfo` is non-null.
   */
  private readonly _timeFrameCache: LRUCache<number, CachedTimeFrame>

  /** Set of time indices currently being pre-fetched (for dedup). */
  private readonly _prefetchingTimeIndices: Set<number> = new Set()

  /** AbortController for the most recent pre-fetch batch. */
  private _prefetchAbortController: AbortController | null = null

  /**
   * Snapshot of the chunk-aligned region and resolution level used for
   * the last successful 3D volume load. Used to serve cached time frames
   * at the same spatial region. Cleared on clip plane / viewport / resolution
   * changes.
   */
  private _lastLoadedRegion: {
    region: ChunkAlignedRegion
    levelIndex: number
  } | null = null

  // ============================================================
  // 3D Zoom Override
  // ============================================================

  /** Maximum 3D render zoom level for scroll-wheel zoom */
  private readonly _max3DZoom: number

  /** Minimum 3D render zoom level for scroll-wheel zoom */
  private readonly _min3DZoom: number

  /**
   * Debounce delay for viewport-aware reloads (ms).
   * Higher than clip plane debounce to avoid excessive reloads during
   * continuous zoom/pan interactions.
   */
  private static readonly VIEWPORT_DEBOUNCE_MS = 500

  /** Default number of adjacent time frames to pre-fetch. */
  private static readonly DEFAULT_TIME_PREFETCH_COUNT = 2

  /**
   * Private constructor. Use OMEZarrNVImage.create() for instantiation.
   */
  private constructor(options: OMEZarrNVImageOptions) {
    // Call NVImage constructor with no data buffer
    super()

    this.multiscales = options.multiscales
    this.maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS
    this.isLabelImage = this.multiscales.method === Methods.ITKWASM_LABEL_IMAGE
    this.niivue = options.niivue
    this.clipPlaneDebounceMs = options.clipPlaneDebounceMs ?? 300

    // Initialize chunk cache: user-provided > LRU(maxCacheEntries) > disabled
    const maxEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES
    if (options.cache) {
      this._chunkCache = options.cache
    } else if (maxEntries > 0) {
      this._chunkCache = new LRUCache({ max: maxEntries })
    }

    this.coalescer = new RegionCoalescer(this._chunkCache)
    this._max3DZoom = options.max3DZoom ?? 10.0
    this._min3DZoom = options.min3DZoom ?? 0.3
    this._viewportAwareEnabled = options.viewportAware ?? true

    // Initialize clip planes to empty (full volume visible)
    this._clipPlanes = createDefaultClipPlanes(this.multiscales)

    // Get data type from highest resolution image
    const highResImage = this.multiscales.images[0]
    this.dtype = parseZarritaDtype(highResImage.data.dtype)

    // Detect channel (component) dimension for multi-component images
    this._channelInfo = getChannelInfo(highResImage)

    // Validate multi-component images: only RGB (3) / RGBA (4) are supported
    if (this._channelInfo && !isRGBImage(highResImage)) {
      throw new Error(
        `Unsupported multi-component image: found ${this._channelInfo.components} ` +
          `components with dtype '${this.dtype}'. Only RGB (3 components) ` +
          `and RGBA (4 components) images are supported. For other ` +
          `multi-component images, select a single component before loading.`,
      )
    }

    // Detect 2D images (no z axis) and store y-flip preference
    this._is2D = highResImage.dims.indexOf("z") === -1
    this._flipY2D = options.flipY2D ?? true

    // Detect time dimension from the zarr axes
    const tDimIndex = highResImage.dims.indexOf("t")
    if (tDimIndex !== -1) {
      const timeCount = highResImage.data.shape[tDimIndex]
      if (timeCount > 0) {
        // Look up time unit from axes metadata
        const timeAxis = this.multiscales.metadata?.axes?.find(
          (a) => a.name === "t",
        )
        this._timeAxisInfo = {
          count: timeCount,
          dimIndex: tDimIndex,
          step: highResImage.scale.t ?? 1,
          origin: highResImage.translation.t ?? 0,
          unit: timeAxis?.unit as TimeUnit | undefined,
        }
      }
    }

    // Initialize time state
    this._timePrefetchCount =
      options.timePrefetchCount ?? OMEZarrNVImage.DEFAULT_TIME_PREFETCH_COUNT
    const defaultTimeIndex = options.timeIndex ?? 0
    this._timeIndex = this._timeAxisInfo
      ? Math.max(0, Math.min(defaultTimeIndex, this._timeAxisInfo.count - 1))
      : 0

    // Time frame cache: capacity = current frame + both directions + small buffer
    const cacheCapacity = 2 * this._timePrefetchCount + 3
    this._timeFrameCache = new LRUCache<number, CachedTimeFrame>({
      max: cacheCapacity,
    })

    // Calculate volume bounds from highest resolution for most accurate bounds.
    // Use the unadjusted affine (no orientation signs) because volume bounds
    // live in OME-Zarr world space and drive internal clip-plane / viewport math.
    // Orientation is only applied to the NIfTI affine passed to NiiVue.
    const highResAffine = createAffineFromOMEZarr(
      highResImage.scale,
      highResImage.translation,
    )
    const highResShape = getVolumeShape(highResImage)
    this._volumeBounds = calculateWorldBounds(highResAffine, highResShape)

    // Initially, buffer bounds = full volume bounds (no clipping yet)
    this._currentBufferBounds = { ...this._volumeBounds }

    // Calculate target resolution based on pixel budget
    const selection = selectResolution(
      this.multiscales,
      this.maxPixels,
      this._clipPlanes,
      this._volumeBounds,
    )
    this.targetLevelIndex = selection.levelIndex
    this.currentLevelIndex = this.multiscales.images.length - 1

    // Create buffer manager (dynamic sizing, no pre-allocation).
    // For multi-component images, each spatial voxel has multiple
    // scalar elements (e.g. 3 for RGB, 4 for RGBA).
    const componentsPerVoxel = this._channelInfo?.components ?? 1
    this.bufferManager = new BufferManager(
      this.maxPixels,
      this.dtype,
      componentsPerVoxel,
    )

    // Initialize NVImage properties with placeholder values
    // Actual values will be set when data is first loaded
    this.initializeNVImageProperties()
  }

  /**
   * Create a new OMEZarrNVImage instance.
   *
   * By default, the image is automatically added to NiiVue and progressive
   * loading starts immediately (fire-and-forget). This enables progressive
   * rendering where each resolution level is displayed as it loads.
   *
   * Set `autoLoad: false` for manual control over when loading starts.
   * Listen to 'populateComplete' event to know when loading finishes.
   *
   * @param options - Options including multiscales, niivue reference, and optional maxPixels
   * @returns Promise resolving to the OMEZarrNVImage instance
   */
  static async create(options: OMEZarrNVImageOptions): Promise<OMEZarrNVImage> {
    const image = new OMEZarrNVImage(options)

    // Store and replace the clip plane change handler
    image.previousOnClipPlaneChange = image.niivue.onClipPlaneChange
    image.niivue.onClipPlaneChange = (clipPlane: number[]) => {
      // Call original handler if it exists
      if (image.previousOnClipPlaneChange) {
        image.previousOnClipPlaneChange(clipPlane)
      }
      // Handle clip plane change
      image.onNiivueClipPlaneChange(clipPlane)
    }

    // Auto-attach the primary NV instance for slice type / location tracking
    image.attachNiivue(image.niivue)

    // Auto-load by default (add to NiiVue + start progressive loading)
    const autoLoad = options.autoLoad ?? true
    if (autoLoad) {
      image.niivue.addVolume(image)
      void image.populateVolume() // Fire-and-forget, returns immediately
    }

    return image
  }

  /**
   * Initialize NVImage properties with placeholder values.
   * Actual values will be set by loadResolutionLevel() after first data fetch.
   */
  private initializeNVImageProperties(): void {
    // Create NIfTI header with placeholder values
    const hdr = new NIFTI1()
    this.hdr = hdr

    // Placeholder dimensions (will be updated when data loads)
    hdr.dims = [3, 1, 1, 1, 1, 1, 1, 1]

    // Set data type — use RGB24/RGBA32 for multi-component images
    // (any dtype; non-uint8 data is normalized to uint8 at load time)
    if (this._channelInfo && isRGBImage(this.multiscales.images[0])) {
      const rgbCode = getRGBNiftiDataType(this._channelInfo)
      hdr.datatypeCode = rgbCode
      hdr.numBitsPerVoxel = rgbCode === NiftiDataType.RGB24 ? 24 : 32
    } else {
      hdr.datatypeCode = getNiftiDataType(this.dtype)
      hdr.numBitsPerVoxel = getBytesPerPixel(this.dtype) * 8
    }

    // Placeholder pixel dimensions
    hdr.pixDims = [1, 1, 1, 1, 0, 0, 0, 0]

    // Placeholder affine (unit scale with orientation permutation/signs)
    // This is replaced by real data when loadResolutionLevel completes,
    // but having a reasonable placeholder avoids rendering glitches during
    // the initial frame.
    const mapping = getOrientationMapping(
      this.multiscales.images[0]?.axesOrientations,
    )
    const placeholderAffine = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ]
    placeholderAffine[mapping.x.physicalRow][0] = mapping.x.sign
    let ySign = mapping.y.sign
    if (this._flipY2D && this._is2D) {
      ySign = (ySign * -1) as 1 | -1
    }
    placeholderAffine[mapping.y.physicalRow][1] = ySign
    placeholderAffine[mapping.z.physicalRow][2] = mapping.z.sign
    hdr.affine = placeholderAffine

    hdr.sform_code = 1 // Scanner coordinates

    // Set name
    this.name = this.multiscales.metadata?.name ?? "OME-Zarr"

    // Initialize with empty typed array (will be replaced when data loads)
    // We need at least 1 element to avoid issues
    this.img = this.bufferManager.resize([1, 1, 1]) as NVImage["img"]

    // Set default colormap (label images use setColormapLabel() instead)
    if (!this.isLabelImage) {
      this._colormap = "gray"
    }
    this._opacity = 1.0
  }

  /**
   * Populate the volume with data.
   *
   * Loading strategy:
   * 1. Load lowest resolution first for quick preview (unless skipPreview is true)
   * 2. Jump directly to target resolution (skip intermediate levels)
   *
   * If called while already loading, the request is queued. Only the latest
   * queued request is kept (latest wins). When a queued request is replaced,
   * a `loadingSkipped` event is emitted.
   *
   * @param skipPreview - If true, skip the preview load (used for clip plane updates)
   * @param trigger - What triggered this population (default: 'initial')
   */
  async populateVolume(
    skipPreview: boolean = false,
    trigger: PopulateTrigger = "initial",
  ): Promise<void> {
    // If already loading, queue this request (latest wins)
    if (this.isLoading) {
      if (this._pendingPopulateRequest !== null) {
        // Replacing an existing queued request - emit loadingSkipped
        this._emitEvent("loadingSkipped", {
          reason: "queued-replaced",
          trigger: this._pendingPopulateRequest.trigger,
        })
      }
      // Queue this request (no event - just queuing)
      this._pendingPopulateRequest = { skipPreview, trigger }
      // Abort the in-flight fetch so the queued request runs sooner
      this._populateAbortController?.abort()
      return
    }

    // Abort any lingering controller from a previous run (defensive)
    this._populateAbortController?.abort()
    const abortController = new AbortController()
    this._populateAbortController = abortController

    this.isLoading = true
    this._currentPopulateTrigger = trigger
    this._pendingPopulateRequest = null // Clear any stale pending request

    try {
      const numLevels = this.multiscales.images.length
      const lowestLevel = numLevels - 1

      // Quick preview from lowest resolution (if different from target and not skipped)
      if (!skipPreview && lowestLevel !== this.targetLevelIndex) {
        await this.loadResolutionLevel(
          lowestLevel,
          "preview",
          undefined,
          abortController.signal,
        )
        if (abortController.signal.aborted) return
        const prevLevel = this.currentLevelIndex
        this.currentLevelIndex = lowestLevel

        // Emit resolutionChange for preview load
        if (prevLevel !== lowestLevel) {
          this._emitEvent("resolutionChange", {
            currentLevel: this.currentLevelIndex,
            targetLevel: this.targetLevelIndex,
            previousLevel: prevLevel,
            trigger: this._currentPopulateTrigger,
          })
        }
      }

      // Final quality at target resolution
      await this.loadResolutionLevel(
        this.targetLevelIndex,
        "target",
        undefined,
        abortController.signal,
      )
      if (abortController.signal.aborted) return
      const prevLevelBeforeTarget = this.currentLevelIndex
      this.currentLevelIndex = this.targetLevelIndex

      // Emit resolutionChange for target load
      if (prevLevelBeforeTarget !== this.targetLevelIndex) {
        this._emitEvent("resolutionChange", {
          currentLevel: this.currentLevelIndex,
          targetLevel: this.targetLevelIndex,
          previousLevel: prevLevelBeforeTarget,
          trigger: this._currentPopulateTrigger,
        })
      }

      // Update previous state for direction-aware resolution selection
      // Always calculate at level 0 for consistent comparison across resolution changes
      this._previousClipPlanes = this.copyClipPlanes(this._clipPlanes)
      const referenceImage = this.multiscales.images[0]
      const region = clipPlanesToPixelRegion(
        this._clipPlanes,
        this._volumeBounds,
        referenceImage,
      )
      const aligned = alignToChunks(region, referenceImage)
      this._previousPixelCount = this.calculateAlignedPixelCount(aligned)
    } finally {
      this.isLoading = false
      this._populateAbortController = null
      this.handlePendingPopulateRequest()
    }
  }

  /**
   * Process any pending populate request after current load completes.
   * If no pending request, emits populateComplete.
   */
  private handlePendingPopulateRequest(): void {
    const pending = this._pendingPopulateRequest
    if (pending !== null) {
      this._pendingPopulateRequest = null
      // Use void to indicate we're intentionally not awaiting
      void this.populateVolume(pending.skipPreview, pending.trigger)
      return
    }

    // No more pending requests - emit populateComplete
    this._emitEvent("populateComplete", {
      currentLevel: this.currentLevelIndex,
      targetLevel: this.targetLevelIndex,
      trigger: this._currentPopulateTrigger,
    })

    // Kick off pre-fetching of adjacent time frames now that we have a
    // stable spatial region + resolution level.
    if (this._timeAxisInfo && this._timeAxisInfo.count > 1) {
      this._prefetchAdjacentFrames(this._timeIndex)
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
   * @param timeIndex - Time point index to fetch (defaults to `this._timeIndex`)
   * @param signal - Optional AbortSignal to cancel the fetch
   */
  private async loadResolutionLevel(
    levelIndex: number,
    requesterId: string,
    timeIndex?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const effectiveTimeIndex = timeIndex ?? this._timeIndex
    // Emit loadingStart event
    this._emitEvent("loadingStart", {
      levelIndex,
      trigger: this._currentPopulateTrigger,
    })

    const ngffImage = this.multiscales.images[levelIndex]

    // Get the pixel region for current clip planes (+ 3D viewport bounds if active)
    const pixelRegion = clipPlanesToPixelRegion(
      this._clipPlanes,
      this._volumeBounds,
      ngffImage,
      this._viewportBounds3D ?? undefined,
    )
    const alignedRegion = alignToChunks(pixelRegion, ngffImage)

    // Calculate the shape of data to fetch
    const fetchedShape: [number, number, number] = [
      alignedRegion.chunkAlignedEnd[0] - alignedRegion.chunkAlignedStart[0],
      alignedRegion.chunkAlignedEnd[1] - alignedRegion.chunkAlignedStart[1],
      alignedRegion.chunkAlignedEnd[2] - alignedRegion.chunkAlignedStart[2],
    ]

    // Fetch the data
    const fetchRegion: PixelRegion = {
      start: alignedRegion.chunkAlignedStart,
      end: alignedRegion.chunkAlignedEnd,
    }

    const result = await this.coalescer.fetchRegion(
      ngffImage,
      levelIndex,
      fetchRegion,
      requesterId,
      effectiveTimeIndex,
      signal,
    )

    // Resize buffer to match fetched data exactly (no upsampling!)
    const targetData = this.bufferManager.resize(fetchedShape)

    // For non-uint8 RGB/RGBA, we need OMERO metadata *before* copying
    // so we can normalize the raw data to uint8 using channel windows.
    const normalize = needsRGBNormalization(ngffImage, this.dtype)
    if (normalize && !this.isLabelImage) {
      await this.ensureOmeroMetadata(ngffImage, levelIndex)
    }

    if (normalize && this._channelInfo) {
      // Non-uint8 RGB/RGBA: normalize raw data to uint8 using OMERO windows
      const windows = this._getChannelWindows(
        result.data,
        this._channelInfo.components,
      )
      const normalized = normalizeToUint8(
        result.data,
        this._channelInfo.components,
        windows,
      )
      targetData.set(normalized)
    } else {
      // uint8 RGB or scalar: direct copy
      targetData.set(result.data)
    }

    // Update this.img to point to the (possibly new) buffer
    this.img = this.bufferManager.getTypedArray() as NVImage["img"]

    // Update NVImage header with correct dimensions and transforms
    this.updateHeaderForRegion(ngffImage, alignedRegion, fetchedShape)

    // Snapshot the loaded region so time frame pre-fetch uses the same
    // spatial region / resolution level.
    this._lastLoadedRegion = { region: alignedRegion, levelIndex }

    if (this.isLabelImage) {
      // Label images: apply a discrete colormap instead of OMERO windowing
      this._applyLabelColormap(this, result.data)
    } else if (!normalize) {
      // Scalar / uint8 RGB: compute or apply OMERO for cal_min/cal_max.
      // (Normalized RGB already consumed the OMERO window above.)
      await this.ensureOmeroMetadata(ngffImage, levelIndex)
    }

    // Reset global_min so NiiVue's refreshLayers() re-runs calMinMax() on real data.
    // Without this, if calMinMax() was previously called on placeholder/empty data
    // (e.g., when setting colormap before loading), global_min would already be set
    // and NiiVue would skip recalculating intensity ranges, leaving cal_min/cal_max
    // at stale values (typically 0/0), causing an all-white render.
    this.global_min = undefined

    // Update NiiVue clip planes
    this.updateNiivueClipPlanes()

    // Refresh NiiVue
    this.niivue.updateGLVolume()

    if (!this.isLabelImage) {
      // Widen the display window if actual data exceeds the OMERO range.
      // At higher resolutions, individual bright/dark voxels that were averaged
      // out at lower resolutions can exceed the OMERO-specified window, causing
      // clipping artifacts. This preserves the OMERO lower bound but widens the
      // ceiling to encompass the full data range when needed.
      this._widenCalRangeIfNeeded(this)
    }

    // Emit loadingComplete event
    this._emitEvent("loadingComplete", {
      levelIndex,
      trigger: this._currentPopulateTrigger,
    })
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
    fetchedShape: [number, number, number],
  ): void {
    if (!this.hdr) return

    // Get voxel size from this resolution level (no upsampling adjustment needed!)
    const scale = ngffImage.scale
    const sx = scale.x ?? scale.X ?? 1
    const sy = scale.y ?? scale.Y ?? 1
    const sz = scale.z ?? scale.Z ?? 1

    // Set pixDims directly from resolution's voxel size
    this.hdr.pixDims = [1, sx, sy, sz, 0, 0, 0, 0]

    // Set dims to match fetched data (buffer now equals fetched size)
    // NIfTI dims: [ndim, x, y, z, t, ...]
    this.hdr.dims = [
      3,
      fetchedShape[2],
      fetchedShape[1],
      fetchedShape[0],
      1,
      1,
      1,
      1,
    ]

    // Compute buffer bounds in un-oriented OME-Zarr world space.
    // These drive clip-plane / viewport math and must stay un-oriented.
    const regionStart = region.chunkAlignedStart
    const translation = ngffImage.translation
    const tx = (translation.x ?? translation.X ?? 0) + regionStart[2] * sx
    const ty = (translation.y ?? translation.Y ?? 0) + regionStart[1] * sy
    const tz = (translation.z ?? translation.Z ?? 0) + regionStart[0] * sz

    this._currentBufferBounds = {
      min: [tx, ty, tz],
      max: [
        tx + fetchedShape[2] * sx,
        ty + fetchedShape[1] * sy,
        tz + fetchedShape[0] * sz,
      ],
    }

    // Build the fully oriented affine (including orientation permutation
    // and sign flips), then apply the region offset in world space.
    // The offset goes through the oriented 3x3 rotation matrix so it
    // lands on the correct world axis even when NGFF axes are permuted.
    const affine = createAffineFromNgffImage(ngffImage)

    // regionStart is [z, y, x]; affine columns map NIfTI [i=x, j=y, k=z]
    const offsetX = regionStart[2] // NIfTI i = NGFF x
    const offsetY = regionStart[1] // NIfTI j = NGFF y
    const offsetZ = regionStart[0] // NIfTI k = NGFF z
    affine[12] +=
      affine[0] * offsetX + affine[4] * offsetY + affine[8] * offsetZ
    affine[13] +=
      affine[1] * offsetX + affine[5] * offsetY + affine[9] * offsetZ
    affine[14] +=
      affine[2] * offsetX + affine[6] * offsetY + affine[10] * offsetZ

    // For 2D images, flip y so NiiVue's calculateRAS() accounts for
    // top-to-bottom pixel storage order. We shift the translation so
    // the last row maps to where the first row was, then negate the
    // y column. This composes correctly with any orientation sign.
    if (this._flipY2D && this._is2D) {
      // Get the y axis orientation mapping to find where the y scale is stored
      const mapping = getOrientationMapping(ngffImage.axesOrientations)
      // The y scale is at affine[4 + physicalRow] (column 1, appropriate row)
      const yScaleIndex = 4 + mapping.y.physicalRow
      affine[13] += affine[yScaleIndex] * (fetchedShape[1] - 1)
      affine[yScaleIndex] = -affine[yScaleIndex]
    }

    // Update affine in header
    const srows = affineToNiftiSrows(affine)
    this.hdr.affine = [srows.srow_x, srows.srow_y, srows.srow_z, [0, 0, 0, 1]]

    // Recalculate RAS orientation
    this.calculateRAS()
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
    const niivueClipPlanes = clipPlanesToNiivue(
      this._clipPlanes,
      this._currentBufferBounds,
    )

    if (niivueClipPlanes.length > 0) {
      this.niivue.scene.clipPlaneDepthAziElevs = niivueClipPlanes
    } else {
      // Clear clip planes - set to "disabled" state (depth > 1.8)
      this.niivue.scene.clipPlaneDepthAziElevs = [[2, 0, 0]]
    }
  }

  /**
   * Apply OMERO window settings to NIfTI header cal_min/cal_max.
   *
   * Uses the active channel's window (start/end preferred over min/max).
   * This sets the display intensity range for NiiVue rendering.
   */
  private applyOmeroToHeader(): void {
    if (!this.hdr || !this._omero?.channels?.length) return

    // Clamp active channel to valid range
    const channelIndex = Math.min(
      this._activeChannel,
      this._omero.channels.length - 1,
    )
    const channel = this._omero.channels[channelIndex]
    const window = channel?.window

    if (window) {
      // Prefer start/end (display window based on quantiles) over min/max (data range)
      const calMin = window.start ?? window.min
      const calMax = window.end ?? window.max

      if (calMin !== undefined) this.hdr.cal_min = calMin
      if (calMax !== undefined) this.hdr.cal_max = calMax
    }
  }

  /**
   * Build and apply a discrete NiiVue label colormap to an NVImage.
   *
   * Scans the pixel data for unique integer values and assigns each a
   * distinct color from the Glasbey palette (via `@fideus-labs/ngff-zarr`).
   * Label 0 is treated as background (fully transparent).
   *
   * @param nvImage - The NVImage to apply the label colormap to
   * @param data - The pixel data to scan for unique labels
   */
  private _applyLabelColormap(nvImage: NVImage, data: TypedArray): void {
    const uniqueLabels = [...new Set(data as Iterable<number>)].sort(
      (a, b) => a - b,
    )

    const R: number[] = []
    const G: number[] = []
    const B: number[] = []
    const A: number[] = []
    const I: number[] = []
    const labels: string[] = []

    for (let i = 0; i < uniqueLabels.length; i++) {
      const label = uniqueLabels[i]
      I.push(label)

      if (label === 0) {
        // Background: transparent
        R.push(0)
        G.push(0)
        B.push(0)
        A.push(0)
        labels.push("background")
      } else {
        // Use Glasbey color palette (cycling if >256 labels)
        const hex = GLASBEY_COLORS[(i - 1) % GLASBEY_COLORS.length] ?? "FFFFFF"
        R.push(parseInt(hex.slice(0, 2), 16))
        G.push(parseInt(hex.slice(2, 4), 16))
        B.push(parseInt(hex.slice(4, 6), 16))
        A.push(255)
        labels.push(String(label))
      }
    }

    // NiiVue's setColormapLabel expects a ColorMap-shaped object
    nvImage.setColormapLabel({ R, G, B, A, I, labels })
  }

  /**
   * Ensure OMERO metadata is available and applied.
   *
   * Strategy:
   * - If OMERO exists in file metadata, use it (first time only)
   * - If NOT present, compute dynamically:
   *   - Compute at preview (lowest) resolution for quick initial display
   *   - Recompute at target resolution for more accurate values
   *   - Keep target values for consistency on subsequent clip plane changes
   *
   * @param ngffImage - The NgffImage at the current resolution level
   * @param levelIndex - The resolution level index
   */
  private async ensureOmeroMetadata(
    ngffImage: NgffImage,
    levelIndex: number,
  ): Promise<void> {
    const existingOmero = this.multiscales.metadata?.omero

    if (existingOmero && !this._omero) {
      // Use existing OMERO metadata from the file (first time)
      this._omero = existingOmero
      this.applyOmeroToHeader()
      return
    }

    if (!existingOmero) {
      // No OMERO in file - compute dynamically
      // Compute at preview (lowest) and target levels, then keep for consistency
      const lowestLevel = this.multiscales.images.length - 1
      const isPreviewLevel = levelIndex === lowestLevel
      const isTargetLevel = levelIndex === this.targetLevelIndex
      const needsCompute =
        isPreviewLevel ||
        (isTargetLevel && this._omeroComputedForLevel !== this.targetLevelIndex)

      if (needsCompute) {
        // Pass the chunk cache so decoded chunks from OMERO statistics
        // computation are reused by subsequent zarrGet() calls.
        const omeroOpts = this._chunkCache
          ? ({ cache: this._chunkCache } as Record<string, unknown>)
          : undefined
        const computedOmero = await computeOmeroFromNgffImage(
          ngffImage,
          omeroOpts,
        )
        this._omero = computedOmero
        this._omeroComputedForLevel = levelIndex
        this.applyOmeroToHeader()
      }
    }
  }

  /**
   * Get per-channel normalization windows for non-uint8 RGB/RGBA.
   *
   * Uses OMERO `window.start`/`window.end` (or `window.min`/`window.max`)
   * when available. Falls back to computing min/max from the raw data.
   *
   * @param data - Raw multi-component data from the zarr fetch
   * @param components - Number of components per voxel (3 or 4)
   * @returns Per-channel windows for normalization to uint8
   */
  private _getChannelWindows(
    data: TypedArray,
    components: number,
  ): ChannelWindow[] {
    if (this._omero?.channels?.length) {
      const windows: ChannelWindow[] = []
      for (let c = 0; c < components; c++) {
        const channel =
          this._omero.channels[Math.min(c, this._omero.channels.length - 1)]
        const win = channel?.window
        if (win) {
          windows.push({
            start: win.start ?? win.min ?? 0,
            end: win.end ?? win.max ?? 1,
          })
        } else {
          windows.push({ start: 0, end: 1 })
        }
      }
      return windows
    }

    // No OMERO metadata: fall back to per-channel min/max from data
    return computeChannelMinMax(data, components)
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
   * Visual clipping is updated immediately for responsive feedback.
   * Data refetch is debounced to avoid excessive reloading during slider interaction.
   * Resolution changes are direction-aware: reducing volume may increase resolution,
   * increasing volume may decrease resolution.
   *
   * @param planes - Array of clip planes (max 6). Empty array = full volume visible.
   * @throws Error if more than 6 planes provided or if planes are invalid
   */
  setClipPlanes(planes: ClipPlanes): void {
    // Validate the planes
    validateClipPlanes(planes)

    // Check if this is a "reset" operation (clearing all planes)
    const isReset = planes.length === 0 && this._previousClipPlanes.length > 0

    // Store new clip planes
    this._clipPlanes = planes.map((p) => ({
      point: [...p.point] as [number, number, number],
      normal: normalizeVector([...p.normal] as [number, number, number]),
    }))

    // Always update NiiVue clip planes immediately (visual feedback)
    this.updateNiivueClipPlanes()
    this.niivue.drawScene()

    // Clear any pending debounced refetch
    if (this.clipPlaneRefetchTimeout) {
      clearTimeout(this.clipPlaneRefetchTimeout)
      this.clipPlaneRefetchTimeout = null
    }

    // Debounce the data refetch decision
    this.clipPlaneRefetchTimeout = setTimeout(() => {
      this.handleDebouncedClipPlaneUpdate(isReset)
    }, this.clipPlaneDebounceMs)
  }

  /**
   * Handle clip plane update after debounce delay.
   * Implements direction-aware resolution selection.
   *
   * Only triggers a refetch when the resolution level needs to change.
   * Visual clipping is handled by NiiVue clip planes (updated immediately in setClipPlanes).
   */
  private handleDebouncedClipPlaneUpdate(isReset: boolean): void {
    this.clipPlaneRefetchTimeout = null

    // Always use level 0 for consistent pixel count comparison across resolution changes
    const referenceImage = this.multiscales.images[0]

    // Calculate current region at reference resolution
    const currentRegion = clipPlanesToPixelRegion(
      this._clipPlanes,
      this._volumeBounds,
      referenceImage,
    )
    const currentAligned = alignToChunks(currentRegion, referenceImage)
    const currentPixelCount = this.calculateAlignedPixelCount(currentAligned)

    // Determine volume change direction (comparing at consistent reference level)
    const volumeReduced = currentPixelCount < this._previousPixelCount
    const volumeIncreased = currentPixelCount > this._previousPixelCount

    // Get optimal resolution for new region (3D viewport bounds)
    const selection = selectResolution(
      this.multiscales,
      this.maxPixels,
      this._clipPlanes,
      this._volumeBounds,
      this._viewportBounds3D ?? undefined,
    )

    // Direction-aware resolution change
    let newTargetLevel = this.targetLevelIndex

    if (isReset) {
      // Reset/clear: always recalculate optimal resolution
      newTargetLevel = selection.levelIndex
    } else if (volumeReduced && selection.levelIndex < this.targetLevelIndex) {
      // Volume reduced → allow higher resolution (lower level index)
      newTargetLevel = selection.levelIndex
    } else if (
      volumeIncreased &&
      selection.levelIndex > this.targetLevelIndex
    ) {
      // Volume increased → allow lower resolution (higher level index) if needed to fit
      newTargetLevel = selection.levelIndex
    }
    // Otherwise: keep current level (no unnecessary resolution changes)

    // Only refetch when resolution level changes
    // Visual clipping is handled by NiiVue clip planes (already updated in setClipPlanes)
    if (newTargetLevel !== this.targetLevelIndex) {
      this.targetLevelIndex = newTargetLevel
      // Spatial region changed — cached time frames are stale
      this._invalidateTimeFrameCache()
      this.populateVolume(true, "clipPlanesChanged") // Skip preview for clip plane updates
    }

    // Emit clipPlanesChange event (after debounce)
    this._emitEvent("clipPlanesChange", {
      clipPlanes: this.copyClipPlanes(this._clipPlanes),
    })
  }

  /**
   * Calculate pixel count for a chunk-aligned region.
   */
  private calculateAlignedPixelCount(aligned: ChunkAlignedRegion): number {
    return (
      (aligned.chunkAlignedEnd[0] - aligned.chunkAlignedStart[0]) *
      (aligned.chunkAlignedEnd[1] - aligned.chunkAlignedStart[1]) *
      (aligned.chunkAlignedEnd[2] - aligned.chunkAlignedStart[2])
    )
  }

  /**
   * Create a deep copy of clip planes array.
   */
  private copyClipPlanes(planes: ClipPlanes): ClipPlanes {
    return planes.map((p) => ({
      point: [...p.point] as [number, number, number],
      normal: [...p.normal] as [number, number, number],
    }))
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
    }))
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
        `Cannot add clip plane: already at maximum of ${MAX_CLIP_PLANES} planes`,
      )
    }

    const newPlanes = [
      ...this._clipPlanes,
      {
        point: [...plane.point] as [number, number, number],
        normal: [...plane.normal] as [number, number, number],
      },
    ]

    this.setClipPlanes(newPlanes)
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
        `Invalid clip plane index: ${index} (have ${this._clipPlanes.length} planes)`,
      )
    }

    const newPlanes = this._clipPlanes.filter((_, i) => i !== index)
    this.setClipPlanes(newPlanes)
  }

  /**
   * Clear all clip planes (show full volume).
   */
  clearClipPlanes(): void {
    this.setClipPlanes([])
  }

  /**
   * Get the current resolution level index.
   */
  getCurrentLevelIndex(): number {
    return this.currentLevelIndex
  }

  /**
   * Get the target resolution level index.
   */
  getTargetLevelIndex(): number {
    return this.targetLevelIndex
  }

  /**
   * Get the number of resolution levels.
   */
  getNumLevels(): number {
    return this.multiscales.images.length
  }

  /**
   * Load a specific resolution level.
   *
   * Overrides the automatic `maxPixels`-based level selection and loads the
   * requested level directly.  The preview step is skipped because the caller
   * has explicitly chosen a level.
   *
   * @param levelIndex - Zero-based resolution level (0 = highest resolution)
   * @throws If `levelIndex` is out of range
   */
  async loadLevel(levelIndex: number): Promise<void> {
    const numLevels = this.multiscales.images.length
    if (levelIndex < 0 || levelIndex >= numLevels) {
      throw new Error(
        `levelIndex ${levelIndex} out of range [0, ${numLevels - 1}]`,
      )
    }
    this.targetLevelIndex = levelIndex
    await this.populateVolume(true, "initial")
  }

  /**
   * Get the volume bounds in world space.
   */
  getVolumeBounds(): VolumeBounds {
    return {
      min: [...this._volumeBounds.min],
      max: [...this._volumeBounds.max],
    }
  }

  // ============================================================
  // Time Navigation
  // ============================================================

  /**
   * Time axis metadata, or `null` if the dataset has no `"t"` dimension.
   *
   * @example
   * ```ts
   * const info = image.timeAxisInfo
   * if (info) {
   *   console.log(`${info.count} time points, step=${info.step} ${info.unit}`)
   * }
   * ```
   */
  get timeAxisInfo(): TimeAxisInfo | null {
    return this._timeAxisInfo
  }

  /**
   * Total number of time points.
   * Returns 1 for datasets without a `"t"` dimension.
   */
  get timeCount(): number {
    return this._timeAxisInfo?.count ?? 1
  }

  /**
   * Current time index (0-based).
   * Always 0 for datasets without a `"t"` dimension.
   */
  get timeIndex(): number {
    return this._timeIndex
  }

  /**
   * Compute the physical time value at a given index.
   *
   * @param index - Time index (0-based)
   * @returns Physical time value (`origin + index * step`)
   */
  getTimeValue(index: number): number {
    if (!this._timeAxisInfo) return 0
    return this._timeAxisInfo.origin + index * this._timeAxisInfo.step
  }

  /**
   * Set the active time index and reload the volume.
   *
   * If the requested frame is in the pre-fetch cache, the buffer is
   * swapped instantly without a network fetch. Otherwise, the frame is
   * loaded from the zarr store at the current resolution level and
   * spatial region.
   *
   * After the frame is loaded, adjacent frames are pre-fetched in the
   * background so subsequent scrubbing can serve frames from cache.
   *
   * @param index - Time index (0-based)
   * @throws If `index` is out of range `[0, timeCount)`
   *
   * @example
   * ```ts
   * await image.setTimeIndex(5)
   * image.addEventListener('timeChange', (e) => {
   *   console.log(`Frame ${e.detail.index}, cached=${e.detail.cached}`)
   * })
   * ```
   */
  async setTimeIndex(index: number): Promise<void> {
    if (!this._timeAxisInfo) {
      if (index !== 0) {
        throw new Error(
          `Cannot set time index ${index}: dataset has no time dimension`,
        )
      }
      return
    }

    if (index < 0 || index >= this._timeAxisInfo.count) {
      throw new Error(
        `Time index ${index} out of range [0, ${this._timeAxisInfo.count})`,
      )
    }

    const previousIndex = this._timeIndex
    if (index === previousIndex) return

    this._timeIndex = index

    // Try the pre-fetch cache first
    const cached = this._timeFrameCache.get(index)
    if (cached && cached.levelIndex === this.currentLevelIndex) {
      // Cache hit: instant buffer swap
      const targetData = this.bufferManager.resize(cached.shape)
      targetData.set(cached.data)
      this.img = this.bufferManager.getTypedArray() as NVImage["img"]
      this.updateHeaderForRegion(
        this.multiscales.images[cached.levelIndex],
        cached.region,
        cached.shape,
      )
      this.global_min = undefined
      this.niivue.updateGLVolume()

      this._emitEvent("timeChange", {
        index,
        timeValue: this.getTimeValue(index),
        previousIndex,
        cached: true,
      })
    } else {
      // Cache miss: full load at current resolution + region
      await this.populateVolume(true, "initial")

      this._emitEvent("timeChange", {
        index,
        timeValue: this.getTimeValue(index),
        previousIndex,
        cached: false,
      })
    }

    // Pre-fetch adjacent frames in the background
    this._prefetchAdjacentFrames(index)
  }

  /**
   * Clear the pre-fetched time frame cache.
   *
   * Called internally when the spatial region or resolution changes
   * (clip planes, viewport, resolution level), since cached frames
   * were fetched for the previous region and are no longer valid.
   */
  private _invalidateTimeFrameCache(): void {
    this._timeFrameCache.clear()
    this._lastLoadedRegion = null
    // Cancel any in-flight pre-fetches
    if (this._prefetchAbortController) {
      this._prefetchAbortController.abort()
      this._prefetchAbortController = null
    }
    this._prefetchingTimeIndices.clear()
  }

  /**
   * Pre-fetch adjacent time frames in the background.
   *
   * Fetches frames `[index - N, index + N]` (clamped to valid range)
   * at the current resolution level and spatial region. Already-cached
   * and currently-in-flight indices are skipped.
   *
   * @param centerIndex - The time index to pre-fetch around
   */
  private _prefetchAdjacentFrames(centerIndex: number): void {
    if (!this._timeAxisInfo || this._timePrefetchCount <= 0) return
    if (!this._lastLoadedRegion) return

    // Cancel any previous pre-fetch batch
    if (this._prefetchAbortController) {
      this._prefetchAbortController.abort()
    }
    const abortController = new AbortController()
    this._prefetchAbortController = abortController

    const { region, levelIndex } = this._lastLoadedRegion
    const ngffImage = this.multiscales.images[levelIndex]

    // Collect indices to pre-fetch
    const indices: number[] = []
    for (let delta = 1; delta <= this._timePrefetchCount; delta++) {
      const before = centerIndex - delta
      const after = centerIndex + delta
      if (before >= 0) indices.push(before)
      if (after < this._timeAxisInfo.count) indices.push(after)
    }

    // Filter out already cached and in-flight indices
    const toFetch = indices.filter(
      (i) =>
        !this._timeFrameCache.has(i) && !this._prefetchingTimeIndices.has(i),
    )

    if (toFetch.length === 0) return

    const fetchRegion: PixelRegion = {
      start: region.chunkAlignedStart,
      end: region.chunkAlignedEnd,
    }

    // Fire-and-forget pre-fetches
    for (const timeIdx of toFetch) {
      if (abortController.signal.aborted) break

      this._prefetchingTimeIndices.add(timeIdx)

      void this.coalescer
        .fetchRegion(
          ngffImage,
          levelIndex,
          fetchRegion,
          `prefetch-t${timeIdx}`,
          timeIdx,
        )
        .then((result) => {
          if (abortController.signal.aborted) return

          const shape: [number, number, number] = [
            region.chunkAlignedEnd[0] - region.chunkAlignedStart[0],
            region.chunkAlignedEnd[1] - region.chunkAlignedStart[1],
            region.chunkAlignedEnd[2] - region.chunkAlignedStart[2],
          ]

          // Store a copy so the original fetch result can be GC'd
          this._timeFrameCache.set(timeIdx, {
            data: result.data.slice() as TypedArray,
            shape,
            levelIndex,
            region,
          })
        })
        .catch(() => {
          // Silently ignore pre-fetch failures (non-critical)
        })
        .finally(() => {
          this._prefetchingTimeIndices.delete(timeIdx)
        })
    }
  }

  // ============================================================
  // Viewport-Aware Resolution
  // ============================================================

  /**
   * Enable or disable viewport-aware resolution selection.
   *
   * When enabled, pan/zoom/rotation interactions are monitored and the fetch
   * region is constrained to the visible viewport area. This allows higher
   * resolution within the same `maxPixels` budget when zoomed in.
   *
   * @param enabled - Whether to enable viewport-aware resolution
   */
  setViewportAware(enabled: boolean): void {
    if (enabled === this._viewportAwareEnabled) return
    this._viewportAwareEnabled = enabled

    if (enabled) {
      // Hook viewport events on all attached NVs
      for (const [nv, state] of this._attachedNiivues) {
        this._hookViewportEvents(nv, state)
      }
      // Compute initial viewport bounds and trigger refetch
      this._recomputeViewportBounds()
    } else {
      // Unhook viewport events on all attached NVs
      for (const [nv, state] of this._attachedNiivues) {
        this._unhookViewportEvents(nv, state)
      }
      // Clear viewport bounds and refetch at full volume
      this._viewportBounds3D = null
      this._viewportBoundsPerSlab.clear()
      if (this._viewportUpdateTimeout) {
        clearTimeout(this._viewportUpdateTimeout)
        this._viewportUpdateTimeout = null
      }
      // Recompute resolution without viewport constraint
      const selection = selectResolution(
        this.multiscales,
        this.maxPixels,
        this._clipPlanes,
        this._volumeBounds,
      )
      if (selection.levelIndex !== this.targetLevelIndex) {
        this.targetLevelIndex = selection.levelIndex
        // Spatial region changed — cached time frames are stale
        this._invalidateTimeFrameCache()
        this.populateVolume(true, "viewportChanged")
      }
      // Also reload slabs without viewport constraint
      this._reloadAllSlabs("viewportChanged")
    }
  }

  /**
   * Get whether viewport-aware resolution selection is enabled.
   */
  get viewportAware(): boolean {
    return this._viewportAwareEnabled
  }

  /**
   * Get the current 3D viewport bounds (null if viewport-aware is disabled
   * or no viewport constraint is active).
   */
  getViewportBounds(): VolumeBounds | null {
    if (!this._viewportBounds3D) return null
    return {
      min: [...this._viewportBounds3D.min] as [number, number, number],
      max: [...this._viewportBounds3D.max] as [number, number, number],
    }
  }

  /**
   * Hook viewport events (onMouseUp, onZoom3DChange, wheel) on a NV instance.
   */
  private _hookViewportEvents(nv: Niivue, state: AttachedNiivueState): void {
    // Save and chain onMouseUp (fires at end of any mouse/touch interaction)
    state.previousOnMouseUp = nv.onMouseUp as (data: unknown) => void
    nv.onMouseUp = (data: unknown) => {
      if (state.previousOnMouseUp) {
        state.previousOnMouseUp(data)
      }
      this._handleViewportInteractionEnd(nv)
    }

    // Save and chain onZoom3DChange (fires when volScaleMultiplier changes)
    state.previousOnZoom3DChange = nv.onZoom3DChange
    nv.onZoom3DChange = (zoom: number) => {
      if (state.previousOnZoom3DChange) {
        state.previousOnZoom3DChange(zoom)
      }
      this._handleViewportInteractionEnd(nv)
    }

    // Add wheel event listener on the canvas for scroll-wheel zoom detection
    const controller = new AbortController()
    state.viewportAbortController = controller
    if (nv.canvas) {
      nv.canvas.addEventListener(
        "wheel",
        () => {
          this._handleViewportInteractionEnd(nv)
        },
        { signal: controller.signal, passive: true },
      )
    }
  }

  /**
   * Unhook viewport events from a NV instance.
   */
  private _unhookViewportEvents(nv: Niivue, state: AttachedNiivueState): void {
    // Restore onMouseUp
    if (state.previousOnMouseUp !== undefined) {
      nv.onMouseUp = state.previousOnMouseUp as typeof nv.onMouseUp
      state.previousOnMouseUp = undefined
    }

    // Restore onZoom3DChange
    if (state.previousOnZoom3DChange !== undefined) {
      nv.onZoom3DChange = state.previousOnZoom3DChange
      state.previousOnZoom3DChange = undefined
    }

    // Remove wheel event listener
    if (state.viewportAbortController) {
      state.viewportAbortController.abort()
      state.viewportAbortController = undefined
    }
  }

  // ============================================================
  // 3D Zoom Override
  // ============================================================

  /**
   * Install a capturing-phase wheel listener on the NV canvas that overrides
   * NiiVue's hardcoded 3D render zoom clamp ([0.5, 2.0]).
   *
   * The listener intercepts scroll events over 3D render tiles and applies
   * zoom via `nv.setScale()` (which has no internal clamp), using the
   * configurable `_min3DZoom` / `_max3DZoom` bounds instead.
   *
   * Clip-plane scrolling is preserved: when a clip plane is active
   * (depth < 1.8), the event passes through to NiiVue's native handler.
   */
  private _hookZoomOverride(nv: Niivue, state: AttachedNiivueState): void {
    if (!nv.canvas) return

    const controller = new AbortController()
    state.zoomOverrideAbortController = controller

    nv.canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        // Convert mouse position to DPR-scaled canvas coordinates
        const canvas = nv.canvas
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const dpr = nv.uiData.dpr ?? 1
        const x = (e.clientX - rect.left) * dpr
        const y = (e.clientY - rect.top) * dpr

        // Only intercept if mouse is over a 3D render tile
        if (nv.inRenderTile(x, y) < 0) return

        // Preserve clip-plane scrolling: when a clip plane is active
        // (depth < 1.8), let NiiVue handle the event normally.
        const clips = nv.scene.clipPlaneDepthAziElevs
        const activeIdx = nv.uiData.activeClipPlaneIndex
        if (
          nv.volumes.length > 0 &&
          clips?.[activeIdx]?.[0] !== undefined &&
          clips[activeIdx][0] < 1.8
        ) {
          return
        }

        // Prevent NiiVue's clamped handler from running.
        // NiiVue registers its listener in the bubbling phase, so our
        // capturing-phase listener fires first. stopImmediatePropagation
        // ensures no other same-element listeners fire either.
        e.stopImmediatePropagation()
        e.preventDefault()

        // Compute new zoom (same ×1.1 / ×0.9 per step as NiiVue).
        // Round to 2 decimal places (NiiVue rounds to 1, which causes the
        // zoom to get stuck at small values like 0.5 where ×0.9 rounds back).
        const zoomDir = e.deltaY < 0 ? 1 : -1
        const current = nv.scene.volScaleMultiplier
        let newZoom = current * (zoomDir > 0 ? 1.1 : 0.9)
        newZoom = Math.round(newZoom * 100) / 100
        newZoom = Math.max(this._min3DZoom, Math.min(this._max3DZoom, newZoom))

        nv.setScale(newZoom)

        // Notify the viewport-aware system. Since we stopped propagation,
        // the passive wheel listener from _hookViewportEvents won't fire,
        // so we call this directly.
        this._handleViewportInteractionEnd(nv)
      },
      { capture: true, signal: controller.signal },
    )
  }

  /**
   * Remove the 3D zoom override wheel listener from a NV instance.
   */
  private _unhookZoomOverride(_nv: Niivue, state: AttachedNiivueState): void {
    if (state.zoomOverrideAbortController) {
      state.zoomOverrideAbortController.abort()
      state.zoomOverrideAbortController = undefined
    }
  }

  /**
   * Called at the end of any viewport interaction (mouse up, touch end,
   * zoom change, scroll wheel). Debounces the viewport bounds recomputation.
   */
  private _handleViewportInteractionEnd(_nv: Niivue): void {
    if (!this._viewportAwareEnabled) return

    // Debounce: clear any pending update and schedule a new one
    if (this._viewportUpdateTimeout) {
      clearTimeout(this._viewportUpdateTimeout)
    }
    this._viewportUpdateTimeout = setTimeout(() => {
      this._viewportUpdateTimeout = null
      this._recomputeViewportBounds()
    }, OMEZarrNVImage.VIEWPORT_DEBOUNCE_MS)
  }

  /**
   * Recompute viewport bounds from all attached NV instances and trigger
   * resolution reselection if bounds changed significantly.
   */
  private _recomputeViewportBounds(): void {
    if (!this._viewportAwareEnabled) return

    // Compute separate viewport bounds for:
    // - 3D volume: union of all RENDER/MULTIPLANAR NV viewport bounds
    // - Per-slab: each slab type gets its own NV's viewport bounds
    let new3DBounds: VolumeBounds | null = null
    const newSlabBounds = new Map<SlabSliceType, VolumeBounds | null>()

    for (const [nv, state] of this._attachedNiivues) {
      if (
        state.currentSliceType === SLICE_TYPE.RENDER ||
        state.currentSliceType === SLICE_TYPE.MULTIPLANAR
      ) {
        // 3D render mode: compute from orthographic frustum
        const nvBounds = computeViewportBounds3D(nv, this._volumeBounds)
        if (!new3DBounds) {
          new3DBounds = nvBounds
        } else {
          // Union of multiple 3D views
          new3DBounds = {
            min: [
              Math.min(new3DBounds.min[0], nvBounds.min[0]),
              Math.min(new3DBounds.min[1], nvBounds.min[1]),
              Math.min(new3DBounds.min[2], nvBounds.min[2]),
            ],
            max: [
              Math.max(new3DBounds.max[0], nvBounds.max[0]),
              Math.max(new3DBounds.max[1], nvBounds.max[1]),
              Math.max(new3DBounds.max[2], nvBounds.max[2]),
            ],
          }
        }
      } else if (this._isSlabSliceType(state.currentSliceType)) {
        // 2D slice mode: compute from pan/zoom
        const sliceType = state.currentSliceType as SlabSliceType
        const slabState = this._slabBuffers.get(sliceType)
        const normScale = slabState?.normalizationScale ?? 1.0
        const nvBounds = computeViewportBounds2D(
          nv,
          state.currentSliceType,
          this._volumeBounds,
          normScale,
        )
        newSlabBounds.set(sliceType, nvBounds)
      }
    }

    // Check if 3D bounds changed
    const bounds3DChanged =
      !new3DBounds !== !this._viewportBounds3D ||
      (new3DBounds &&
        this._viewportBounds3D &&
        !boundsApproxEqual(new3DBounds, this._viewportBounds3D))

    // Check if any slab bounds changed
    let slabBoundsChanged = false
    for (const [sliceType, newBounds] of newSlabBounds) {
      const oldBounds = this._viewportBoundsPerSlab.get(sliceType) ?? null
      if (
        !newBounds !== !oldBounds ||
        (newBounds && oldBounds && !boundsApproxEqual(newBounds, oldBounds))
      ) {
        slabBoundsChanged = true
        break
      }
    }

    if (!bounds3DChanged && !slabBoundsChanged) return

    // Update stored bounds
    this._viewportBounds3D = new3DBounds
    for (const [sliceType, bounds] of newSlabBounds) {
      this._viewportBoundsPerSlab.set(sliceType, bounds)
    }

    // Recompute 3D resolution selection with new 3D viewport bounds
    if (bounds3DChanged) {
      const selection = selectResolution(
        this.multiscales,
        this.maxPixels,
        this._clipPlanes,
        this._volumeBounds,
        this._viewportBounds3D ?? undefined,
      )

      if (selection.levelIndex !== this.targetLevelIndex) {
        this.targetLevelIndex = selection.levelIndex
        // Spatial region changed — cached time frames are stale
        this._invalidateTimeFrameCache()
        this.populateVolume(true, "viewportChanged")
      }
    }

    // Reload slabs with new per-slab viewport bounds
    if (slabBoundsChanged) {
      this._reloadAllSlabs("viewportChanged")
    }
  }

  /**
   * Reload all active slabs (for all slice types that have buffers).
   */
  private _reloadAllSlabs(trigger: PopulateTrigger): void {
    for (const [sliceType, slabState] of this._slabBuffers) {
      // Find the world coordinate for this slab from any attached NV in this mode
      for (const [nv, attachedState] of this._attachedNiivues) {
        if (
          this._isSlabSliceType(attachedState.currentSliceType) &&
          (attachedState.currentSliceType as SlabSliceType) === sliceType
        ) {
          const crosshairPos = nv.scene?.crosshairPos
          if (!crosshairPos || nv.volumes.length === 0) continue
          try {
            const mm = nv.frac2mm([
              crosshairPos[0],
              crosshairPos[1],
              crosshairPos[2],
            ])
            // frac2mm returns values in the slab NVImage's mm space, which
            // is normalized (world * normalizationScale). Convert back to
            // physical world coordinates for worldToPixel and other callers.
            const ns = slabState.normalizationScale
            const worldCoord: [number, number, number] = [
              mm[0] / ns,
              mm[1] / ns,
              mm[2] / ns,
            ]
            this._debouncedSlabReload(sliceType, worldCoord, trigger)
          } catch {
            // Can't convert coordinates yet
          }
          break
        }
      }
    }
  }

  /**
   * Get whether the image is currently loading.
   */
  getIsLoading(): boolean {
    return this.isLoading
  }

  /**
   * Wait for all async work to settle: debounced timers (clip plane
   * refetch, viewport update, slab reload), the main `populateVolume`
   * pipeline, all slab loads, and in-flight coalescer fetches.
   *
   * The method polls in a loop because debounced timers may fire while
   * we are waiting, triggering new loads. It only resolves once every
   * source of async work is idle simultaneously.
   */
  async waitForIdle(): Promise<void> {
    // Polling interval for active-load checks (ms).
    const POLL_MS = 50

    while (true) {
      // ---- Debounced timers ----
      // Wait for pending debounce timers to fire (and potentially
      // trigger new loads) before checking load state.

      if (this.clipPlaneRefetchTimeout !== null) {
        await new Promise<void>((r) =>
          setTimeout(r, this.clipPlaneDebounceMs + POLL_MS),
        )
        continue
      }

      if (this._viewportUpdateTimeout !== null) {
        await new Promise<void>((r) =>
          setTimeout(r, OMEZarrNVImage.VIEWPORT_DEBOUNCE_MS + POLL_MS),
        )
        continue
      }

      if (this._slabReloadTimeouts.size > 0) {
        // Slab reload debounce is 100 ms (hardcoded in
        // _debouncedSlabReload).
        await new Promise<void>((r) => setTimeout(r, 100 + POLL_MS))
        continue
      }

      // ---- Active loads ----

      if (this.isLoading || this._pendingPopulateRequest !== null) {
        await new Promise<void>((r) => setTimeout(r, POLL_MS))
        continue
      }

      let slabBusy = false
      for (const slabState of this._slabBuffers.values()) {
        if (slabState.isLoading || slabState.pendingReload !== null) {
          slabBusy = true
          break
        }
      }
      if (slabBusy) {
        await new Promise<void>((r) => setTimeout(r, POLL_MS))
        continue
      }

      // ---- In-flight fetches ----

      await this.coalescer.onIdle()

      // ---- Convergence check ----
      // A debounce timer or pending request may have appeared while we
      // were awaiting the coalescer. If so, loop again.

      const stillBusy =
        this.isLoading ||
        this._pendingPopulateRequest !== null ||
        this.clipPlaneRefetchTimeout !== null ||
        this._viewportUpdateTimeout !== null ||
        this._slabReloadTimeouts.size > 0 ||
        Array.from(this._slabBuffers.values()).some(
          (s) => s.isLoading || s.pendingReload !== null,
        )

      if (!stillBusy) break
    }
  }

  // ============================================================
  // OMERO Metadata (Visualization Parameters)
  // ============================================================

  /**
   * Get OMERO metadata (if available).
   *
   * Returns the existing OMERO metadata from the OME-Zarr file,
   * or the computed OMERO metadata if none was present in the file.
   *
   * OMERO metadata includes per-channel visualization parameters:
   * - window.min/max: The actual data range
   * - window.start/end: The display window (based on quantiles)
   * - color: Hex color for the channel
   * - label: Channel name
   *
   * @returns OMERO metadata or undefined if not yet loaded/computed
   */
  getOmero(): Omero | undefined {
    return this._omero
  }

  /**
   * Get the active channel index used for OMERO window selection.
   *
   * For multi-channel images, this determines which channel's
   * cal_min/cal_max values are applied to the NiiVue display.
   *
   * @returns Current active channel index (0-based)
   */
  getActiveChannel(): number {
    return this._activeChannel
  }

  /**
   * Set the active channel for OMERO window selection.
   *
   * For multi-channel images, this determines which channel's
   * window (cal_min/cal_max) values are applied to the NiiVue display.
   *
   * Changing the active channel immediately updates the display intensity
   * range and refreshes the NiiVue rendering.
   *
   * @param index - Channel index (0-based)
   * @throws Error if no OMERO metadata is available
   * @throws Error if index is out of range
   *
   * @example
   * ```typescript
   * // Get number of channels
   * const omero = image.getOmero();
   * if (omero) {
   *   console.log(`${omero.channels.length} channels available`);
   *   // Switch to channel 1
   *   image.setActiveChannel(1);
   * }
   * ```
   */
  setActiveChannel(index: number): void {
    if (!this._omero?.channels?.length) {
      throw new Error("No OMERO metadata available")
    }
    if (index < 0 || index >= this._omero.channels.length) {
      throw new Error(
        `Invalid channel index: ${index} (have ${this._omero.channels.length} channels)`,
      )
    }
    this._activeChannel = index
    this.applyOmeroToHeader()
    this.niivue.updateGLVolume()
    this._widenCalRangeIfNeeded(this)
  }

  // ============================================================
  // Multi-NV / Slab Buffer Management
  // ============================================================

  /**
   * Attach a Niivue instance for slice-type-aware rendering.
   *
   * The image auto-detects the NV's current slice type and hooks into
   * `onOptsChange` to track mode changes and `onLocationChange` to track
   * crosshair/slice position changes.
   *
   * When the NV is in a 2D slice mode (Axial, Coronal, Sagittal), the image
   * loads a slab (one chunk thick in the orthogonal direction) at the current
   * slice position, using a 2D pixel budget for resolution selection.
   *
   * @param nv - The Niivue instance to attach
   */
  attachNiivue(nv: Niivue): void {
    if (this._attachedNiivues.has(nv)) return // Already attached

    const state: AttachedNiivueState = {
      nv,
      currentSliceType: this._detectSliceType(nv),
      previousOnLocationChange: nv.onLocationChange,
      previousOnOptsChange:
        nv.onOptsChange as AttachedNiivueState["previousOnOptsChange"],
    }

    // Hook onOptsChange to detect slice type changes
    nv.onOptsChange = (
      propertyName: string,
      newValue: unknown,
      oldValue: unknown,
    ) => {
      // Chain to previous handler
      if (state.previousOnOptsChange) {
        state.previousOnOptsChange(propertyName, newValue, oldValue)
      }
      if (propertyName === "sliceType") {
        this._handleSliceTypeChange(nv, newValue as SLICE_TYPE)
      }
    }

    // Hook onLocationChange to detect slice position changes
    nv.onLocationChange = (location: unknown) => {
      // Chain to previous handler
      if (state.previousOnLocationChange) {
        state.previousOnLocationChange(location)
      }
      this._handleLocationChange(nv, location)
    }

    this._attachedNiivues.set(nv, state)

    // Hook viewport events if viewport-aware mode is already enabled
    if (this._viewportAwareEnabled) {
      this._hookViewportEvents(nv, state)
    }

    // Override NiiVue's hardcoded 3D zoom clamp (always-on)
    this._hookZoomOverride(nv, state)

    // If the NV is already in a 2D slice mode, set up the slab buffer
    const sliceType = state.currentSliceType
    if (this._isSlabSliceType(sliceType)) {
      this._ensureSlabForNiivue(nv, sliceType as SlabSliceType)
    }
  }

  /**
   * Detach a Niivue instance, restoring its original callbacks.
   *
   * @param nv - The Niivue instance to detach
   */
  detachNiivue(nv: Niivue): void {
    const state = this._attachedNiivues.get(nv)
    if (!state) return

    // Unhook viewport events if active
    this._unhookViewportEvents(nv, state)

    // Unhook 3D zoom override
    this._unhookZoomOverride(nv, state)

    // Restore original callbacks
    nv.onLocationChange = state.previousOnLocationChange ?? (() => {})
    nv.onOptsChange = (state.previousOnOptsChange ??
      (() => {})) as typeof nv.onOptsChange

    this._attachedNiivues.delete(nv)
  }

  /**
   * Get the slab buffer state for a given slice type, if it exists.
   * Useful for testing and inspection.
   *
   * @param sliceType - The slice type to query
   * @returns The slab buffer state, or undefined if not yet created
   */
  getSlabBufferState(sliceType: SlabSliceType): SlabBufferState | undefined {
    return this._slabBuffers.get(sliceType)
  }

  /**
   * Get all attached Niivue instances.
   */
  getAttachedNiivues(): Niivue[] {
    return Array.from(this._attachedNiivues.keys())
  }

  // ---- Private slab helpers ----

  /**
   * Detect the current slice type of a Niivue instance.
   */
  private _detectSliceType(nv: Niivue): SLICE_TYPE {
    // Access the opts.sliceType via the scene data or fall back to checking
    // the convenience properties. Niivue stores the current sliceType in opts.
    // We can read it from the NV instance's internal opts.
    const { sliceType } = nv.opts
    if (typeof sliceType === "number") {
      return sliceType
    }
    // Default to Render
    return SLICE_TYPE.RENDER
  }

  /**
   * Check if a slice type is one of the 2D slab types.
   */
  private _isSlabSliceType(st: SLICE_TYPE): st is SlabSliceType {
    return (
      st === SLICE_TYPE.AXIAL ||
      st === SLICE_TYPE.CORONAL ||
      st === SLICE_TYPE.SAGITTAL
    )
  }

  /**
   * Get the NGFF array axis index that is orthogonal to a slice plane.
   *
   * NiiVue slice types refer to anatomical planes:
   * - Axial: perpendicular to S/I (physicalRow 2)
   * - Coronal: perpendicular to A/P (physicalRow 1)
   * - Sagittal: perpendicular to R/L (physicalRow 0)
   *
   * When the dataset has permuted axes (e.g. NGFF y encodes S/I instead
   * of A/P), the NGFF array axis that is orthogonal to a given anatomical
   * plane differs from the default z/y/x mapping. This method uses the
   * orientation metadata to find the correct NGFF axis.
   *
   * Returns index in [z, y, x] order (0=z, 1=y, 2=x).
   */
  private _getOrthogonalAxis(sliceType: SlabSliceType): OrthogonalAxis {
    // Which physical (RAS) row is perpendicular to this slice plane?
    let targetRow: 0 | 1 | 2
    switch (sliceType) {
      case SLICE_TYPE.AXIAL:
        targetRow = 2 // S/I
        break
      case SLICE_TYPE.CORONAL:
        targetRow = 1 // A/P
        break
      case SLICE_TYPE.SAGITTAL:
        targetRow = 0 // R/L
        break
    }

    const orientations = this.multiscales.images[0]?.axesOrientations
    const mapping = getOrientationMapping(orientations)

    // Find which NGFF axis maps to targetRow.
    // mapping.x/y/z have physicalRow; NGFF indices: x=2, y=1, z=0
    if (mapping.z.physicalRow === targetRow) return 0
    if (mapping.y.physicalRow === targetRow) return 1
    return 2
  }

  /**
   * Handle a slice type change on an attached Niivue instance.
   */
  private _handleSliceTypeChange(nv: Niivue, newSliceType: SLICE_TYPE): void {
    const state = this._attachedNiivues.get(nv)
    if (!state) return

    const oldSliceType = state.currentSliceType
    state.currentSliceType = newSliceType

    if (oldSliceType === newSliceType) return

    if (this._isSlabSliceType(newSliceType)) {
      // Switching TO a 2D slab mode: swap in the slab NVImage
      this._ensureSlabForNiivue(nv, newSliceType as SlabSliceType)
    } else {
      // Switching TO Render or Multiplanar mode: swap back to the main (3D) NVImage
      this._swapVolumeInNiivue(nv, this as NVImage)
    }
  }

  /**
   * Handle location (crosshair) change on an attached Niivue instance.
   * Checks if the current slice position has moved outside the loaded slab.
   */
  private _handleLocationChange(nv: Niivue, _location: unknown): void {
    const state = this._attachedNiivues.get(nv)
    if (!state || !this._isSlabSliceType(state.currentSliceType)) return

    const sliceType = state.currentSliceType as SlabSliceType
    const slabState = this._slabBuffers.get(sliceType)
    if (!slabState || slabState.slabStart < 0) return // Slab not yet created or loaded

    // Get the current crosshair position in fractional coordinates [0..1]
    const crosshairPos = nv.scene?.crosshairPos
    if (!crosshairPos || nv.volumes.length === 0) return

    let worldCoord: [number, number, number]
    try {
      const mm = nv.frac2mm([crosshairPos[0], crosshairPos[1], crosshairPos[2]])
      // frac2mm returns values in the slab NVImage's normalized mm space
      // (world * normalizationScale). Convert back to physical world.
      const ns = slabState.normalizationScale
      worldCoord = [mm[0] / ns, mm[1] / ns, mm[2] / ns]
    } catch {
      return // Can't convert coordinates yet
    }

    // Convert world to pixel at the slab's current resolution level.
    // Must use the full oriented affine (not the naive scale+translation)
    // because worldCoord is in oriented (NIfTI RAS) space.
    const ngffImage = this.multiscales.images[slabState.levelIndex]
    const orientedAffine = createAffineFromNgffImage(ngffImage)
    const pixelCoord = worldToPixelAffine(worldCoord, orientedAffine)

    // Check the orthogonal axis
    const orthAxis = this._getOrthogonalAxis(sliceType)
    const pixelPos = pixelCoord[orthAxis]

    // Is the pixel position outside the currently loaded slab?
    if (pixelPos < slabState.slabStart || pixelPos >= slabState.slabEnd) {
      // Need to reload the slab for the new position
      this._debouncedSlabReload(sliceType, worldCoord)
    }
  }

  /**
   * Debounced slab reload to avoid excessive reloading during scrolling.
   */
  private _debouncedSlabReload(
    sliceType: SlabSliceType,
    worldCoord: [number, number, number],
    trigger: PopulateTrigger = "sliceChanged",
  ): void {
    // Clear any pending reload for this slice type
    const existing = this._slabReloadTimeouts.get(sliceType)
    if (existing) clearTimeout(existing)

    const timeout = setTimeout(() => {
      this._slabReloadTimeouts.delete(sliceType)
      void this._loadSlab(sliceType, worldCoord, trigger)
    }, 100) // Short debounce for slice scrolling (faster than clip plane debounce)

    this._slabReloadTimeouts.set(sliceType, timeout)
  }

  /**
   * Ensure a slab buffer exists and is loaded for the given NV + slice type.
   * If needed, creates the slab buffer and triggers an initial load.
   */
  private _ensureSlabForNiivue(nv: Niivue, sliceType: SlabSliceType): void {
    let slabState = this._slabBuffers.get(sliceType)

    if (!slabState) {
      // Lazily create the slab buffer
      slabState = this._createSlabBuffer(sliceType)
      this._slabBuffers.set(sliceType, slabState)
    }

    // Capture the crosshair world position BEFORE swapping volumes.
    // frac2mm() uses the current volume's affine, so it must run while
    // the 3D (or previous slab) NVImage is still attached. After the swap,
    // the 1×1×1 placeholder's identity affine would produce incorrect
    // coordinates.
    let worldCoord: [number, number, number]
    try {
      const crosshairPos = nv.scene?.crosshairPos
      if (crosshairPos && nv.volumes.length > 0) {
        const mm = nv.frac2mm([
          crosshairPos[0],
          crosshairPos[1],
          crosshairPos[2],
        ])
        worldCoord = [mm[0], mm[1], mm[2]]
      } else {
        // Fall back to volume center
        worldCoord = [
          (this._volumeBounds.min[0] + this._volumeBounds.max[0]) / 2,
          (this._volumeBounds.min[1] + this._volumeBounds.max[1]) / 2,
          (this._volumeBounds.min[2] + this._volumeBounds.max[2]) / 2,
        ]
      }
    } catch {
      // Fall back to volume center if frac2mm fails
      worldCoord = [
        (this._volumeBounds.min[0] + this._volumeBounds.max[0]) / 2,
        (this._volumeBounds.min[1] + this._volumeBounds.max[1]) / 2,
        (this._volumeBounds.min[2] + this._volumeBounds.max[2]) / 2,
      ]
    }

    // Swap the slab's NVImage into this NV instance (after capturing coords)
    this._swapVolumeInNiivue(nv, slabState.nvImage)

    void this._loadSlab(sliceType, worldCoord, "initial").catch((err) => {
      console.error(
        `[fidnii] Error loading slab for ${SLICE_TYPE[sliceType]}:`,
        err,
      )
    })
  }

  /**
   * Create a new slab buffer state for a slice type.
   */
  private _createSlabBuffer(sliceType: SlabSliceType): SlabBufferState {
    const componentsPerVoxel = this._channelInfo?.components ?? 1
    const bufferManager = new BufferManager(
      this.maxPixels,
      this.dtype,
      componentsPerVoxel,
    )
    const nvImage = new NVImage()

    // Initialize with placeholder NIfTI header (same as main image setup)
    const hdr = new NIFTI1()
    nvImage.hdr = hdr
    hdr.dims = [3, 1, 1, 1, 1, 1, 1, 1]
    if (this._channelInfo && isRGBImage(this.multiscales.images[0])) {
      const rgbCode = getRGBNiftiDataType(this._channelInfo)
      hdr.datatypeCode = rgbCode
      hdr.numBitsPerVoxel = rgbCode === NiftiDataType.RGB24 ? 24 : 32
    } else {
      hdr.datatypeCode = getNiftiDataType(this.dtype)
      hdr.numBitsPerVoxel = getBytesPerPixel(this.dtype) * 8
    }
    hdr.pixDims = [1, 1, 1, 1, 0, 0, 0, 0]
    hdr.affine = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]
    hdr.sform_code = 1
    nvImage.name = `${this.name ?? "OME-Zarr"} [${SLICE_TYPE[sliceType]}]`
    nvImage.img = bufferManager.resize([1, 1, 1]) as NVImage["img"]
    if (!this.isLabelImage) {
      nvImage._colormap = this._colormap || "gray"
    }
    nvImage._opacity = 1.0

    // Select initial resolution using 2D pixel budget
    const orthAxis = this._getOrthogonalAxis(sliceType)
    const selection = select2DResolution(
      this.multiscales,
      this.maxPixels,
      this._clipPlanes,
      this._volumeBounds,
      orthAxis,
    )

    return {
      nvImage,
      bufferManager,
      levelIndex: this.multiscales.images.length - 1, // Start at lowest
      targetLevelIndex: selection.levelIndex,
      slabStart: -1,
      slabEnd: -1,
      isLoading: false,
      dtype: this.dtype,
      normalizationScale: 1.0, // Updated on first slab load
      pendingReload: null,
    }
  }

  /**
   * Swap the NVImage in a Niivue instance's volume list.
   * Removes any existing volumes from this OMEZarrNVImage and adds the target.
   */
  private _swapVolumeInNiivue(nv: Niivue, targetVolume: NVImage): void {
    // Find and remove any volumes we own (the main image or any slab NVImages)
    const ourVolumes = new Set<NVImage>([this as NVImage])
    for (const slab of this._slabBuffers.values()) {
      ourVolumes.add(slab.nvImage)
    }

    // Remove our volumes from nv (in reverse to avoid index shifting issues)
    const toRemove = nv.volumes.filter((v) => ourVolumes.has(v))
    for (const vol of toRemove) {
      try {
        nv.removeVolume(vol)
      } catch {
        // Ignore errors during removal (volume may not be fully initialized)
      }
    }

    // Add the target volume if not already present
    if (!nv.volumes.includes(targetVolume)) {
      try {
        nv.addVolume(targetVolume)
      } catch (err) {
        console.warn("[fidnii] Failed to add volume to NV:", err)
        return
      }
    }

    try {
      nv.updateGLVolume()
      this._widenCalRangeIfNeeded(targetVolume)
    } catch {
      // May fail if GL context not ready
    }
  }

  /**
   * Load a slab for a 2D slice type at the given world position.
   *
   * The slab is one chunk thick in the orthogonal direction and uses
   * the full in-plane extent (respecting clip planes).
   *
   * Loading follows a progressive strategy: preview (lowest res) then target.
   * For viewport-triggered reloads, progressive rendering is skipped and
   * only the target level is loaded (the user already sees the previous
   * resolution, so a single jump is smoother).
   *
   * If a load is already in progress, the request is queued (latest-wins)
   * and automatically drained when the current load finishes.
   */
  private async _loadSlab(
    sliceType: SlabSliceType,
    worldCoord: [number, number, number],
    trigger: PopulateTrigger,
  ): Promise<void> {
    const slabState = this._slabBuffers.get(sliceType)
    if (!slabState) return

    if (slabState.isLoading) {
      // Queue this request (latest wins) — auto-drained when current load finishes
      slabState.pendingReload = { worldCoord, trigger }
      // Abort the in-flight progressive load so it finishes faster
      const controller = this._slabAbortControllers.get(sliceType)
      if (controller) controller.abort()
      return
    }

    slabState.isLoading = true
    slabState.pendingReload = null

    // Create an AbortController for this load so it can be cancelled if a
    // newer request arrives while we're still fetching intermediate levels.
    const abortController = new AbortController()
    this._slabAbortControllers.set(sliceType, abortController)

    this._emitEvent("slabLoadingStart", {
      sliceType,
      levelIndex: slabState.targetLevelIndex,
      trigger,
    })

    try {
      const orthAxis = this._getOrthogonalAxis(sliceType)

      // Recompute target resolution using 2D pixel budget with per-slab viewport bounds
      const slabViewportBounds =
        this._viewportBoundsPerSlab.get(sliceType) ?? undefined
      const selection = select2DResolution(
        this.multiscales,
        this.maxPixels,
        this._clipPlanes,
        this._volumeBounds,
        orthAxis,
        slabViewportBounds,
      )
      slabState.targetLevelIndex = selection.levelIndex

      const numLevels = this.multiscales.images.length
      const lowestLevel = numLevels - 1

      // For viewport-triggered reloads, skip progressive rendering — jump
      // straight to the target level. The user already sees the previous
      // resolution, so a single update is smoother than replaying the full
      // progressive sequence which causes visual flicker during rapid
      // zoom/pan interactions.
      const skipProgressive = trigger === "viewportChanged"
      const startLevel = skipProgressive
        ? slabState.targetLevelIndex
        : lowestLevel

      for (
        let level = startLevel;
        level >= slabState.targetLevelIndex;
        level--
      ) {
        // Check if this load has been superseded by a newer request
        if (abortController.signal.aborted) break

        await this._loadSlabAtLevel(
          slabState,
          sliceType,
          worldCoord,
          level,
          orthAxis,
          trigger,
        )

        // Check again after the async fetch completes
        if (abortController.signal.aborted) break

        slabState.levelIndex = level

        // Yield to the browser so the current level is actually painted before
        // we start fetching the next (higher-resolution) level.
        if (level > slabState.targetLevelIndex) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          )
        }
      }
    } finally {
      slabState.isLoading = false

      this._emitEvent("slabLoadingComplete", {
        sliceType,
        levelIndex: slabState.levelIndex,
        slabStart: slabState.slabStart,
        slabEnd: slabState.slabEnd,
        trigger,
      })

      // Auto-drain: if a newer request was queued while we were loading,
      // start it now (like populateVolume's handlePendingPopulateRequest).
      this._handlePendingSlabReload(sliceType)
    }
  }

  /**
   * Process any pending slab reload request after the current load completes.
   * Mirrors populateVolume's handlePendingPopulateRequest pattern.
   */
  private _handlePendingSlabReload(sliceType: SlabSliceType): void {
    const slabState = this._slabBuffers.get(sliceType)
    if (!slabState) return

    const pending = slabState.pendingReload
    if (pending) {
      slabState.pendingReload = null
      void this._loadSlab(sliceType, pending.worldCoord, pending.trigger)
    }
  }

  /**
   * Load slab data at a specific resolution level.
   */
  private async _loadSlabAtLevel(
    slabState: SlabBufferState,
    sliceType: SlabSliceType,
    worldCoord: [number, number, number],
    levelIndex: number,
    orthAxis: OrthogonalAxis,
    _trigger: PopulateTrigger,
  ): Promise<void> {
    const ngffImage = this.multiscales.images[levelIndex]
    const chunkShape = getChunkShape(ngffImage)
    const volumeShape = getVolumeShape(ngffImage)

    // Convert world position to pixel position at this level.
    // Must use the full oriented affine because worldCoord is in oriented
    // (NIfTI RAS) space, not raw NGFF scale+translation space.
    const orientedAffine = createAffineFromNgffImage(ngffImage)
    const pixelCoord = worldToPixelAffine(worldCoord, orientedAffine)
    const orthPixel = pixelCoord[orthAxis]

    // Find the chunk-aligned slab in the orthogonal axis
    const chunkSize = chunkShape[orthAxis]
    const slabStart = Math.max(0, Math.floor(orthPixel / chunkSize) * chunkSize)
    const slabEnd = Math.min(slabStart + chunkSize, volumeShape[orthAxis])

    // Get the full in-plane region (respecting clip planes only).
    // Viewport bounds are intentionally NOT passed here — they are used only
    // for resolution selection (in _loadSlab → select2DResolution) so that a
    // higher-res level is chosen when zoomed in.  The fetch region always
    // covers the full in-plane extent so the slab fills the entire viewport.
    const pixelRegion = clipPlanesToPixelRegion(
      this._clipPlanes,
      this._volumeBounds,
      ngffImage,
    )
    const alignedRegion = alignToChunks(pixelRegion, ngffImage)

    // Override the orthogonal axis with our slab extent
    const fetchStart: [number, number, number] = [
      alignedRegion.chunkAlignedStart[0],
      alignedRegion.chunkAlignedStart[1],
      alignedRegion.chunkAlignedStart[2],
    ]
    const fetchEnd: [number, number, number] = [
      alignedRegion.chunkAlignedEnd[0],
      alignedRegion.chunkAlignedEnd[1],
      alignedRegion.chunkAlignedEnd[2],
    ]
    fetchStart[orthAxis] = slabStart
    fetchEnd[orthAxis] = slabEnd

    const fetchedShape: [number, number, number] = [
      fetchEnd[0] - fetchStart[0],
      fetchEnd[1] - fetchStart[1],
      fetchEnd[2] - fetchStart[2],
    ]

    // Fetch the data
    const fetchRegion: PixelRegion = { start: fetchStart, end: fetchEnd }
    const result = await this.coalescer.fetchRegion(
      ngffImage,
      levelIndex,
      fetchRegion,
      `slab-${SLICE_TYPE[sliceType]}-${levelIndex}`,
      this._timeIndex,
    )

    // Resize buffer and copy data
    const targetData = slabState.bufferManager.resize(fetchedShape)
    const normalize = needsRGBNormalization(ngffImage, this.dtype)

    if (normalize && this._channelInfo) {
      // Non-uint8 RGB/RGBA: normalize raw data to uint8 using OMERO windows
      const windows = this._getChannelWindows(
        result.data,
        this._channelInfo.components,
      )
      const normalized = normalizeToUint8(
        result.data,
        this._channelInfo.components,
        windows,
      )
      targetData.set(normalized)
    } else {
      // uint8 RGB or scalar: direct copy
      targetData.set(result.data)
    }

    slabState.nvImage.img =
      slabState.bufferManager.getTypedArray() as NVImage["img"]

    // Update slab position tracking
    slabState.slabStart = slabStart
    slabState.slabEnd = slabEnd

    // Update the NVImage header for this slab region
    this._updateSlabHeader(
      slabState.nvImage,
      ngffImage,
      fetchStart,
      fetchEnd,
      fetchedShape,
    )

    if (this.isLabelImage) {
      // Label images: apply discrete colormap to the slab NVImage
      this._applyLabelColormap(slabState.nvImage, result.data)
    } else if (this._omero && !normalize) {
      // Apply OMERO metadata for scalar / uint8 RGB.
      // Normalized RGB already consumed the OMERO window during normalization.
      this._applyOmeroToSlabHeader(slabState.nvImage)
    }

    // Reset global_min so NiiVue recalculates intensity ranges
    slabState.nvImage.global_min = undefined

    // Compute the normalization scale used by _updateSlabHeader so we can
    // convert the world coordinate into the slab's normalized mm space.
    const scale = ngffImage.scale
    const maxVoxelSize = Math.max(
      scale.x ?? scale.X ?? 1,
      scale.y ?? scale.Y ?? 1,
      scale.z ?? scale.Z ?? 1,
    )
    const normalizationScale = maxVoxelSize > 0 ? 1.0 / maxVoxelSize : 1.0
    slabState.normalizationScale = normalizationScale
    const normalizedMM: [number, number, number] = [
      worldCoord[0] * normalizationScale,
      worldCoord[1] * normalizationScale,
      worldCoord[2] * normalizationScale,
    ]

    // Refresh all NV instances using this slice type
    for (const [attachedNv, attachedState] of this._attachedNiivues) {
      if (
        this._isSlabSliceType(attachedState.currentSliceType) &&
        (attachedState.currentSliceType as SlabSliceType) === sliceType
      ) {
        // Ensure this NV has the slab volume
        if (attachedNv.volumes.includes(slabState.nvImage)) {
          attachedNv.updateGLVolume()

          if (!this.isLabelImage) {
            // Widen the display window if actual data exceeds the OMERO range.
            // Must run after updateGLVolume() which computes global_min/global_max.
            this._widenCalRangeIfNeeded(slabState.nvImage)
          }

          // Position the crosshair at the correct slice within this slab.
          // Without this, NiiVue defaults to the center of the slab which
          // corresponds to different physical positions at each resolution level.
          const frac = attachedNv.mm2frac(normalizedMM)
          // Clamp to [0,1] — when viewport-aware mode constrains the slab to
          // a subregion, the crosshair world position may be outside the slab's
          // spatial extent, causing mm2frac to return out-of-range values.
          frac[0] = Math.max(0, Math.min(1, frac[0]))
          frac[1] = Math.max(0, Math.min(1, frac[1]))
          frac[2] = Math.max(0, Math.min(1, frac[2]))
          attachedNv.scene.crosshairPos = frac
          attachedNv.drawScene()
        }
      }
    }
  }

  /**
   * Update NVImage header for a slab region.
   */
  private _updateSlabHeader(
    nvImage: NVImage,
    ngffImage: NgffImage,
    fetchStart: [number, number, number],
    _fetchEnd: [number, number, number],
    fetchedShape: [number, number, number],
  ): void {
    if (!nvImage.hdr) return

    const scale = ngffImage.scale
    const sx = scale.x ?? scale.X ?? 1
    const sy = scale.y ?? scale.Y ?? 1
    const sz = scale.z ?? scale.Z ?? 1

    // NiiVue's 2D slice renderer has precision issues when voxel sizes are
    // very small (e.g. OME-Zarr datasets in meters where pixDims ~ 2e-5).
    // Since the slab NVImage is rendered independently in its own Niivue
    // instance, we can normalize coordinates to ~1mm voxels without affecting
    // the 3D render. We scale uniformly to preserve aspect ratio.
    const maxVoxelSize = Math.max(sx, sy, sz)
    const normalizationScale = maxVoxelSize > 0 ? 1.0 / maxVoxelSize : 1.0
    const nsx = sx * normalizationScale
    const nsy = sy * normalizationScale
    const nsz = sz * normalizationScale

    nvImage.hdr.pixDims = [1, nsx, nsy, nsz, 0, 0, 0, 0]
    // NIfTI dims: [ndim, x, y, z, t, ...]
    nvImage.hdr.dims = [
      3,
      fetchedShape[2],
      fetchedShape[1],
      fetchedShape[0],
      1,
      1,
      1,
      1,
    ]

    // Build the fully oriented affine (including orientation permutation
    // and sign flips), then apply the region offset in world space.
    //
    // The offset must be applied AFTER orientation because the fetch region
    // start is in NGFF voxel space [z, y, x], and the oriented 3x3 rotation
    // matrix is needed to transform that voxel offset into world coordinates.
    // Previously, the offset was applied before orientation which broke when
    // NGFF axes were permuted (e.g. NGFF z → physical A/P axis).
    const affine = createAffineFromNgffImage(ngffImage)

    // Transform the NGFF voxel offset through the oriented 3x3 rotation.
    // fetchStart is [z, y, x]; affine columns map NIfTI [i=x, j=y, k=z]
    // to world, so we need offset in NIfTI [x, y, z] order.
    const offsetX = fetchStart[2] // NIfTI i = NGFF x
    const offsetY = fetchStart[1] // NIfTI j = NGFF y
    const offsetZ = fetchStart[0] // NIfTI k = NGFF z
    // Multiply the 3x3 rotation by the offset vector and add to translation
    affine[12] +=
      affine[0] * offsetX + affine[4] * offsetY + affine[8] * offsetZ
    affine[13] +=
      affine[1] * offsetX + affine[5] * offsetY + affine[9] * offsetZ
    affine[14] +=
      affine[2] * offsetX + affine[6] * offsetY + affine[10] * offsetZ

    // For 2D images, flip y before normalization (composes with orientation)
    if (this._flipY2D && this._is2D) {
      // Get the y axis orientation mapping to find where the y scale is stored
      const mapping = getOrientationMapping(ngffImage.axesOrientations)
      // The y scale is at affine[4 + physicalRow] (column 1, appropriate row)
      const yScaleIndex = 4 + mapping.y.physicalRow
      affine[13] += affine[yScaleIndex] * (fetchedShape[1] - 1)
      affine[yScaleIndex] = -affine[yScaleIndex]
    }

    // Apply normalization to the entire affine (scale columns + translation)
    for (let i = 0; i < 15; i++) {
      affine[i] *= normalizationScale
    }
    // affine[15] stays 1

    const srows = affineToNiftiSrows(affine)
    nvImage.hdr.affine = [
      srows.srow_x,
      srows.srow_y,
      srows.srow_z,
      [0, 0, 0, 1],
    ]

    nvImage.hdr.sform_code = 1
    nvImage.calculateRAS()
  }

  /**
   * Apply OMERO metadata to a slab NVImage header.
   */
  private _applyOmeroToSlabHeader(nvImage: NVImage): void {
    if (!nvImage.hdr || !this._omero?.channels?.length) return

    const channelIndex = Math.min(
      this._activeChannel,
      this._omero.channels.length - 1,
    )
    const channel = this._omero.channels[channelIndex]
    const window = channel?.window

    if (window) {
      const calMin = window.start ?? window.min
      const calMax = window.end ?? window.max
      if (calMin !== undefined) nvImage.hdr.cal_min = calMin
      if (calMax !== undefined) nvImage.hdr.cal_max = calMax
    }
  }

  /**
   * Widen the display intensity range if the actual data exceeds the current
   * cal_min/cal_max window (typically set from OMERO metadata).
   *
   * OMERO window settings may have been computed at a lower resolution where
   * downsampling averaged out extreme voxels. At higher resolutions, individual
   * bright/dark voxels can exceed the OMERO range, causing clipping artifacts
   * (e.g., "banding" where bright structures clip to solid white).
   *
   * Widens cal_min/cal_max to global_min/global_max (actual data extremes at
   * the current resolution level) so no data is clipped. The hdr.cal_min/
   * cal_max values are NOT modified — they preserve the original OMERO values
   * for reuse on subsequent slab reloads.
   *
   * Must be called AFTER updateGLVolume() so that calMinMax() has computed
   * global_min/global_max from the actual slab data.
   *
   * @returns true if the display range was widened
   */
  private _widenCalRangeIfNeeded(nvImage: NVImage): boolean {
    if (nvImage.global_min === undefined || nvImage.global_max === undefined) {
      return false
    }

    let widened = false

    // Widen the runtime display range (cal_min/cal_max) to encompass the
    // actual data extremes (global_min/global_max) at this resolution level.
    // The hdr values are NOT modified so the original OMERO window is
    // preserved for next reload.
    if (nvImage.cal_max !== undefined && nvImage.global_max > nvImage.cal_max) {
      nvImage.cal_max = nvImage.global_max
      widened = true
    }
    if (nvImage.cal_min !== undefined && nvImage.global_min < nvImage.cal_min) {
      nvImage.cal_min = nvImage.global_min
      widened = true
    }

    return widened
  }

  // ============================================================
  // Event System (Browser-native EventTarget API)
  // ============================================================

  /**
   * Add a type-safe event listener for OMEZarrNVImage events.
   *
   * @param type - Event type name
   * @param listener - Event listener function
   * @param options - Standard addEventListener options (once, signal, etc.)
   *
   * @example
   * ```typescript
   * image.addEventListener('resolutionChange', (event) => {
   *   console.log('New level:', event.detail.currentLevel);
   * });
   *
   * // One-time listener
   * image.addEventListener('loadingComplete', handler, { once: true });
   *
   * // With AbortController
   * const controller = new AbortController();
   * image.addEventListener('loadingStart', handler, { signal: controller.signal });
   * controller.abort(); // removes the listener
   * ```
   */
  addEventListener<K extends keyof OMEZarrNVImageEventMap>(
    type: K,
    listener: OMEZarrNVImageEventListener<K>,
    options?: OMEZarrNVImageEventListenerOptions,
  ): void {
    this._eventTarget.addEventListener(type, listener as EventListener, options)
  }

  /**
   * Remove a type-safe event listener for OMEZarrNVImage events.
   *
   * @param type - Event type name
   * @param listener - Event listener function to remove
   * @param options - Standard removeEventListener options
   */
  removeEventListener<K extends keyof OMEZarrNVImageEventMap>(
    type: K,
    listener: OMEZarrNVImageEventListener<K>,
    options?: OMEZarrNVImageEventListenerOptions,
  ): void {
    this._eventTarget.removeEventListener(
      type,
      listener as EventListener,
      options,
    )
  }

  /**
   * Internal helper to emit events.
   * Catches and logs any errors from event listeners to prevent breaking execution.
   */
  private _emitEvent<K extends keyof OMEZarrNVImageEventMap>(
    eventName: K,
    detail: OMEZarrNVImageEventMap[K],
  ): void {
    try {
      const event = new OMEZarrNVImageEvent(eventName, detail)
      this._eventTarget.dispatchEvent(event)
    } catch (error) {
      console.error(`Error in ${eventName} event listener:`, error)
    }
  }
}
