---
"@fideus-labs/fidnii": patch
---

Fix slab (2D slice) buffers losing the active colormap when switching slice types. The `colormap` setter on `OMEZarrNVImage` now propagates to all existing slab NVImages, and newly created slabs inherit the main image's colormap instead of hard-coding `"gray"`.
