---
type: report
title: niivue 1.0 Live-Render Smoke Test (Phase 04)
created: 2026-06-22
updated: 2026-06-23
tags:
  - niivue
  - migration
  - render-smoke
related:
  - '[[rendering-backend]]'
  - '[[migration-map]]'
  - '[[breakage-inventory]]'
---

# niivue 1.0 Live-Render Smoke Test — Phase 04

**Verdict: 🟢 RESOLVED.** An OME-Zarr volume renders end-to-end against
`@niivue/niivue@1.0.0-rc.9`. The 3D volume paints, progressive loading reaches
`populateComplete`, all five slice modes draw, and clip planes respond — with
**zero page errors and zero failed module requests** in the headless smoke run.
Getting there required closing four core-library (Phase 03) gaps that only
surfaced at runtime; they are documented below with their fixes.

Captured against `@niivue/niivue@1.0.0-rc.9`, dataset
`https://ome-zarr-scivis.s3.us-east-1.amazonaws.com/v0.5/96x2/beechnut.ome.zarr`
(the test page's existing default, OME-Zarr v0.5 / zarr v3, uint16, meter-scale
voxels ≈ 8 × 10⁻⁵ m), Chromium headless with `--use-gl=egl` (the
`playwright.config.ts` flag). Backend: **WebGL2** (confirmed, see
`[[rendering-backend]]` §9). No WebGPU path is touched.

## What verified cleanly ✅

| Check | Result |
|---|---|
| `bun run dev` startup | Vite 8.0.16 ready ~0.2 s; serves port 5173 |
| COOP/COEP headers | `same-origin` + `require-corp` present on `/` |
| Rendering backend | **WebGL2** (`@niivue/niivue/webgl2` subpath hard-pin) |
| `attachToCanvas` | Succeeds for both `nv` and `nv2` |
| OME-Zarr load | `fromNgffZarr()` → `populateComplete` reached ~4 s |
| **3D volume render** | Beechnut paints (`render-3d.png`) — seed + root fibres |
| **2D slice modes** | Axial / Sagittal / Coronal / Render / Multiplanar all draw |
| **Clip planes** | Z-max clip slices the volume, exposing the interior (`render-clip-zmax.png`) |
| Page errors | **0** |
| Failed requests | **0** |

The 3 console "errors" that remain are benign **zarr v2 probes**
(`…/.zmetadata`, `…/.zattrs`, `…/.zgroup` 404) — the reader's v2→v3 fallback for
a zarr-v3 dataset, identical to the 0.68 baseline. Not a regression.

## Root causes & fixes (core-library / Phase 03)

niivue 1.0 stopped deriving several fields for **hand-built** volumes (volumes
not produced by its own loaders). fidnii builds `OMEZarrNVImage` by hand
(placeholder header first, data streamed later), so it must now compute these
itself. Each gap was a runtime-only failure behind the previous one.

### G1 — RAS geometry missing before `addVolume` (was the original blocker)

niivue 1.0's GL bind path **requires** precomputed RAS corners
(`mm000`/`mm100`/`mm010`/`mm001`, `matRAS`, `pixDimsRAS`, `dimsRAS`, `frac2mm`)
*before* `addVolume`, throwing `Missing moving image mm corner coordinates`
otherwise. niivue 0.68 computed these via `NVImage.calculateRAS()`, removed in
1.0 and **not exported** (declared in `dist/math/NVTransforms` but absent from
`package.json#exports`).

**Fix:** vendored a faithful, dependency-free port of niivue's `calculateRAS`
(verified against the rc.9 bundle and upstream source) in
`src/utils/calculateRAS.ts`, using the already-present `gl-matrix@3.4.4`. It runs
synchronously on the detached placeholder (init + slab creation) and on every
affine change — exactly as 0.68 did.

### G2 — `addVolume` stores a decoupled copy

niivue 1.0's `addVolume(v)` pushes `{ ...volumeDefaults, ...v }` (a shallow spread
from `prepareVolume`), **not** the passed object. The copy shares `hdr` by
reference but freezes `img` / `dims` / `dimsRAS` / geometry at their placeholder
values, so fidnii's progressive updates — which *reassign* those fields — never
reached the rendered volume, and `nv.volumes.indexOf(this)` failed everywhere
fidnii looks itself up (which is *why* the old `setVolumeAffine`-based recompute
silently no-op'd).

**Fix:** new public `OMEZarrNVImage.addToNiivue(nv)` adds the volume, then
re-seats this instance into `nv.volumes` (carrying over niivue's managed default
fields), restoring the 0.68 by-reference contract. The slab swap and the
`autoLoad` path use the same re-seat helper. **Consumers must use
`image.addToNiivue(nv)` instead of `nv.addVolume(image)`** (docs updated).

### G3 — derived voxel/scene fields left at placeholders

`nVox3D` (drives the intensity scan), `dims`, and `extentsMin`/`extentsMax`
(drive the 3D scene pivot and the crosshair-location formatter) stayed at their
`1` / `[0,0,0]` placeholders. A zero scene extent made niivue's location
formatter throw `toFixed() digits argument must be between 0 and 100`
(`log10(0) → Infinity`).

**Fix:** set `nVox3D`/`dims` from the loaded shape; delegate RAS + extents +
pivot to niivue's own `setVolumeAffine(index, affine)` once attached (now that
the volume is re-seated, the index lookup succeeds); and seed `extentsMin`/
`extentsMax` synchronously at init via `computeBoundingBoxExtents()` so the scene
is non-degenerate *before* the first crosshair sync. Result: the `toFixed` throw
is gone (page errors 2 → 0).

