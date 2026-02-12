# @fideus-labs/fidnii

## 0.2.0

### Minor Changes

- [#3](https://github.com/fideus-labs/fidnii/pull/3) [`7cbf9c0`](https://github.com/fideus-labs/fidnii/commit/7cbf9c0de1da91fb03f2ccaabc6089455f6c9412) Thanks [@thewtex](https://github.com/thewtex)! - Add public `loadLevel(levelIndex)` method to `OMEZarrNVImage` for loading a specific resolution level, bypassing the automatic `maxPixels`-based selection.

- [#4](https://github.com/fideus-labs/fidnii/pull/4) [`24216ee`](https://github.com/fideus-labs/fidnii/commit/24216ee11192e76eb14d6936bdcf7ccb6a9cf65a) Thanks [@thewtex](https://github.com/thewtex)! - Add label image support: detect OME-Zarr volumes with `method: "itkwasm_label_image"` and render them with a discrete Glasbey colormap via NiiVue's `setColormapLabel()` instead of a continuous colormap. Re-export `Methods` enum from `@fideus-labs/ngff-zarr`.
