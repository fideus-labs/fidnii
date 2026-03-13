---
"@fideus-labs/fidnii": patch
---

Transform clip plane normals through orientation mapping for NiiVue

NiiVue's orient shader physically reorders the 3D texture data to align
with RAS (texture axis 0 = L→R, 1 = P→A, 2 = I→S). When OME-Zarr axes
are permuted relative to RAS (e.g. the y axis encodes S/I instead of
A/P), clip plane normals, points, and buffer bounds must be permuted
through the orientation mapping so that the clipping direction matches
the RAS-reoriented texture coordinates.
