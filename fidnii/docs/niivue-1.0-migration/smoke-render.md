---
type: report
title: niivue 1.0 Live-Render Smoke Test (Phase 04)
created: 2026-06-22
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

**Verdict: 🔴 BLOCKED.** The Vite test page boots cleanly and both `Niivue`
instances reach `attachToCanvas` on a confirmed **WebGL2** backend, but **no
volume renders**: the first `nv.addVolume(image)` throws inside niivue 1.0's GL
bind path because an `OMEZarrNVImage` carries no RAS corner geometry at add time.
This is the Phase 03 `calculateRAS` **runtime-verification item** (breakage
inventory **G5**, "Hotspot H1") materializing as a hard blocker.

Captured against `@niivue/niivue@1.0.0-rc.9`, dataset
`https://ome-zarr-scivis.s3.us-east-1.amazonaws.com/v0.5/96x2/beechnut.ome.zarr`
(the test page's existing default), Chromium headless with `--use-gl=egl`
(the `playwright.config.ts` flag).

## What verified cleanly ✅

| Check | Result |
|---|---|
| `bun run dev` startup | Vite 8.0.16 ready ~167 ms; serves port 5173 |
| COOP/COEP headers | `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` present on `/` |
| `main.ts` transform | HTTP 200, no Vite transform error |
| **Rendering backend** | **WebGL2 confirmed** — console: `niivue-info WebGL2 ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …), SwiftShader driver) … maxTexture 2D:8192 3D:2048`. The `@niivue/niivue/webgl2` subpath build hard-pins WebGL2; **no WebGPU path is touched** (validates `[[rendering-backend]]` §9). |
| `attachToCanvas` | Succeeds for **both** `nv` and `nv2` (two `niivue-info` lines, no error). The async init gate is clean. |
| OME-Zarr data load | `fromNgffZarr()` succeeds — execution reaches `addVolume`, so zarr v3 metadata + multiscales parsed fine. |

The dev-server / backend half of Phase 04 is sound. The break is purely at
volume registration.

## The blocker 🔴

**Console (init):**

```
PAGEERROR  Missing moving image mm corner coordinates      (≈1.1 s after load)
```

**Stack (from the Vite dev-server overlay):**

```
Error: Missing moving image mm corner coordinates
  oi._updateBindings   dist/NVViewGL-…js
  oi.updateBindGroups  dist/NVViewGL-…js
  R.updateGLVolume     dist/NVControlBase-…js:20218
  R.addVolume          dist/NVControlBase-…js:20369
  loadImage            test-page/main.ts:332    await nv.addVolume(image)
  main                 test-page/main.ts:485
```

A second `PAGEERROR` — `toFixed() digits argument must be between 0 and 100`
(from `R._sync → createOnLocationChange`) — is a **downstream symptom**: the
bidirectional `broadcastTo` crosshair sync runs against a volume that never
acquired a valid coordinate system. It disappears once the primary error is
fixed.

### Root cause

niivue 1.0's GL bind path requires the volume to carry **precomputed RAS
geometry** before `addVolume`. The throwing guard (de-minified):

```js
function To(fixed, moving) {
  if (!moving.mm000 || !moving.mm100 || !moving.mm010 || !moving.mm001)
    throw new Error("Missing moving image mm corner coordinates")
  // …and the next function, pi(), additionally throws on
  //   !matRAS  → "matRAS not defined"
  //   pixDimsRAS === undefined → "pixDimsRAS not defined"
}
```

In **niivue 0.68** these fields were computed by the instance method
`NVImage.calculateRAS()`, which fidnii called **synchronously on the detached
image during construction** — so the corners existed before `addVolume`.

In **niivue 1.0** `NVImage.calculateRAS()` was **removed** (it is now a free
function `calculateRAS(nvImage)` in `dist/math/NVTransforms`). Phase 03 replaced
the call with the controller method `setVolumeAffine(index, affine)` inside
`OMEZarrNVImage._recomputeVolumeRAS()`:

```ts
private _recomputeVolumeRAS(nvImage: NVImage): void {
  const found = this._findAttachedVolume(nvImage)
  if (!found) return                                   // ← early-out when NOT yet attached
  void found.nv.setVolumeAffine(found.index, nvImage.hdr.affine)
}
```

`setVolumeAffine` needs the volume **already registered in `nv.volumes`** (it
looks it up by index) **and** a GL `view` attached. On the **initial**
`OMEZarrNVImage.create({ autoLoad: false })` the volume is detached, so
`_recomputeVolumeRAS` early-returns, the corners are never computed, and the
subsequent external `nv.addVolume(image)` (test page `main.ts:332`) throws.
A classic chicken-and-egg: the only public way to compute the geometry needs the
volume added, but adding it needs the geometry.

The incorrect assumption is recorded verbatim in `OMEZarrNVImage.ts:117–127`:

> *"NiiVue populates the derived geometry/min-max fields at addVolume()/
> setVolumeAffine() time, so they are deliberately not all initialized on the
> class."*

niivue 1.0 does **not** populate them at `addVolume` time — it **requires** them
as a precondition and throws otherwise.

### Why it is not a one-line fix

- **`calculateRAS` is unreachable.** niivue's `package.json#exports` exposes only
  `.`, `./webgpu`, `./webgl2`, `./assets/*`. There is **no** `math/NVTransforms.js`
  on disk (the runtime is bundled into hash-named chunks) and `calculateRAS` is
  **not** re-exported from the package root. It cannot be imported.
- **Re-implementing it in fidnii is fragile.** The bind path needs the full
  derived set (`mm000…mm111`, `matRAS`, `dimsRAS`, `pixDimsRAS`, `obliqueRAS`,
  `frac2mm`, …), not just the four corners; duplicating niivue's RAS math would
  drift on every niivue release.
- **The only public computer is `setVolumeAffine`,** which needs attachment +
  view, so any fix must change *how a fidnii volume is attached* (manual
  `nv.volumes` registration, or a borrow-attach inside `create()`), i.e. it
  touches the volume-attach contract, not just one call site.

## Incidental (ruled-out) findings

- **3× HTTP 404** during init —
  `…/beechnut.ome.zarr/.zmetadata`, `…/.zattrs`, `…/.zgroup`. These are **zarr
  v2** probe paths; the dataset is **OME-Zarr v0.5 (zarr v3)**, served from
  `zarr.json`. The reader's v2→v3 fallback 404s by design, then succeeds. **Not
  a regression, not the cause.**

## Screenshots (proof)

All under the Phase-04 Auto Run `Working/` folder
(`.maestro/playbooks/2026-06-22-Niivue-10-RC-Upgrade/Working/`):

- `render-overview.png` — full page: both canvases show niivue's **"No image
  loaded"** badge, Status stuck on `Loading…`, all info fields `-`.
- `render-3d.png`, `render-clip-zmax.png` — 3D canvas: empty (only the red
  crosshair axes).
- `render-slice-{render,axial,coronal,sagittal,multiplanar}.png` — 2D canvas:
  empty for every slice mode.
- `console-log.txt`, `smoke-summary.json` — full console capture + structured
  results. GL pixel read-back reported `nonBlackFraction: 0` everywhere
  (nothing painted).

The slice-type selector and clip-plane slider wiring were exercised and fire
correctly (no JS errors from the UI handlers) — they simply have no volume to
act on. So the **`main.ts` UI adaptation (Phase 04 Task 1) is not implicated**;
the blocker is entirely in the core-library volume-attach path.

## Deviation vs. the 0.68 baseline

Total functional regression at the volume-attach boundary: 0.68 rendered the
beechnut volume with progressive loading; 1.0-rc.9 renders nothing because the
RAS-geometry init contract changed and was not adapted. No partial/oblique
render to compare — it fails before the first paint.

## Recommended fix (for a Phase 03 follow-up)

Make an `OMEZarrNVImage` acquire valid RAS geometry **before** the first
`addVolume`. Candidate approaches, cheapest-first:

1. **Borrow-attach inside `create()` (preferred, self-contained).** After the
   placeholder `hdr` is built and while `image.niivue` already has a view
   (the test page calls `attachToCanvas` before `create`), register the volume,
   `await nv.setVolumeAffine(idx, hdr.affine)` to let niivue compute the full
   geometry, then either keep it added (and make `autoLoad:false` mean "added but
   not yet populated") or detach. Keeps the public `nv.addVolume(image)` usage
   working unchanged. Risk: relies on a view being attached at `create()` time
   and on direct `nv.volumes` manipulation.
2. **Replace the external `addVolume` with an attach helper.** Have fidnii own
   the registration (`nv.volumes` push → `setVolumeAffine` → bind) via a method
   the test page / consumers call instead of `nv.addVolume`. Cleanest semantics,
   but a **public-API/contract change** rippling into examples, docs and every
   `*.spec.ts`.
3. **Catch-and-repair.** Let `addVolume` throw, detect the corner-coordinate
   error, then `setVolumeAffine` (the volume is already pushed to `nv.volumes`
   when the bind throws). Smallest diff, but depends on niivue's throw-after-push
   ordering and the error string — brittle.

Whichever is chosen, validate with the existing suite — `basic-loading`,
`slice-mode`, **`orientation`**, and `clip-planes` — since the change touches
spatial geometry. A screenshot alone is insufficient to confirm correct
orientation.

## Impact on Phase 05

**Every Playwright spec that renders real data will fail with this identical
error.** Phase 05 (test-suite verification) cannot meaningfully run until this
core-library blocker is resolved. This Phase-04 Auto Run was **halted** at the
live-rendering task for that reason.

## Links

- Backend decision & headless flags: `[[rendering-backend]]` §9
- Removed-method inventory (G5 / Hotspot H1): `[[breakage-inventory]]`
- Member-by-member mapping: `[[migration-map]]`
