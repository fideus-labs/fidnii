---
"@fideus-labs/fidnii": patch
---

Transform clip plane normals through orientation mapping for NiiVue

Clip planes were stored in OME-Zarr world space but NiiVue's shader evaluates
them in RAS-reoriented texture space. When axes are permuted (e.g. the y axis
encodes S/I instead of A/P), the clipping directions were swapped between the
minimap wireframe and the preview.

Fix by permuting clip plane normals, points, and buffer bounds through the
orientation mapping in `updateNiivueClipPlanes()` before conversion to NiiVue's
depth/azimuth/elevation format.
