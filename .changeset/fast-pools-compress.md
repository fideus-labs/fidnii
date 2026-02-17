---
"@fideus-labs/fidnii": patch
---

Eliminate blosc round-trip during OME-TIFF conversion

- Use `bytesOnlyCodecs()` from ngff-zarr v0.12.0 to skip blosc compression
  during `toMultiscales()` when the output format is OME-TIFF, avoiding the
  wasteful compress→decompress cycle that blocked the main thread (~2 seconds)
- Pass `zarrGet` as a custom `getPlane` callback to `toOmeTiff()` via fiff
  v0.5.0's new `WriteOptions.getPlane`, offloading any remaining zarr reads
  to the worker pool
- Offload TIFF deflate compression to Web Workers via fiff worker pool support
- Bump `@fideus-labs/fiff` to ^0.5.0 and `@fideus-labs/ngff-zarr` to ^0.12.0
