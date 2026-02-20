---
"@fideus-labs/fidnii": minor
---

Add time dimension (`t`) support for OME-Zarr NGFF datasets. Time navigation is entirely fidnii-managed via a single-frame swap architecture — NiiVue always sees `nFrame4D=1` while fidnii handles time index state, buffer swaps, and a look-ahead LRU cache (±N frames, default N=2) for smooth scrubbing. New public API: `timeAxisInfo`, `timeCount`, `timeIndex` getters, `getTimeValue()`, and `setTimeIndex()`. A `timeChange` event fires on index changes. Datasets without a `t` axis behave identically to before (zero overhead). Also adds `AbortController` plumbing to the `populateVolume` fetch path so queued requests cancel in-flight HTTP fetches.
