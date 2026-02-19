---
"@fideus-labs/fidnii": patch
---

Fix incorrect slab and 3D region rendering for datasets with permuted axis orientations (e.g. NGFF y mapping to physical S/I). The world-to-pixel conversion now uses the full oriented affine instead of naive scale+translation, and region offsets are transformed through the 3x3 rotation matrix so they land on the correct world axis. Also fix a black-canvas bug where the crosshair world position was captured after the slab volume swap instead of before.
