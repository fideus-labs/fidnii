// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

/**
 * Load TIFF files (OME-TIFF, pyramidal, plain) and produce a
 * {@link Multiscales} object ready for {@link OMEZarrNVImage.create}.
 *
 * Uses {@link https://github.com/fideus-labs/fiff | @fideus-labs/fiff}
 * to present TIFFs as zarrita-compatible stores, then delegates to
 * {@link fromNgffZarr} for OME-Zarr metadata parsing.
 */

import type { TiffStoreOptions } from "@fideus-labs/fiff"
import { TiffStore } from "@fideus-labs/fiff"
import type { Multiscales } from "@fideus-labs/ngff-zarr"
import type { FromNgffZarrOptions } from "@fideus-labs/ngff-zarr/browser"
import { fromNgffZarr } from "@fideus-labs/ngff-zarr/browser"
import type { Readable } from "zarrita"

/** Options for {@link fromTiff}. */
export interface FromTiffOptions {
  /** Options forwarded to {@link TiffStore} (e.g. IFD offsets, HTTP headers). */
  tiff?: TiffStoreOptions
  /** Options forwarded to {@link fromNgffZarr} (e.g. validate, cache). */
  ngffZarr?: Omit<FromNgffZarrOptions, "version">
}

/**
 * Load a TIFF file and return a {@link Multiscales} object ready for
 * {@link OMEZarrNVImage.create}.
 *
 * Supports OME-TIFF, pyramidal TIFF (SubIFDs / legacy / COG), and
 * plain single-image TIFFs. Both local (Blob/ArrayBuffer) and
 * remote (URL with HTTP range requests) sources are supported.
 *
 * @param source - A URL string, Blob/File, ArrayBuffer, or
 *   pre-built {@link TiffStore}.
 * @param options - Optional {@link FromTiffOptions}.
 * @returns A {@link Multiscales} object for use with
 *   {@link OMEZarrNVImage.create}.
 * @throws If the source cannot be opened as a TIFF or if the
 *   synthesized OME-Zarr metadata is invalid.
 *
 * @example
 * ```typescript
 * // From a remote URL
 * const ms = await fromTiff("https://example.com/image.ome.tif")
 * const image = await OMEZarrNVImage.create({
 *   multiscales: ms,
 *   niivue: nv,
 * })
 *
 * // From a File input
 * const file = inputElement.files[0]
 * const ms = await fromTiff(file)
 * ```
 */
export async function fromTiff(
  source: string | Blob | ArrayBuffer | TiffStore,
  options: FromTiffOptions = {},
): Promise<Multiscales> {
  let store: TiffStore
  if (source instanceof TiffStore) {
    store = source
  } else if (typeof source === "string") {
    store = await TiffStore.fromUrl(source, options.tiff)
  } else if (source instanceof Blob) {
    store = await TiffStore.fromBlob(source, options.tiff)
  } else if (source instanceof ArrayBuffer) {
    store = await TiffStore.fromArrayBuffer(source, options.tiff)
  } else {
    throw new Error(
      "[fidnii] fromTiff: source must be a URL string, Blob, " +
        "ArrayBuffer, or TiffStore",
    )
  }

  // TiffStore implements zarrita's Readable interface structurally
  // (its get() method accepts string keys including the leading "/"
  // that zarrita uses for AbsolutePath). Since fromNgffZarr (v0.10+)
  // accepts zarr.Readable directly, we only need a type assertion.
  //
  // TiffStore always produces OME-Zarr v0.5 metadata.
  return fromNgffZarr(store as unknown as Readable, {
    version: "0.5",
    ...options.ngffZarr,
  })
}