### G4 — intensity window degenerate → all-black

niivue 0.68's `NVImage.calMinMax()` (which seeded the runtime display window
`calMin`/`calMax` from `hdr.cal_min/cal_max` and computed the data range) is
gone, and 1.0 does not recompute it for hand-built volumes. Left at `0`, the
shader maps every voxel through an empty `0..0` window → solid black.

**Fix:** seed the runtime intensity fields from the OMERO window fidnii already
resolves (`_applyIntensityWindow`, called from `applyOmeroToHeader` /
`_applyOmeroToSlabHeader`). `globalMin`/`globalMax` are seeded *at* the display
window so `_widenCalRangeIfNeeded` does not blow the tight OMERO window back out
to the raw extremes.

### Incidental regression caught by the test suite

The G2 re-seat initially clobbered a user-set `colormap`: `colormap` is a
prototype getter/setter (backed by `_colormap`), so the spread copy carried
niivue's default `"Gray"`, which the adopt loop copied back through the setter.
Fixed by testing `key in volume` (catches prototype accessors) rather than
`Object.hasOwn` when adopting niivue's defaults.

## Screenshots (proof)

Under the Phase-04 Auto Run `Working/` folder
(`.maestro/playbooks/2026-06-22-Niivue-10-RC-Upgrade/Working/`):

- `render-3d.png` — 3D render: beechnut seed body with root fibres, correctly
  windowed and framed in niivue's render cube.
- `render-slice-axial.png` — axial cross-section: clear internal seed structure.
- `render-slice-sagittal.png` — sagittal section: seed coat + interior, oriented
  consistently with the 3D view (beechnut apex up).
- `render-slice-{coronal,render,multiplanar}.png` — remaining slice modes draw.
- `render-clip-zmax.png` — Z-max clip plane cuts the volume, exposing the
  embryo/seed interior — clip planes respond live.
- `render-overview.png` — full page (`Status: Ready`, bounds + levels populated).
- `console-log.txt`, `smoke-summary.json` — full capture (0 page errors, 0 failed
  requests).

## Test-suite validation

`basic-loading`, **`orientation`**, `coordinate-system`, `slice-mode`,
`clip-planes` (96 tests): **90 passed**. The geometry-critical specs —
`orientation`, `coordinate-system`, `clip-planes`, `basic-loading` — all pass,
confirming the vendored RAS math and the re-seat preserve correct orientation and
coordinates (a screenshot alone is insufficient to certify orientation).

The **6 remaining failures are all in `slice-mode.spec.ts` and use removed/moved
niivue 0.68 APIs in the *test code*, not fidnii** — they fail under 1.0
regardless of rendering and are **Phase 05 (test-suite verification)** items:

| Test (line) | Uses (0.68) | 1.0 replacement |
|---|---|---|
| `second NV starts in axial` (27) | `nv2.opts.sliceType` | `nv2.sliceType` |
| `slice type selector changes NV2` (36) | `nv2.opts.sliceType` | `nv2.sliceType` |
| `primary NV remains in render` (48) | `nv.opts.sliceType` | `nv.sliceType` |
| `slab loading emits slabLoadingComplete` (284) | `nv2.setSliceType(1)` | `nv2.sliceType = 1` |
| `crosshair in volume after slab switch` (367) | `nv2.scene?.crosshairPos` | `nv2.model.scene.crosshairPos` |
| `slab types preserve crosshair` (500) | `nv2.opts.sliceType`, `nv2.scene` | `nv2.sliceType`, `nv2.model.scene` |

(niivue 1.0: `sliceType` moved to `model.layout.sliceType` behind the
`get/set sliceType` accessors; `setSliceType()` was removed in favour of the
setter; `scene` moved to `model.scene`.)

## Deviation vs. the 0.68 baseline

None functional: the beechnut renders with progressive loading, correct
orientation, and working clip planes — matching 0.68. Intensity windowing uses
the OMERO display window (unchanged intent); `_widenCalRangeIfNeeded`'s
per-resolution widening is currently conservative (global seeded at the display
window) — a refinement, not a regression.

## Impact on Phase 05

The core-library blocker is **cleared** — Playwright specs that render real data
now pass (90/96). Phase 05 should (a) update the six `slice-mode` tests to the
1.0 `sliceType`/`scene` APIs above, and (b) run the full suite across datasets.

## Links

- Backend decision & headless flags: `[[rendering-backend]]` §9
- Removed-method inventory (G5 / Hotspot H1): `[[breakage-inventory]]`
- Member-by-member mapping: `[[migration-map]]`
