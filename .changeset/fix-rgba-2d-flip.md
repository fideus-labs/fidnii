---
"@fideus-labs/fidnii": patch
---

Fix upside-down rendering of RGBA 2D images (e.g. PNGs). NiiVue's Texture2D fast path for RGBA 2D images bypasses the orient shader, so the existing affine-based y-flip had no visual effect. The fix reverses scanline order directly in the pixel buffer instead, which works correctly with all NiiVue rendering paths. Scalar 2D images and 3D volumes are unaffected.
