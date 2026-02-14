// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { TypedArray } from "./types.js"

/**
 * Per-channel display window for normalization.
 * Maps source values in `[start, end]` to uint8 `[0, 255]`.
 */
export interface ChannelWindow {
  /** Lower bound of the display window (maps to 0) */
  start: number
  /** Upper bound of the display window (maps to 255) */
  end: number
}

/**
 * Normalize interleaved multi-component data to uint8.
 *
 * Each channel is linearly mapped from its `[start, end]` window to
 * `[0, 255]`, with clamping at both ends. Source data is expected to
 * be interleaved: `[R0, G0, B0, R1, G1, B1, ...]`.
 *
 * @param source - Interleaved multi-component data in any typed array
 * @param components - Number of components per voxel (3 for RGB, 4 for RGBA)
 * @param channelWindows - Per-channel display windows; must have
 *   `components` entries. If fewer are provided, remaining channels use
 *   the last window.
 * @returns A new `Uint8Array` with normalized uint8 values
 *
 * @example
 * ```ts
 * const src = new Uint16Array([0, 32768, 65535, 0, 0, 0])
 * const windows = [
 *   { start: 0, end: 65535 },
 *   { start: 0, end: 65535 },
 *   { start: 0, end: 65535 },
 * ]
 * const result = normalizeToUint8(src, 3, windows)
 * // result ≈ Uint8Array [0, 128, 255, 0, 0, 0]
 * ```
 */
export function normalizeToUint8(
  source: TypedArray,
  components: number,
  channelWindows: ChannelWindow[],
): Uint8Array {
  const len = source.length
  const output = new Uint8Array(len)
  const numVoxels = len / components

  // Pre-compute per-channel scale factors for performance
  const scales = new Float64Array(components)
  const offsets = new Float64Array(components)
  for (let c = 0; c < components; c++) {
    const win = channelWindows[Math.min(c, channelWindows.length - 1)]
    const range = win.end - win.start
    if (range > 0) {
      scales[c] = 255 / range
      offsets[c] = win.start
    } else {
      // Degenerate window: all values map to 0
      scales[c] = 0
      offsets[c] = 0
    }
  }

  for (let v = 0; v < numVoxels; v++) {
    const base = v * components
    for (let c = 0; c < components; c++) {
      const scaled = (source[base + c] - offsets[c]) * scales[c]
      // Clamp to [0, 255] and round
      output[base + c] =
        scaled <= 0 ? 0 : scaled >= 255 ? 255 : (scaled + 0.5) | 0
    }
  }

  return output
}

/**
 * Compute per-channel min/max from interleaved multi-component data.
 *
 * Use this as a fallback when OMERO window metadata is not available.
 * The result can be passed directly to {@link normalizeToUint8}.
 *
 * @param data - Interleaved multi-component data
 * @param components - Number of components per voxel (3 for RGB, 4 for RGBA)
 * @returns Per-channel windows with `start = min` and `end = max`
 */
export function computeChannelMinMax(
  data: TypedArray,
  components: number,
): ChannelWindow[] {
  const windows: ChannelWindow[] = Array.from({ length: components }, () => ({
    start: Infinity,
    end: -Infinity,
  }))

  const numVoxels = data.length / components
  for (let v = 0; v < numVoxels; v++) {
    const base = v * components
    for (let c = 0; c < components; c++) {
      const val = data[base + c]
      if (val < windows[c].start) windows[c].start = val
      if (val > windows[c].end) windows[c].end = val
    }
  }

  // Handle empty data: set degenerate windows to [0, 0]
  for (let c = 0; c < components; c++) {
    if (windows[c].start === Infinity) {
      windows[c].start = 0
      windows[c].end = 0
    }
  }

  return windows
}
