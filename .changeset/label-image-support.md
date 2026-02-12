---
"@fideus-labs/fidnii": minor
---

Add label image support: detect OME-Zarr volumes with `method: "itkwasm_label_image"` and render them with a discrete Glasbey colormap via NiiVue's `setColormapLabel()` instead of a continuous colormap. Re-export `Methods` enum from `@fideus-labs/ngff-zarr`.
