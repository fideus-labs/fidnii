---
"@fideus-labs/fidnii": patch
---

Fix `waitForIdle()` to wait for all async work — debounced clip plane refetch, viewport update, and slab reload timers, the main `populateVolume` pipeline, per-slice-type slab loads, and in-flight coalescer fetches — not just the coalescer. The method now polls in a convergence loop, only resolving once every source of async work is idle simultaneously. Also scale Playwright worker count dynamically based on CPU cores to prevent S3 bandwidth saturation on high-core-count machines.
