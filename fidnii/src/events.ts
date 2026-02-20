// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { SLICE_TYPE } from "@niivue/niivue"

import type { ClipPlanes } from "./types.js"

/**
 * Identifies what triggered a volume population.
 * Extensible for future triggers (pan, zoom, etc.)
 */
export type PopulateTrigger =
  | "initial" // First load or reload with new settings
  | "clipPlanesChanged" // Clip planes were modified
  | "sliceChanged" // Slice position changed (slab reload)
  | "viewportChanged" // Viewport pan/zoom/rotation changed

/**
 * Type-safe event map for OMEZarrNVImage events.
 * Maps event names to their detail types.
 *
 * Uses the browser-native EventTarget API pattern, following the same
 * conventions as NiiVue's event system (see niivue/niivue#1530).
 *
 * @example
 * ```typescript
 * // Type-safe event listening
 * image.addEventListener('resolutionChange', (event) => {
 *   console.log('Resolution changed:', event.detail.currentLevel);
 * });
 *
 * // One-time listener
 * image.addEventListener('loadingComplete', (event) => {
 *   console.log('Loaded level:', event.detail.levelIndex);
 * }, { once: true });
 *
 * // Using AbortController to remove multiple listeners
 * const controller = new AbortController();
 * image.addEventListener('loadingStart', handler1, { signal: controller.signal });
 * image.addEventListener('loadingComplete', handler2, { signal: controller.signal });
 * controller.abort(); // removes both listeners
 * ```
 */
export interface OMEZarrNVImageEventMap {
  /** Fired when loading starts for a resolution level */
  loadingStart: {
    levelIndex: number
    trigger: PopulateTrigger
  }

  /** Fired when loading completes for a resolution level */
  loadingComplete: {
    levelIndex: number
    trigger: PopulateTrigger
  }

  /**
   * Fired when resolution level changes.
   * This happens during progressive loading or when clip planes
   * cause a resolution change.
   */
  resolutionChange: {
    currentLevel: number
    targetLevel: number
    previousLevel: number
    trigger: PopulateTrigger
  }

  /**
   * Fired when clip planes are updated (after debounce).
   * This is emitted after the debounce delay, not on every slider movement.
   */
  clipPlanesChange: { clipPlanes: ClipPlanes }

  /**
   * Fired when populateVolume() completes and no more requests are queued.
   * This is the final event after all loading is done.
   */
  populateComplete: {
    currentLevel: number
    targetLevel: number
    trigger: PopulateTrigger
  }

  /**
   * Fired when a queued load request is replaced by a newer one.
   * This only fires when a pending request is overwritten, not when
   * the first request is queued.
   */
  loadingSkipped: {
    reason: "queued-replaced"
    trigger: PopulateTrigger
  }

  /**
   * Fired when a slab (2D slice buffer) finishes loading.
   * This event is specific to slab-based loading for 2D slice views.
   */
  slabLoadingComplete: {
    sliceType: SLICE_TYPE
    levelIndex: number
    slabStart: number
    slabEnd: number
    trigger: PopulateTrigger
  }

  /**
   * Fired when a slab starts loading.
   */
  slabLoadingStart: {
    sliceType: SLICE_TYPE
    levelIndex: number
    trigger: PopulateTrigger
  }

  /**
   * Fired when the active time index changes.
   *
   * The `cached` flag indicates whether the frame was served instantly
   * from the pre-fetch cache (`true`) or required a fresh zarr fetch
   * (`false`).
   */
  timeChange: {
    /** New time index (0-based) */
    index: number
    /** Physical time value at the new index */
    timeValue: number
    /** Previous time index */
    previousIndex: number
    /** `true` if the frame was served from the pre-fetch cache */
    cached: boolean
  }
}

/**
 * Type-safe event class for OMEZarrNVImage events.
 * Extends CustomEvent with typed detail property.
 */
export class OMEZarrNVImageEvent<
  K extends keyof OMEZarrNVImageEventMap,
> extends CustomEvent<OMEZarrNVImageEventMap[K]> {
  constructor(type: K, detail: OMEZarrNVImageEventMap[K]) {
    super(type, { detail })
  }
}

/**
 * Type-safe event listener for OMEZarrNVImage events.
 * Listeners can be synchronous or asynchronous.
 */
export type OMEZarrNVImageEventListener<
  K extends keyof OMEZarrNVImageEventMap,
> = (event: OMEZarrNVImageEvent<K>) => void | Promise<void>

/**
 * Options for addEventListener/removeEventListener.
 * Supports all standard EventTarget options including:
 * - capture: boolean - Use capture phase
 * - once: boolean - Remove listener after first invocation
 * - passive: boolean - Listener will never call preventDefault()
 * - signal: AbortSignal - Remove listener when signal is aborted
 */
export type OMEZarrNVImageEventListenerOptions =
  | boolean
  | AddEventListenerOptions
