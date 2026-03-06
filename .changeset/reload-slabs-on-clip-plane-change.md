---
"@fideus-labs/fidnii": patch
---

Reload 2D slabs when clip planes change so ROI cropping applies to slice views

Previously, adjusting clip planes (e.g. via ROI sliders) only affected the 3D
rendered volume. 2D slice views (axial, coronal, sagittal, multiplanar) were not
updated because `handleDebouncedClipPlaneUpdate()` only triggered a 3D
`populateVolume()` refetch when the resolution level changed.

Now `_reloadAllSlabs()` is called after every debounced clip plane update. Since
slab loading already uses `_clipPlanes` to compute the in-plane fetch region via
`clipPlanesToPixelRegion()`, the refetched slab data is naturally constrained to
the ROI bounding box.
