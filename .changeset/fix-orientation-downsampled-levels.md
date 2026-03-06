---
"@fideus-labs/fidnii": patch
---

Fix orientation mismatch on downsampled resolution levels

The `@fideus-labs/ngff-zarr` downsampling code omits `axesOrientations` on
generated levels, so only level 0 carries anatomical orientation metadata.
This caused `OMEZarrNVImage` to build an unoriented affine for downsampled
levels, producing incorrect `calculateRAS()` results (identity `toRAS`
instead of the correct permutation/flip matrix).

Add `_createOrientedAffine()` helper that falls back to the base level's
`axesOrientations` when the current level lacks it, ensuring all resolution
levels share the same orientation transform.
