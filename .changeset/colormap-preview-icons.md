---
---

Add a build script (`generate-colormap-icons.ts`) that generates 128x16 lossless WebP gradient bar icons for all NiiVue colormaps using `sharp` and the `cmapper` API. The colormap `<wa-select>` dropdown in the convert example now displays these icons inline via the `<wa-option>` start slot.
