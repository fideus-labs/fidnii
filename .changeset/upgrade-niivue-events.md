---
"@fideus-labs/fidnii": minor
---

Upgrade niivue to 0.68.1 and migrate to browser-native events

Replace the fragile save-and-chain callback pattern (`nv.onClipPlaneChange`,
`nv.onOptsChange`, `nv.onLocationChange`, `nv.onMouseUp`, `nv.onZoom3DChange`)
with niivue's new `EventTarget`-based event system (`addEventListener`).

This eliminates the need to save/restore previous callback handlers, supports
multiple listeners per event, and uses `AbortController` for clean teardown.

- `onClipPlaneChange` → `addEventListener("clipPlaneChange", ...)`
- `onOptsChange` (sliceType filter) → `addEventListener("sliceTypeChange", ...)`
- `onLocationChange` → `addEventListener("locationChange", ...)`
- `onMouseUp` → `addEventListener("mouseUp", ...)`
- `onZoom3DChange` → `addEventListener("zoom3DChange", ...)`
