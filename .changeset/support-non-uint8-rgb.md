---
"@fideus-labs/fidnii": minor
---

Support multi-component RGB/RGBA images with any dtype (uint16, float32, int16, etc.), not just uint8. Non-uint8 channel data is normalized to uint8 using OMERO window metadata before rendering, with a per-channel min/max fallback when OMERO is unavailable. The existing uint8 fast path is unchanged.
