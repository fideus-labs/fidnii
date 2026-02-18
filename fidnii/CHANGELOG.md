# @fideus-labs/fidnii

## 0.5.0

### Minor Changes

- [#38](https://github.com/fideus-labs/fidnii/pull/38) [`ede249e`](https://github.com/fideus-labs/fidnii/commit/ede249ecef07324af33c8aa6254f69d504265674) Thanks [@thewtex](https://github.com/thewtex)! - Apply NGFF RFC-4 anatomical orientation to NIfTI affine matrix, including full axis permutation support, so NiiVue correctly renders LPS, RAS, and permuted orientations (e.g. oblique MRI direction matrices). Upgrade `@fideus-labs/ngff-zarr` to 0.12.0 for the upstream `itkDirectionToAnatomicalOrientation` fix.

### Patch Changes

- [#31](https://github.com/fideus-labs/fidnii/pull/31) [`9b036ae`](https://github.com/fideus-labs/fidnii/commit/9b036ae0e591a5f32d2a62f89bdacf8591f49a84) Thanks [@thewtex](https://github.com/thewtex)! - Eliminate blosc round-trip during OME-TIFF conversion

  - Use `bytesOnlyCodecs()` from ngff-zarr v0.12.0 to skip blosc compression
    during `toMultiscales()` when the output format is OME-TIFF, avoiding the
    wasteful compress→decompress cycle that blocked the main thread (~2 seconds)
  - Pass `zarrGet` as a custom `getPlane` callback to `toOmeTiff()` via fiff
    v0.5.0's new `WriteOptions.getPlane`, offloading any remaining zarr reads
    to the worker pool
  - Offload TIFF deflate compression to Web Workers via fiff worker pool support
  - Bump `@fideus-labs/fiff` to ^0.5.0 and `@fideus-labs/ngff-zarr` to ^0.12.0

## 0.4.0

### Minor Changes

- [#25](https://github.com/fideus-labs/fidnii/pull/25) [`1a01abf`](https://github.com/fideus-labs/fidnii/commit/1a01abfe4dfb3552e318c77e9cd9f6955b07bb25) Thanks [@thewtex](https://github.com/thewtex)! - Add TIFF loading support via `fromTiff()` helper and `@fideus-labs/fiff`

### Patch Changes

- [#30](https://github.com/fideus-labs/fidnii/pull/30) [`980784f`](https://github.com/fideus-labs/fidnii/commit/980784f13c974adbd349adf85b12352bbf915222) Thanks [@thewtex](https://github.com/thewtex)! - Disable orientation markers in niivue

- [#26](https://github.com/fideus-labs/fidnii/pull/26) [`2ba1a55`](https://github.com/fideus-labs/fidnii/commit/2ba1a5591c745a83ed78816f7bfbad659afed3fe) Thanks [@thewtex](https://github.com/thewtex)! - Bump ngff-zarr to 0.11.0

- [#21](https://github.com/fideus-labs/fidnii/pull/21) [`b6125c7`](https://github.com/fideus-labs/fidnii/commit/b6125c7ecd01a649deac2a6bb3eb9f3051a4a002) Thanks [@thewtex](https://github.com/thewtex)! - Limit test parallelism to 8

- [#22](https://github.com/fideus-labs/fidnii/pull/22) [`b39e268`](https://github.com/fideus-labs/fidnii/commit/b39e268fb23a30974c155d2160808ea9bc40db66) Thanks [@thewtex](https://github.com/thewtex)! - Use a cleaner gif for the README

## 0.3.0

### Minor Changes

- [#19](https://github.com/fideus-labs/fidnii/pull/19) [`dff7694`](https://github.com/fideus-labs/fidnii/commit/dff7694f30df2ee4a88ea7c7c6bf05e1061c85a4) Thanks [@thewtex](https://github.com/thewtex)! - Faster OMERO computation with cache-aware web worker pool.

- [#11](https://github.com/fideus-labs/fidnii/pull/11) [`1d26f4d`](https://github.com/fideus-labs/fidnii/commit/1d26f4d0ed969413cdd3e177bd64b83df957f0a6) Thanks [@thewtex](https://github.com/thewtex)! - Add support for 2D RGB and RGBA image inputs (e.g., PNG files converted to OME-Zarr). Includes channel-aware dimension lookup, correct NIfTI RGB24/RGBA32 datatype headers, and a vertical flip fix for 2D images. Also upgrades `@fideus-labs/ngff-zarr` to 0.8.0.

- [#14](https://github.com/fideus-labs/fidnii/pull/14) [`fd07900`](https://github.com/fideus-labs/fidnii/commit/fd07900c3bbece120d8de4a67e4211744b40cbe7) Thanks [@thewtex](https://github.com/thewtex)! - Support multi-component RGB/RGBA images with any dtype (uint16, float32, int16, etc.), not just uint8. Non-uint8 channel data is normalized to uint8 using OMERO window metadata before rendering, with a per-channel min/max fallback when OMERO is unavailable. The existing uint8 fast path is unchanged.

### Patch Changes

- [#8](https://github.com/fideus-labs/fidnii/pull/8) [`e51baae`](https://github.com/fideus-labs/fidnii/commit/e51baae06815c3f6c071060f04b0c0e780d02020) Thanks [@thewtex](https://github.com/thewtex)! - Suppress noisy "points to missing source files" sourcemap warnings from `@fideus-labs/ngff-zarr` in all Vite dev server configs using a custom logger.

## 0.2.0

### Minor Changes

- [#3](https://github.com/fideus-labs/fidnii/pull/3) [`7cbf9c0`](https://github.com/fideus-labs/fidnii/commit/7cbf9c0de1da91fb03f2ccaabc6089455f6c9412) Thanks [@thewtex](https://github.com/thewtex)! - Add public `loadLevel(levelIndex)` method to `OMEZarrNVImage` for loading a specific resolution level, bypassing the automatic `maxPixels`-based selection.

- [#4](https://github.com/fideus-labs/fidnii/pull/4) [`24216ee`](https://github.com/fideus-labs/fidnii/commit/24216ee11192e76eb14d6936bdcf7ccb6a9cf65a) Thanks [@thewtex](https://github.com/thewtex)! - Add label image support: detect OME-Zarr volumes with `method: "itkwasm_label_image"` and render them with a discrete Glasbey colormap via NiiVue's `setColormapLabel()` instead of a continuous colormap. Re-export `Methods` enum from `@fideus-labs/ngff-zarr`.
