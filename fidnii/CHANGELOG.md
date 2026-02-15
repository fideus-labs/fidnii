# @fideus-labs/fidnii

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
