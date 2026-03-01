---
"@fideus-labs/fidnii": patch
---

Remove existing volumes from NiiVue before adding a new image in the `autoLoad` path. Previously, calling `OMEZarrNVImage.create()` multiple times on the same NiiVue instance would accumulate stale volumes. Now the old volumes are automatically cleaned up via `nv.removeVolume()` before the new image is added.
