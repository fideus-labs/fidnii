---
type: analysis
title: Fidnii → Niivue 1.0 Migration Map
created: 2026-06-22
tags:
  - niivue
  - migration
  - plan
related:
  - '[[index]]'
  - '[[api-surface]]'
  - '[[rendering-backend]]'
  - '[[niivue-class-api]]'
  - '[[nvimage-api]]'
  - '[[events]]'
  - '[[enums-and-exports]]'
---

# Fidnii → Niivue 1.0 Migration Map

Cross-references every API in [[api-surface]] against its status in
`@niivue/niivue@1.0.0-rc.9` (published 2026-06-12, npm `next` tag; baseline
`0.68.1`, published 2026-02-25). Each row carries a **status**, a **one-line
required action**, and a `[[…]]` link to the supporting changelog evidence.

**Status legend** — `unchanged` · `renamed` (incl. moved access path) ·
`signature-changed` · `behavior-changed` · `removed`. Severity: 🔴 blocker ·
🟠 functional risk · 🟡 type-only / mechanical · 🟢 no action.

> **Bottom line.** 1.0 is a **major** break, not a version bump. The default
> package is now WebGPU-first ("NiiVueGPU"), the `Niivue` class is renamed to
> `NiiVueGPU` with `scene`/`uiData` dismantled, and — most consequentially —
> **`NVImage` is no longer a class**, so fidnii's entire `extends NVImage`
> architecture must be rebuilt as composition. Of fidnii's surface, **~55% needs
> code changes**; only events and the NIfTI header survive largely intact.

---

## 0. Resolution status — ✅ RESOLVED (Phase 05 close-out, 2026-06-23)

