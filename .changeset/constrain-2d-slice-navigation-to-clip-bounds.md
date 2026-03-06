---
"@fideus-labs/fidnii": patch
---

Constrain 2D slice navigation to clip plane bounds on the orthogonal axis

Previously, users could scroll past the ROI boundary in 2D slice views (axial,
coronal, sagittal) because the orthogonal slab extent was computed solely from
the crosshair position, ignoring clip planes on that axis.

Now `_loadSlabAtLevel()` clamps the orthogonal slab extent to the
clip-plane-constrained pixel region, preventing data fetches outside the ROI.
Additionally, `_handleLocationChange()` clamps the crosshair position to the
nearest ROI edge when the user tries to scroll past the boundary, so navigation
is physically constrained to the clipped region.
