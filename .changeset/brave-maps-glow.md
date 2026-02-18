---
"@fideus-labs/fidnii": minor
---

Apply NGFF RFC-4 anatomical orientation to NIfTI affine matrix, including full axis permutation support, so NiiVue correctly renders LPS, RAS, and permuted orientations (e.g. oblique MRI direction matrices). Upgrade `@fideus-labs/ngff-zarr` to 0.12.0 for the upstream `itkDirectionToAnatomicalOrientation` fix.