**Every API row in §§1–6 below is resolved**, every Risk Hotspot (§7) is closed,
and every runtime-verification item (§8) is verified. Final target shipped:
`@niivue/niivue@1.0.0-rc.9` (exact `dependencies` pin; `peerDependencies`
`^1.0.0-rc.9`). The `fidnii` library passes all four gates — `tsc --noEmit`,
`bun run build` (library), `bun run check` (Biome), and the full Playwright suite
(175 passed + 1 environmental real-S3 slab-timing flake that passes on retry, the
condition CI's `retries: 2` exists for). The only red is the un-migrated
`examples/convert` app (still niivue 0.68, outside the migration's scope and the
agent's write boundary).

| Section | Rows | Status | Resolved in | How verified |
|---|---|---|---|---|
| §1 Imports/exports/enums | all | ✅ resolved | P02 (type-position `SliceType`), P03 (enum/import repoint), P04 (test-page enum import from root) | `tsc` 0; `SLICE_TYPE` forward values + `SLICE_TYPE_NAMES` reverse-map exercised by `slice-mode` specs |
| §2 `Niivue`→`NiiVueGPU` methods | all | ✅ resolved | P03 (`setSliceType`→setter, `setScale`/`frac2mm`/`swizzleVec3MM`/`inRenderTile`/`sceneExtentsMinMax` repointed, async `addVolume`/`updateGLVolume`) | `coordinate-system` + `orientation` + `clip-planes` specs (geometry-critical) all green |
| §3 `scene` property renames | all | ✅ resolved | P03 (`crosshairPos`, indexed `setClipPlaneDepthAziElev`, `scaleMultiplier`/`azimuth`/`elevation`/`pan2Dxyzmm`) | live clip-plane render (P04) + `clip-planes` specs; `nv.crosshairPos` used by `slice-mode` specs |
| §4 `opts`/`uiData`/`canvas`/`volumes` | all | ✅ resolved | P03 (`sliceType`, `primaryDragMode`, `devicePixelRatio`, `activeClipPlaneIndex`); P04 (test-page `sliceType`/`primaryDragMode`) | `slice-mode` specs read `nv.sliceType`; `auto-load-replacement` exercises `nv.volumes` |
| §5 Events | all | ✅ resolved | P03 (`mouseUp`→`pointerUp`; `zoom3DChange` via existing `wheel`); 3 unchanged | event wiring compiles + live interaction in P04 smoke |
| §6 `NVImage` subclass → composition | all | ✅ resolved | P03 (composition; field renames `_colormap`/`_opacity`/`globalMin`/`globalMax`/`calMin`/`calMax`); P04 (vendored `calculateRAS`, `addToNiivue` re-seat, voxel/extent/intensity seeding); **P05** (`create()` awaits `addToNiivue` so the instance is in `nv.volumes` after `await create()`) | `auto-load-replacement` (re-seat/replacement), `coordinate-system` (affine/dims), `slice-mode` (colormap propagation) all green |

**Risk Hotspots (§7):** H1 (subclass→composition) ✅, H2 (headless backend → WebGL2 subpath) ✅, H3 (scene renames / clip-plane indexed API) ✅, H4 (event renames) ✅, H5 (silent field-rename no-ops + `SLICE_TYPE[n]` reverse-lookup) ✅ (name-based audit + `SLICE_TYPE_NAMES` map + render smoke), H6 (new async methods awaited) ✅.

**Runtime-verification checklist (§8) — all verified:** (1) coordinate parity — `coordinate-system`/`orientation` specs green; (2) hit-test / tile path — render + clip specs green; (3) multi-plane clip set/clear — `clip-planes` 6-plane + clear specs green; (4) `devicePixelRatio` default `-1` guarded; (5) scene-extent units — extents seeded, `toFixed` throw gone; (6) `broadcastTo` persistent sync — bidirectional crosshair sync works in P04; (7) `removeVolume` via `model.removeVolume(index)` — `auto-load-replacement` green; (8) RAS recompute — vendored `calculateRAS` (`src/utils/calculateRAS.ts`); (9) 3D zoom via `wheel` — verified in P04 smoke. Detail: `[[smoke-render]]`, `[[breakage-inventory]]`.

---

## 1. Imports, exports & enums → see [[enums-and-exports]], [[niivue-class-api]], [[nvimage-api]]

| API (api-surface §1/§8) | Status | Required action | Evidence |
|---|---|---|---|
| `import { Niivue }` / `import type { Niivue }` | 🔴 removed (renamed) | No named/`type` `Niivue` export. Use default import or `{ NiiVueGPU }`; retype `import type { Niivue }`→`NiiVueGPU`. | [[niivue-class-api]] |
| `import { NVImage }` (value, extended) | 🔴 removed (now type-only) | Drop the value import; `NVImage` is a type. Build volumes via `nii2volume()`. | [[nvimage-api]] |
| `import type { NVImage }` | 🟢 unchanged | Type still exported (now a plain object type). | [[nvimage-api]] |
| `import { SLICE_TYPE }` | 🟠 behavior-changed | Import path unchanged (root). Runtime shape `enum`→`Object.freeze({...})`: forward values OK, **reverse-lookup gone**, and it can no longer be used in **type position**. | [[enums-and-exports]] |
| `import { DRAG_MODE }` | 🟢 unchanged | Still a TS `enum`, identical members. | [[enums-and-exports]] |
| fidnii re-export of `SLICE_TYPE` (`types.ts:238`, `index.ts:134`) | 🟡 behavior-changed | fidnii's own public re-export shape changes (enum→frozen object) — note in fidnii changelog. | [[enums-and-exports]] |
| `SLICE_TYPE.AXIAL/.CORONAL/.SAGITTAL/.RENDER/.MULTIPLANAR` (forward) | 🟢 unchanged | Values identical (MULTIPLANAR=3 both; new unused `NONE=5`). | [[enums-and-exports]] |
| `SLICE_TYPE[number]` (reverse) — `OMEZarrNVImage.ts:2633,2671,2958`; `test-page/main.ts:336` | 🟠 behavior-changed | Returns `undefined` in 1.0. Add a local `number→name` map. **Worst: `:2958` slab buffer key → `slab-undefined-N` (orientation collision).** | [[enums-and-exports]] |
| `DRAG_MODE.pan` / `.contrast` (`test-page/main.ts:418-419`) | 🟢 unchanged | None. | [[enums-and-exports]] |
| `SLICE_TYPE` in **type position** (`types.ts:298` `currentSliceType: SLICE_TYPE`) | 🟡 behavior-changed | Frozen object is value-only → won't type-check. Retype to `(typeof SLICE_TYPE)[keyof typeof SLICE_TYPE]` or the existing `SliceType` union. | [[enums-and-exports]] |
| Package subpaths `./utils` `./drawing` `./min` | 🟢 removed (unused) | fidnii imports only from root `.` — unaffected. | [[enums-and-exports]] |
| ESM `type: module` | 🟢 unchanged | None. | [[enums-and-exports]], [[rendering-backend]] |
| fidnii `package.json` dep/peerDep range (`^0.68.1` / `>=0.68.1`) | 🟠 action required | Won't match the prerelease. Widen to `>=1.0.0-rc.9 <2` (dual-support `^0.68.1 \|\| >=1.0.0-rc.9 <2` only **after** the reverse-lookup + type-position fixes land). | [[enums-and-exports]] |

---

## 2. `Niivue` (→ `NiiVueGPU`) instance methods → see [[niivue-class-api]]

| Method (api-surface §2) | Status | Required action | Evidence |
|---|---|---|---|
| `attachToCanvas(canvas)` | 🟡 signature-changed (compatible) | Still async `Promise<this>`; keep `await nv.attachToCanvas(canvas)`. It is the single readiness gate (no new `ready()`). | [[niivue-class-api]], [[rendering-backend]] |
| `setSliceType(v)` | 🔴 removed | → `nv.sliceType = v` (setter). | [[niivue-class-api]] |
| `broadcastTo(other, opts)` | 🟠 behavior-changed | Present but now a **persistent sync subscription** (default opts add `clipPlane:true`). Call still type-checks; verify sync semantics. | [[niivue-class-api]] |
| `addVolume(img)` | 🟠 signature-changed | Now async `Promise<this>`. → `await nv.addVolume(img)`. Accepts a prebuilt `NVImage` (key for the composition rewrite). | [[niivue-class-api]], [[nvimage-api]] |
| `removeVolume(vol)` | 🔴 removed (from controller) | Controller has no `removeVolume`. → `nv.model.removeVolume(index)` — **takes an index, not the volume object** (find index first). Verify public access path. | [[niivue-class-api]] |
| `updateGLVolume()` | 🟠 signature-changed | Now async. `await` where downstream code reads recomputed min/max. | [[niivue-class-api]] |
| `drawScene()` | 🟢 unchanged | Optional `needsSync` arg added; existing no-arg call fine. | [[niivue-class-api]] |
| `setScale(z)` | 🔴 removed | → `nv.scaleMultiplier = z` (setter). | [[niivue-class-api]] |
| `frac2mm([x,y,z])` | 🔴 removed (as method) | No method. Closest: `nv.model.scene2mm()` (vec3, scene-fraction) — **semantics differ**, verify numerically; or use the volume's `frac2mm` `mat4` directly. | [[niivue-class-api]] |
| `swizzleVec3MM(...)` | 🔴 removed | No export replacement. Inline the swizzle math in `ViewportBounds.ts`. | [[niivue-class-api]] |
| `sceneExtentsMinMax(true)` | 🟠 signature-changed (moved) | → `nv.model.sceneExtentsMinMax()` (arg dropped). Verify units. | [[niivue-class-api]] |
| `inRenderTile(x,y)` | 🔴 removed | → `view.hitTest(x,y): ViewHitTest` (`.isRender` / `.tileIndex`). Verify access path. | [[niivue-class-api]] |
| `screenFieldOfViewExtendedMM()` | 🟢 removed (never called) | fidnii only mentions it in comments (FOV math is replicated). No action. | [[niivue-class-api]] |
| `nv.sliceTypeRender` / `nv.sliceTypeAxial` (props) | 🟠 removed | → `SLICE_TYPE.RENDER` / `SLICE_TYPE.AXIAL`. | [[niivue-class-api]] |

---

## 3. `nv.scene` properties (the `scene` getter is removed) → see [[niivue-class-api]]

| Property (api-surface §3) | Status | Required action | Evidence |
|---|---|---|---|
| `scene.crosshairPos` (read + **write**) | 🟠 renamed | → `nv.crosshairPos` (r/w kept at controller level). | [[niivue-class-api]] |
| `scene.clipPlaneDepthAziElevs` (read + **write**) | 🔴 removed | → indexed `nv.setClipPlaneDepthAziElev(d,a,e,i)` / `getClipPlaneDepthAziElev(i)`. fidnii's whole-array write becomes a **per-plane loop**; multi-plane set/clear semantics **UNVERIFIED**. | [[niivue-class-api]] |
| `scene.volScaleMultiplier` | 🟠 renamed | → `nv.scaleMultiplier`. | [[niivue-class-api]] |
| `scene.renderAzimuth` | 🟠 renamed | → `nv.azimuth`. | [[niivue-class-api]] |
| `scene.renderElevation` | 🟠 renamed | → `nv.elevation`. | [[niivue-class-api]] |
| `scene.pan2Dxyzmm` | 🟠 renamed | → `nv.pan2Dxyzmm` (vec4 `[panX,panY,panZ,zoom]` kept). | [[niivue-class-api]] |

---

## 4. `nv.opts` / `nv.uiData` / `nv.canvas` / `nv.volumes` → see [[niivue-class-api]]

| Member (api-surface §4) | Status | Required action | Evidence |
|---|---|---|---|
| `opts.sliceType` (read) | 🟠 renamed (moved) | → `nv.sliceType`. (`opts` reshaped to a narrow `InfrastructureOpts`.) | [[niivue-class-api]] |
| `opts.dragMode` (write) | 🟠 renamed | → `nv.primaryDragMode` / `nv.setDragMode()` (primary/secondary split). | [[niivue-class-api]] |
| `uiData.dpr` | 🔴 removed (renamed) | `uiData` is gone. → `nv.devicePixelRatio` — **defaults to `-1`, not `1`**; keep/adjust the `?? 1` guard. | [[niivue-class-api]] |
| `uiData.activeClipPlaneIndex` | 🟠 renamed (moved) | → `nv.activeClipPlaneIndex` (direct controller prop). | [[niivue-class-api]] |
| `nv.canvas` | 🟢 unchanged | Read getter kept. Note: lifecycle may **replace** the `<canvas>` on backend switch — fidnii re-reads it each use, so low risk. | [[niivue-class-api]], [[rendering-backend]] |
| `nv.volumes` | 🟢 unchanged | Read getter kept (`.length`/`.includes`/`.filter`/`[0]`). | [[niivue-class-api]] |

---

## 5. Niivue events → see [[events]]

Transport model **preserved**: still `EventTarget` + `CustomEvent<NVEventMap[K]>`,
typed `addEventListener<K>`; `{ signal }` teardown unchanged. **All 5 fidnii
handlers ignore their `detail` payloads** (they re-derive from the live `nv`), so
payload reshapes are inert — only the **event name** and the registration-site
`e.detail.<field>` type must hold.

| Event (api-surface §5) | Status | Required action | Evidence |
|---|---|---|---|
| `clipPlaneChange` (`detail.clipPlane`) | 🟢 unchanged | `ClipPlaneChangeDetail = { clipPlane: number[] }`. None. | [[events]] |
| `sliceTypeChange` (`detail.sliceType`) | 🟢 unchanged | `SliceTypeChangeDetail = { sliceType: number }` (type widened `SLICE_TYPE`→`number`; may need a cast at the handler boundary). | [[events]] |
| `locationChange` (`detail`) | 🟢 unchanged | Name kept; `NiiVueLocation` reshaped but fidnii's handler ignores it → inert. | [[events]] |
| `mouseUp` | 🔴 renamed | → `pointerUp` (`PointerUpDetail`; good "end-of-interaction" match). Rename the listener string at `OMEZarrNVImage.ts:1838`. | [[events]] |
| `zoom3DChange` | 🔴 removed | No 3D-zoom event survives. Closest is `azimuthElevationChange` (**rotation, not zoom**). Use it for rotation; fidnii's existing canvas `wheel` listener already covers 3D zoom. **Runtime-verify** 3D zoom+rotate. | [[events]] |

---

## 6. `NVImage` subclass surface — the 🔴 blocker → see [[nvimage-api]]

**Verdict: `class OMEZarrNVImage extends NVImage` is not viable in 1.0.** `NVImage`
is `export type NVImage = { … }` (a plain object type with a `[key: string]:
unknown` index signature) — methodless, no constructor; the volume file
`volume/NVVolume.ts` has no class; volumes come from the factory
`nii2volume(hdr, img, name): NVImage`. **Recommended replacement: composition** —
`OMEZarrNVImage` *owns* a `volume: NVImage` (built via `nii2volume`), adds it with
`nv.addVolume(volume)`, and drives display through index-keyed controller methods
(the official extension pattern).

> ⚠ **Index-signature trap.** Because `NVImage` has `[key: string]: unknown`,
> every field rename below **compiles silently** and no-ops at runtime. Audit by
> **name**, not `tsc`.

| Member (api-surface §7) | Status | Required action | Evidence |
|---|---|---|---|
| `class … extends NVImage` + `super()` | 🔴 removed | Class→type. Compose a `nii2volume()`-built volume; no `super()`. | [[nvimage-api]] |
| `override get/set colormap` + `super.colormap = cm` | 🔴 removed | Accessor gone; `colormap?` is a data field, side effects via `nv.setVolume(index,{colormap})`. Set field + `setVolume`/`updateGLVolume`; propagate to slabs per-index. | [[nvimage-api]] |
| `_colormap` | 🔴 renamed | → `colormap` (data field). **Silent no-op** otherwise. | [[nvimage-api]] |
| `_opacity` | 🔴 renamed | → `opacity` (`NVTypes.ts:141`). **Silent no-op** otherwise. | [[nvimage-api]] |
| `img` (cast `as NVImage["img"]`) | 🟡 signature-changed | Now `TypedVoxelArray \| null` (required). Indexed cast still compiles. | [[nvimage-api]] |
| `hdr` + `hdr.affine/pixDims/dims/sform_code/cal_min/cal_max` | 🟢 unchanged | NIfTI header keeps **snake_case**; now non-null. None. | [[nvimage-api]] |
| `global_min` / `global_max` | 🟠 renamed | → `globalMin`/`globalMax`, now **required `number`** — the `= undefined` "force recompute" trick is gone (computed once by `nii2volume`). **Logic change**, not just a rename. | [[nvimage-api]] |
| `cal_min` / `cal_max` (volume-level) | 🟠 renamed | → `calMin`/`calMax` (distinct from the header's snake_case ones). | [[nvimage-api]] |
| `name` | 🟢 unchanged | None. | [[nvimage-api]] |
| `calMinMax()` | 🔴 removed (method) | → free fn `calMinMax(hdr, img)` (`volume/utils.ts`), different signature; not in top barrel. | [[nvimage-api]] |
| `calculateRAS()` | 🔴 removed (method) | → free fn `calculateRAS(nvImage)` (`math/NVTransforms.ts`) **and not publicly exported**. Rebuild via `nii2volume`, or `nv.setVolumeAffine(index, affine)`, or request an upstream export. | [[nvimage-api]] |
| `setColormapLabel({R,G,B,A,I,labels})` | 🔴 removed (method) | → `nv.setColormapLabel(index, cmap)` or `volume.colormapLabel = makeLabelLut(cmap)` (`makeLabelLut` **is** public). | [[nvimage-api]] |
| `ColorMap` `{R,G,B,A,I,labels}` shape | 🟢 unchanged | fidnii's payload is compatible. | [[nvimage-api]] |

---

## 7. Risk Hotspots

Ranked by blast radius. These are the items that will dominate the upgrade work.

### 🔴 H1 — `NVImage` subclassing → composition rewrite ([[nvimage-api]])
The single largest change. `OMEZarrNVImage extends NVImage` (the core of the
library) must become composition over a `nii2volume()`-built volume, touching the
constructor, the `colormap` override, every private-field write, and the
`calMinMax`/`calculateRAS`/`setColormapLabel` calls. The `[key: string]: unknown`
index signature means **renames fail silently** — plan a name-based audit, not a
`tsc`-only check. Depends on confirming `addVolume`/`setVolume` accept a prebuilt
volume and on a public RAS-recompute path (currently **UNVERIFIED**).

### 🔴 H2 — Rendering-backend selection for headless Playwright ([[rendering-backend]])
The default build **prefers WebGPU** and only falls back when `navigator.gpu` is
absent (an API-presence check). fidnii's headless Chromium tests run on
`--use-gl=egl` (a WebGL/ANGLE path); headless WebGPU needs special flags
(`--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader`).
**Action: force WebGL2** via `import … from "@niivue/niivue/webgl2"` or
`new Niivue({ backend: "webgl2" })`. No `playwright.config.ts` change needed if
WebGL2 is forced. This gates whether the existing test suite runs at all.

### 🔴 H3 — `scene` property renames / removal ([[niivue-class-api]])
`nv.scene` is gone as a first-class object. fidnii **writes** `crosshairPos`
(→ `nv.crosshairPos`) and `clipPlaneDepthAziElevs` (→ per-plane indexed
`setClipPlaneDepthAziElev`); read props `volScaleMultiplier`/`renderAzimuth`/
`renderElevation` are renamed. The clip-plane multi-plane set/clear semantics are
**UNVERIFIED** and are the riskiest sub-item (fidnii sets up to 6 planes at once).

### 🟠 H4 — Event payload shapes & renames ([[events]])
Lower risk than feared: transport preserved, 3/5 events unchanged, handlers ignore
`detail`. Real work is just two listener strings: `mouseUp`→`pointerUp` and
`zoom3DChange`→`azimuthElevationChange` (rotation-only; **runtime-verify** that 3D
zoom still triggers viewport-interaction-end via the existing `wheel` path).

### 🟠 H5 — Silent field-rename no-ops ([[nvimage-api]], [[enums-and-exports]])
Two classes of change that **pass `tsc` but break at runtime**: (a) the volume
index-signature renames (`_colormap`/`_opacity`/`global_min`/`cal_min`); (b)
`SLICE_TYPE[number]` reverse-lookups → `undefined` (buffer-key collision at
`OMEZarrNVImage.ts:2958`). Both need explicit, name-based remediation + a runtime
smoke test, since the type-checker won't flag them.

### 🟠 H6 — New async methods ([[niivue-class-api]])
`addVolume` and `updateGLVolume` are now async. Any fidnii path that reads
recomputed `globalMin/globalMax` or volume state immediately after must `await`
them, or risk acting on stale data.

---

## 8. Items requiring runtime verification (carry into the upgrade phase)

These could not be settled from source/types alone:

1. `frac2mm` → `nv.model.scene2mm()` numerical parity (coordinate correctness).
2. `inRenderTile` → `view.hitTest()` access path + tile-index parity.
3. `clipPlaneDepthAziElevs` multi-plane set/clear semantics via the indexed API.
4. `nv.devicePixelRatio` effective value (default `-1`) in the attached state.
5. `sceneExtentsMinMax()` return units after the move to `NVModel`.
6. `broadcastTo` persistent-subscription side effects (the new `clipPlane:true` default).
7. `removeVolume` public access path (`nv.model.removeVolume(index)` vs a controller helper).
8. A **public** RAS-recompute helper in rc.9 (replacing `calculateRAS()`), or whether `nv.setVolumeAffine()` suffices.
9. 3D zoom still firing `_handleViewportInteractionEnd` after the `zoom3DChange` removal.

---

## 9. Suggested upgrade sequencing (for later phases)

1. **Unblock the toolchain** — bump dep/peerDep ranges; force WebGL2; get `tsc`
   and the Playwright smoke test importing 1.0 at all (H2, [[enums-and-exports]]).
2. **Rebuild the volume layer** — convert `OMEZarrNVImage` to composition over
   `nii2volume()`; remediate the silent field renames (H1/H5, [[nvimage-api]]).
3. **Repoint the controller surface** — `Niivue`→`NiiVueGPU`, scene/opts/uiData
   renames, async `addVolume`/`updateGLVolume` (H3/H6, [[niivue-class-api]]).
4. **Events** — rename two listeners; runtime-verify 3D zoom (H4, [[events]]).
5. **Verify** — re-run the four [[index]] baseline commands and diff against the
   `Working/` logs to localize any regression.
