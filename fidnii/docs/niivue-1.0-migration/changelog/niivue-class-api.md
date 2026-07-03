---
type: research
title: Niivue 1.0 — Niivue Class API (NiiVueGPU)
created: 2026-06-22
tags:
  - niivue
  - changelog
  - breaking-change
related:
  - '[[index]]'
  - '[[migration-map]]'
  - '[[rendering-backend]]'
  - '[[events]]'
  - '[[nvimage-api]]'
  - '[[api-surface]]'
---

# Niivue 1.0 — Niivue Class API (NiiVueGPU)

Migration delta for the **main Niivue class** between `@niivue/niivue@0.68.1`
(fidnii baseline) and `@niivue/niivue@1.0.0-rc.9`. Scope: the class
constructor, instance methods, and the `scene` / `opts` / `uiData` / `volumes` /
`canvas` instance shapes that fidnii consumes (catalogued in [[api-surface]]).

**Evidence base.** 1.0 claims cite `niivue/mono@main`
(`packages/niivue/src/…`); the entire 203-file `src/` tree was downloaded and
grepped. Baseline (0.68.1) claims cite the shipped types
`@niivue/niivue@0.68.1/build/niivue/index.d.ts` (class at line 522) and
`…/build/nvdocument-CP74afCb.d.ts`. Line numbers are exact at time of capture
(2026-06-22) and may drift.

---

## 0. TL;DR — the class moved from a god-object to a thin controller + model

The single biggest structural change: **0.68's `Niivue` was a monolithic
`class … extends EventTarget`** with `scene`, `opts`, `uiData` as first-class
members. **1.0's class is `NiiVueGPU` (`NVControlBase.ts:204`,
`export default class NiiVueGPU extends EventTarget`)** — a *controller* that
holds a separate **`model: NVModel`** (`NVControlBase.ts:215`,
`this.model = new NVModel(options)` at `:318`). Most former `scene`/`opts`
state now lives on `this.model` (`model.scene` / `model.layout` /
`model.interaction` / `model.ui`), surfaced through **getters/setters on the
controller** for a curated subset.

Consequence for fidnii: every `nv.scene.*` access **breaks** (there is no
`get scene()` on the controller), and `nv.opts.*` / `nv.uiData.*` mostly break.
Methods split three ways: kept (sometimes async-ified), **demoted to a
property-setter**, or **removed/relocated to `NVModel` / `view` / `math`**.

> See [[rendering-backend]] for the `Niivue`→`NiiVueGPU` import/value rename
> backbone; this doc assumes `import { NiiVueGPU }` (or `import NiiVueGPU`,
> default) and `nv: NiiVueGPU`.

---

## 1. Constructor & readiness

| Aspect | 0.68.1 | 1.0.0-rc.9 | Action |
|---|---|---|---|
| Class identity | `class Niivue extends EventTarget` (`index.d.ts:522`) | `NiiVueGPU extends NiiVueGPUBase`; base is `class NiiVueGPU extends EventTarget` (`NVControlBase.ts:204`). Public ctor in `NVControl.ts:4-8`: `constructor(options: NiiVueOptions = {})` → `super(options, viewLifecycle, 'both')`. | **BREAKING (import)** — construct `new NiiVueGPU(options?)`; see [[rendering-backend]]. |
| Options type | `NVConfigOptions` | **`NiiVueOptions`** (`NVTypes.ts:674`), exported from package root (`index.ts:80`). Single optional arg; defaults to `{}`. | Type-only: annotate ctor options as `NiiVueOptions`. |
| Some option **names renamed** | `backColor`, `isOrientCube` accepted | `NiiVueOptions` has **`backgroundColor`** (`:696`) not `backColor`; **`isOrientCubeVisible`** (`:715`) not `isOrientCube`. (`crosshairWidth` `:729` and `isOrientationTextVisible` `:716` unchanged.) `sliceType` is also a valid ctor option (`:701`). | **BREAKING (low) — `test-page/main.ts:440-444,449-453`.** Rename `backColor`→`backgroundColor`, `isOrientCube`→`isOrientCubeVisible`. |
| Async readiness | `attachToCanvas` async | **Same gate, stricter.** `attachToCanvas` (async) runs `_viewLifecycle.attachToCanvas` → `ctrl.view.init()` ("single async entry point", `control/viewBoth.ts:33-58`). The renderer (`this.view`) is created **inside** `attachToCanvas`; before it resolves `this.view` is undefined and render methods early-return (e.g. `updateGLVolume` `if (!this.view) return` `NVControlBase.ts:1389`; `drawScene` guards `if (this.view)` `:2792`). | **Keep `await nv.attachToCanvas(canvas)` before any draw/update.** fidnii already awaits (`test-page/main.ts:445,455`). No new `await ready` needed, but volume/draw calls before attach are silent no-ops. |

`NiiVueOptions` is one flat options bag spanning Infrastructure / Scene / Layout
/ UI sections (`NVTypes.ts:674-…`) — distinct from the **runtime** `opts`
property (which is the narrow `InfrastructureOpts`, see §3).

---

## 2. Methods — fidnii-used surface

Legend: 🟥 **BREAKING** · 🟧 **BREAKING (mechanical rename)** · 🟩 unchanged.
fidnii call sites are from [[api-surface]] §2 (relative to `fidnii/`).

| Method (0.68 usage) | 0.68.1 signature | 1.0 status | Evidence (1.0) | fidnii action |
|---|---|---|---|---|
| `attachToCanvas` | `attachToCanvas(canvas, isAntiAlias?): Promise<this>` (`index.d.ts:979`) | 🟩 **unchanged** — still async, same shape. | `NVControlBase.ts:1373` `async attachToCanvas(canvas, isAntiAlias = null): Promise<this>` | None. `await nv.attachToCanvas(canvas)` (`test-page/main.ts:445,455`) is correct. |
| **`setSliceType`** | `setSliceType(st): this` (`index.d.ts:1946`) | 🟥 **REMOVED as a method → demoted to `sliceType` SETTER.** | No `setSliceType` definition anywhere in tree (verified). Replaced by `set sliceType(v)` `NVControlBase.ts:489-497` (writes `model.layout.sliceType`, emits `sliceTypeChange`+`change`, `drawScene()`). | **BREAKING — `test-page/main.ts:393,446,456`; `tests/slice-mode.spec.ts:301`.** `nv.setSliceType(v)` → **`nv.sliceType = v`**. |
| **`broadcastTo`** | `broadcastTo(otherNV, syncOpts?): …` (`index.d.ts:1005`) | 🟧 **present; signature/semantics changed.** Takes `(targets?, opts: SyncOpts)`; now **registers persistent sync targets** (stores `_syncTargets`/`_syncOpts`) rather than a one-shot push; default opts `{ '2d':true,'3d':true, clipPlane:true }`. Sync runs each frame via private `_sync()`. | `NVControlBase.ts:3125` `broadcastTo(targets?: NiiVueGPU \| NiiVueGPU[], opts: SyncOpts = {…}): void`. `SyncOpts` exported (`NVTypes.ts:598`, `index.ts:97`). | **VERIFY behavior — `test-page/main.ts:459-460`.** Call still type-checks (`nv.broadcastTo(nv2, { '2d':true,'3d':true })`), but is now a **subscription**, not a push; the existing bidirectional pair should still work. Drop manual re-broadcasting if any. Coordinate with [[events]]. |
| `addVolume` | `addVolume(volume): void` (`index.d.ts:1565`) | 🟧 **now ASYNC.** `async addVolume(volume): Promise<this>` — awaits model add, emits `volumeLoaded`, awaits `updateGLVolume()`. Accepts `ImageFromUrlOptions \| NVImage`. | `NVControlBase.ts:1613` `async addVolume(volume: ImageFromUrlOptions \| NVImage): Promise<this>`; model `NVModel.ts:1351` `async addVolume(…): Promise<void>`. | **BREAKING (return type) — `src/OMEZarrNVImage.ts:518,2726`; `test-page/main.ts:315`.** Fire-and-forget still compiles, but to guarantee the volume is registered + GL-updated before follow-on calls, **`await nv.addVolume(image)`**. fidnii currently calls it sync then immediately reads `nv.volumes`/draws — re-audit ordering. |
| **`removeVolume`** | `removeVolume(volume): void` — **takes the NVImage** (`index.d.ts:1760`) | 🟥 **REMOVED from the controller. Survivor is `NVModel.removeVolume(index)` — takes an INDEX, not the volume.** | No `removeVolume` in `NVControlBase.ts`. Only `NVModel.ts:1285` `removeVolume(index: number): void`. Controller-level removal is via `loadVolumes(...)` / `removeAllVolumes`. | **BREAKING (high) — `src/OMEZarrNVImage.ts:516,2717`; `test-page/main.ts:298,301`.** `nv.removeVolume(vol)` → e.g. `nv.model.removeVolume(nv.volumes.indexOf(vol))` (then likely `await nv.updateGLVolume()`), **or** adopt the new `loadVolumes`/`removeAllVolumes` controller API. Confirm a public removal path exists before relying on `nv.model.*`. |
| `updateGLVolume` | `updateGLVolume(): void` (`index.d.ts:2495`) | 🟧 **now ASYNC.** `async updateGLVolume()`; debounced/re-entrant (`_updating`/`_pendingUpdate`); early-returns if `!this.view`; ends with `drawScene()`. | `NVControlBase.ts:1381-1399`. | **BREAKING (return type) — `src/OMEZarrNVImage.ts:856,1627,2276,2734,3046`.** fidnii calls it synchronously (fire-and-forget) to trigger `refreshLayers()`/`calMinMax()`. It still schedules the work, but is now a `Promise`; **`await` it** where the next step depends on recomputed `global_min/max` / textures. Cross-check the `calMinMax` contract in [[nvimage-api]]. |
| `drawScene` | `drawScene(): string \| void` (`index.d.ts:3417`) | 🟩 **present** (optional arg added). `drawScene(needsSync = true): void` — rAF-batched render; sets sync-dirty. No-arg call unchanged. | `NVControlBase.ts:2778`. | None. `nv.drawScene()` (`src/OMEZarrNVImage.ts:1305,2551,3065`) is fine (return value was never used). |
| **`setScale`** | `setScale(scale): void` (`index.d.ts:2005`) | 🟥 **REMOVED.** No `setScale` anywhere. Zoom is now the **`scaleMultiplier` getter/setter** (`get/set scaleMultiplier`) proxying `model.scene.scaleMultiplier`. | `NVControlBase.ts:442-447`. (0.68 read this as `scene.volScaleMultiplier` — renamed, see §4.) | **BREAKING — `src/OMEZarrNVImage.ts:1940`.** `nv.setScale(z)` → **`nv.scaleMultiplier = z`**. (Comment "no internal clamp" still applies — the setter does not clamp.) |
| **`frac2mm`** | `frac2mm(frac, volIdx?, isForceSliceMM?): vec4` (`index.d.ts:3283`) | 🟥 **REMOVED as a controller method.** `frac2mm` is now a **`mat4` PROPERTY** on the volume (`NVTypes.ts:119` `frac2mm?: mat4`), assigned in `math/NVTransforms.ts:598`. The controller's fraction→mm replacement is **`NVModel.scene2mm(inPos): vec3`** (`NVModel.ts:455`), inverse `mm2scene` (`:472`). | — | **BREAKING (high) — `src/OMEZarrNVImage.ts:2096,2499,2605`.** `nv.frac2mm([x,y,z])` no longer exists. Options: (a) `nv.model.scene2mm([x,y,z])` if the input is a **scene fraction** (note: returns `vec3`, was `vec4`); or (b) multiply by the volume's `frac2mm` `mat4` via `gl-matrix`. **Semantics differ** (scene-fraction vs per-volume frac, and the old `volIdx`/`isForceSliceMM` knobs are gone) — re-derive carefully against the slab/affine math. **UNVERIFIED** which replacement reproduces fidnii's exact "mm in current volume's affine space" result; validate numerically. |
| **`swizzleVec3MM`** | `swizzleVec3MM(v3, axCorSag): vec3` (`index.d.ts:3085`) | 🟥 **REMOVED.** No `swizzleVec3MM` / no `swizzle` function anywhere (only comments). Swizzle logic absorbed into `math/NVTransforms.ts` / `view/NVSliceLayout.ts`. | — | **BREAKING — `src/ViewportBounds.ts:271`.** No drop-in. fidnii already *replicates* the swizzle mapping inline (the switch in `computeViewportBounds2D`); **inline the pan swizzle the same way** (AXIAL/CORONAL/SAGITTAL → screen-axis map) instead of calling `nv.swizzleVec3MM`. **UNVERIFIED** whether any exported helper reproduces it 1:1. |
| `sceneExtentsMinMax` | `sceneExtentsMinMax(isSliceMM?): vec3[]` (`index.d.ts:3154`) | 🟥 **MOVED to `NVModel` and arg-dropped.** `NVModel.sceneExtentsMinMax(): [vec3,vec3,vec3]` — **no `isSliceMM` parameter**. Not present on the controller. | `NVModel.ts:516`. | **BREAKING — `src/ViewportBounds.ts:60`.** `nv.sceneExtentsMinMax(true)` → **`nv.model.sceneExtentsMinMax()`** (drop the `true`). Return is `[min, max, range]` (fidnii already uses `[0]`/`[1]`/`[2]`). **VERIFY** the dropped `isSliceMM=true` did not change units fidnii relied on. |
| **`inRenderTile`** | `inRenderTile(x, y): number` (`index.d.ts:2740`) | 🟥 **REMOVED.** Replaced by **`view.hitTest(x, y): ViewHitTest \| null`** (per-backend: `gl/NVViewGL.ts:1192`, `wgpu/NVViewGPU.ts:1874`), exposed on the view (`NVControlBase.ts:121`) and wrapped at `control/interactions.ts:1431`. `ViewHitTest` (`NVTypes.ts:610`) = `{ isRender, sliceType, normalizedX, normalizedY, tileIndex }`. | — | **BREAKING — `src/OMEZarrNVImage.ts:1910`.** fidnii uses `inRenderTile(x,y) < 0` to test "outside the 3D render tile." Replace with a `hitTest`-based check: `const h = nv.view?.hitTest(x,y); const inRender = h?.isRender ?? (h ? h.sliceType === SLICE_TYPE.RENDER : false)`. **UNVERIFIED**: exact public access path to `hitTest` (via `nv.view` vs a controller wrapper) and tile-index parity with the old return value — validate. |
| `screenFieldOfViewExtendedMM` | `screenFieldOfViewExtendedMM(axCorSag?): MM` (`index.d.ts:3105`) | 🟥 **REMOVED** (no `fieldOfView`/`FOV` method). FOV is now per-tile data `fovMM` on each screen-slice (`view/NVSliceLayout.ts:95-99,125-133`). | — | **None required (low).** fidnii **deliberately does not call it** ([[api-surface]] §2) — it replicates the FOV math. The replication's dependence on `pan2Dxyzmm`/`volScaleMultiplier` is the real exposure → see §4 renames. |

---

## 3. `nv.opts` and `nv.uiData` — narrowed / removed

| Member (0.68 usage) | 0.68.1 | 1.0.0-rc.9 | fidnii action |
|---|---|---|---|
| `nv.opts` (the bag itself) | `get opts(): NVConfigOptions` (`index.d.ts:882`) — the full ~150-field config | 🟥 **Reshaped.** `opts: InfrastructureOpts` (`NVControlBase.ts:208`) — a **narrow infra-only** type (`NVControlBase.ts:137-150`: `backend, isAntiAlias, isDragDropEnabled, forceDevicePixelRatio, logLevel, thumbnail, font, matcaps, bounds, showBoundsBorder, boundsBorderColor, boundsBorderThickness`). Scene/Layout/UI/Interaction config moved to `model.scene`/`model.layout`/`model.ui`/`model.interaction`. | Treat `nv.opts` as **infra-only**. |
| **`nv.opts.sliceType`** (read) | on `NVConfigOptions` (`nvdocument…d.ts:1515`) | 🟥 **GONE from `opts`.** Now `nv.sliceType` getter → `model.layout.sliceType` (`NVControlBase.ts:489`). | **BREAKING — `src/OMEZarrNVImage.ts:2401`; `tests/slice-mode.spec.ts:30,42,56,519`.** `const { sliceType } = nv.opts` → **`const sliceType = nv.sliceType`**. |
| **`nv.opts.dragMode`** (write) | `dragMode: DRAG_MODE` (`nvdocument…d.ts:1639`) | 🟥 **GONE from `opts`.** Drag config now `model.interaction.primaryDragMode`/`secondaryDragMode` (`InteractionConfig`, `NVTypes.ts:586-592`). Controller exposes `get/set primaryDragMode` & `secondaryDragMode` (`NVControlBase.ts:1126-1139`) and **`setDragMode(mode: string \| number)`** (`:3086`). | **BREAKING — `test-page/main.ts:417`.** `nv2.opts.dragMode = …` → **`nv2.primaryDragMode = …`** (or `nv2.setDragMode(…)`). Note 0.68's single `dragMode` is now split primary/secondary — pick `primaryDragMode` for the left-drag behavior fidnii sets. |
| **`nv.uiData`** (the bag) | `uiData: UIData` (`index.d.ts:618`) | 🟥 **REMOVED entirely.** No `uiData` property/getter anywhere in 1.0. Its fields were redistributed onto the controller / view. | All `nv.uiData.*` break — see below. |
| **`nv.uiData.dpr`** (read) | `dpr?: number` (`nvdocument…d.ts:274`) | 🟥 **Relocated/renamed.** Device-pixel ratio is now `get/set devicePixelRatio` on the controller (`NVControlBase.ts:1533`; reads `opts.forceDevicePixelRatio ?? -1`). The view owns `forceDevicePixelRatio`. | **BREAKING — `src/OMEZarrNVImage.ts:1905`.** `nv.uiData.dpr ?? 1` → **`nv.devicePixelRatio`** (note: defaults to `-1` when unset, *not* 1 — guard accordingly, e.g. `const dpr = nv.devicePixelRatio > 0 ? nv.devicePixelRatio : (window.devicePixelRatio ?? 1)`). **UNVERIFIED** exact "effective dpr" getter parity with old `uiData.dpr` (which tracked the *actual* ratio); validate the value used for canvas math. |
| **`nv.uiData.activeClipPlaneIndex`** (read) | `activeClipPlaneIndex: number` (`nvdocument…d.ts:283`) | 🟧 **Promoted to a direct controller property.** `activeClipPlaneIndex: number` on `NiiVueGPU` (`NVControlBase.ts:205`, init `:279`). | **BREAKING (mechanical) — `src/OMEZarrNVImage.ts:1915`.** `nv.uiData.activeClipPlaneIndex` → **`nv.activeClipPlaneIndex`**. |

---

## 4. `nv.scene` — getter removed; fields renamed/relocated

**🟥 BREAKING (structural).** 0.68 exposed `get scene(): Scene`
(`index.d.ts:880`). **1.0 has no `scene` getter on the controller.** Scene state
is `this.model.scene: SceneConfig` (`NVModel.ts:37`; type `NVTypes.ts:493-503`).
The controller forwards a *subset* via getters/setters. fidnii both **reads and
writes** `nv.scene.*` ([[api-surface]] §3, flagged high-risk), so all of these
break.

`SceneConfig` (1.0) = `{ azimuth, elevation, crosshairPos, pan2Dxyzmm,
scaleMultiplier, gamma, backgroundColor, clipPlaneColor, isClipPlaneCutaway }`
(`NVTypes.ts:493-503`). Note what's **absent**: no `clipPlaneDepthAziElevs`, no
`volScaleMultiplier`, no `renderAzimuth`/`renderElevation`.

| `nv.scene.*` (0.68 field) | 0.68.1 | 1.0.0-rc.9 mapping | fidnii action |
|---|---|---|---|
| **`crosshairPos`** (read **+ write**) | `crosshairPos: vec3` (`nvdocument…d.ts:1722`) | ✅ field kept on `SceneConfig` (`NVTypes.ts:496`). Controller has **`get/set crosshairPos`** → `model.scene.crosshairPos` (`NVControlBase.ts:424-428`). The setter is a **plain assignment** (no extra recompute). | **BREAKING — read `src/OMEZarrNVImage.ts:2093,2494,2603` + `tests/slice-mode.spec.ts:378,518`; write `:2550,3064`.** `nv.scene.crosshairPos` → **`nv.crosshairPos`** (works for both read and `nv.crosshairPos = frac` write). |
| **`clipPlaneDepthAziElevs`** (read **+ write**) | `clipPlaneDepthAziElevs: number[][]` (`nvdocument…d.ts:1724`) | 🟥 **REMOVED from scene. Replaced by an indexed METHOD API.** Set: `setClipPlaneDepthAziElev(depth, azimuth, elevation, index?)` (`NVControlBase.ts:1548` → `NVModel.ts:522`). Get: `getClipPlaneDepthAziElev(index = 0): [number,number,number]` (`NVControlBase.ts:1545`). | **BREAKING (high) — write `src/OMEZarrNVImage.ts:1099,1102`; read `:1914`.** fidnii writes an **array of `[depth,azi,elev]`** to `nv.scene.clipPlaneDepthAziElevs`. New API is **per-plane, indexed, imperative**: loop and call `nv.setClipPlaneDepthAziElev(d, a, e, i)` per plane (and the "disable" sentinel `[2,0,0]` → `nv.setClipPlaneDepthAziElev(2,0,0,i)`). To read the active plane, `nv.getClipPlaneDepthAziElev(nv.activeClipPlaneIndex)`. **UNVERIFIED**: how multi-plane count is established/cleared (does writing index `i` auto-grow the set? is there a "number of clip planes" control?) — inspect `setClipPlaneDepthAziElev`/`activeClipPlaneIndex` semantics (`NVControlBase.ts:1548-1585`) before porting fidnii's whole-array replace. |
| **`volScaleMultiplier`** (read) | `volScaleMultiplier: number` (`nvdocument…d.ts:1725`) | 🟧 **RENAMED → `scaleMultiplier`** (`SceneConfig`, `NVTypes.ts:498`). Controller getter `get scaleMultiplier()` (`NVControlBase.ts:443`). | **BREAKING (mechanical) — `src/OMEZarrNVImage.ts:1935`; `src/ViewportBounds.ts:76`.** `nv.scene.volScaleMultiplier` → **`nv.scaleMultiplier`** (or `nv.model.scene.scaleMultiplier`). The `\|\| 1` fallback in `ViewportBounds.ts:76` still applies. |
| **`renderAzimuth`** (read) | `renderAzimuth: number` (`nvdocument…d.ts:1742`) | 🟧 **RENAMED → `azimuth`** (`SceneConfig`, `NVTypes.ts:494`). Controller `get azimuth()` → `model.scene.azimuth` (`NVControlBase.ts:399`). | **BREAKING (mechanical) — `src/ViewportBounds.ts:109`.** `nv.scene.renderAzimuth ?? 0` → **`nv.azimuth`** (default already 110 in model `:98`; keep `?? 0` if a numeric guard is wanted). |
| **`renderElevation`** (read) | `renderElevation: number` (paired w/ above) | 🟧 **RENAMED → `elevation`** (`SceneConfig`, `NVTypes.ts:495`). Controller `get elevation()` (`NVControlBase.ts:412`). | **BREAKING (mechanical) — `src/ViewportBounds.ts:110`.** `nv.scene.renderElevation ?? 0` → **`nv.elevation`**. |
| **`pan2Dxyzmm`** (read) | `pan2Dxyzmm: vec4` (`nvdocument…d.ts:1726`) | ✅ field kept (`SceneConfig`, `NVTypes.ts:497`). Controller **`get/set pan2Dxyzmm`** → `model.scene.pan2Dxyzmm` (`NVControlBase.ts:433-437`). | **BREAKING (mechanical) — `src/ViewportBounds.ts:269`.** `nv.scene.pan2Dxyzmm` → **`nv.pan2Dxyzmm`**. Still `[panX,panY,panZ,zoom]` vec4. |

> **Note on the replicated-FOV hotspot ([[api-surface]] §2/§9).** Because fidnii
> bypasses `screenFieldOfViewExtendedMM` and re-derives FOV from
> `pan2Dxyzmm` + `volScaleMultiplier`, the renames above (`volScaleMultiplier`→
> `scaleMultiplier`) and the removed `swizzleVec3MM`/`frac2mm` are exactly the
> dependencies that must be re-pointed for the math in `ViewportBounds.ts` to
> stay correct. Validate viewport bounds numerically after porting.

---

## 5. `nv.canvas` and `nv.volumes` — instance members

| Member (0.68 usage) | 0.68.1 | 1.0.0-rc.9 | fidnii action |
|---|---|---|---|
| `nv.canvas` (read, `HTMLCanvasElement`) | `canvas: HTMLCanvasElement \| null` (`index.d.ts:526`) | 🟩 **kept.** `canvas: HTMLCanvasElement \| null = null` (`NVControlBase.ts:207`); assigned during `attachToCanvas`. Still the rendered `<canvas>`. | **None** — `src/OMEZarrNVImage.ts:1856,1893,1902`; `src/ViewportBounds.ts:79,243` keep working (still guard `if (nv.canvas)`). ⚠ WebGPU backend implications for the DOM `wheel` listeners ([[api-surface]] §4) belong to [[rendering-backend]], not this delta. |
| `nv.volumes` (read, `NVImage[]`) | `get volumes(): NVImage[]` (`index.d.ts:947`) | 🟩 **kept (read getter).** `get volumes()` → `model.volumes` (`NVControlBase.ts:1598`). (0.68 also had a `set volumes`; 1.0 exposes only the getter on the controller — fidnii never sets it.) | **None for reads** — `.includes()/.filter()/.length/[0]` etc. all fine (`src/OMEZarrNVImage.ts:510,1917,2094,…`; `test-page/main.ts:297-301`). **Indirect mutation changes**: the array is now populated by **async** `addVolume` and emptied by `NVModel.removeVolume(index)` (no controller `removeVolume`) — see §2. The `while (nv.volumes.length > 0) nv.removeVolume(nv.volumes[0])` loops (`test-page/main.ts:297-302`) **break** on the `removeVolume` call, not the `.volumes` read. |

---

## 6. Instance "convenience" slice-type properties (was [[api-surface]] §6)

| Property (0.68 usage) | 0.68.1 | 1.0.0-rc.9 | fidnii action |
|---|---|---|---|
| **`nv.sliceTypeRender`** (read) | `sliceTypeRender: SLICE_TYPE` (`index.d.ts:671`) | 🟥 **REMOVED.** No `sliceTypeRender`/`sliceTypeAxial`/`Coronal`/`Sagittal`/`MultiPlanar` instance props anywhere in 1.0. | **BREAKING — `test-page/main.ts:446`.** `nv.setSliceType(nv.sliceTypeRender)` → **`nv.sliceType = SLICE_TYPE.RENDER`** (one fix covers both the removed prop *and* the removed `setSliceType`). |
| **`nv.sliceTypeAxial`** (read) | `sliceTypeAxial: SLICE_TYPE` (`index.d.ts:667`) | 🟥 **REMOVED.** (as above) | **BREAKING — `test-page/main.ts:456`.** → **`nv.sliceType = SLICE_TYPE.AXIAL`**. |

(`SLICE_TYPE` itself remains exported from the package root — `index.ts:31`,
re-exported from `./NVConstants` — see [[enums-and-exports]].)

---

## 7. Quick migration map (controller members → 1.0)

```
new Niivue(opts)                  → new NiiVueGPU(opts: NiiVueOptions)
nv.scene                          → nv.model.scene   (no controller getter)
nv.opts                           → nv.opts (InfrastructureOpts; narrow!) / nv.model.{scene,layout,ui,interaction}
nv.uiData                         → REMOVED

nv.setSliceType(v)                → nv.sliceType = v
nv.sliceTypeRender / Axial        → SLICE_TYPE.RENDER / SLICE_TYPE.AXIAL
nv.setScale(z)                    → nv.scaleMultiplier = z
nv.removeVolume(vol)              → nv.model.removeVolume(idx)   [no controller method; verify public API]
nv.addVolume(img)                 → await nv.addVolume(img)      [now async]
nv.updateGLVolume()               → await nv.updateGLVolume()    [now async]
nv.frac2mm([x,y,z])               → nv.model.scene2mm(...)  OR  volume.frac2mm (mat4)   [semantics differ — verify]
nv.swizzleVec3MM(v, st)           → inline swizzle (no replacement export)
nv.sceneExtentsMinMax(true)       → nv.model.sceneExtentsMinMax()   [no arg]
nv.inRenderTile(x,y)              → nv.view?.hitTest(x,y) → .isRender / .tileIndex   [verify access path]
nv.drawScene()                    → nv.drawScene()               [unchanged]
nv.attachToCanvas(c)              → nv.attachToCanvas(c)          [unchanged, async]
nv.broadcastTo(o, opts)           → nv.broadcastTo(o, opts)       [now persistent subscription]

nv.scene.crosshairPos             → nv.crosshairPos              (get/set)
nv.scene.clipPlaneDepthAziElevs   → nv.setClipPlaneDepthAziElev(d,a,e,i) / nv.getClipPlaneDepthAziElev(i)
nv.scene.volScaleMultiplier       → nv.scaleMultiplier
nv.scene.renderAzimuth            → nv.azimuth
nv.scene.renderElevation          → nv.elevation
nv.scene.pan2Dxyzmm               → nv.pan2Dxyzmm               (get/set)

nv.opts.sliceType                 → nv.sliceType
nv.opts.dragMode = m              → nv.primaryDragMode = m  (or nv.setDragMode(m))
nv.uiData.dpr                     → nv.devicePixelRatio          [default -1, not 1 — guard]
nv.uiData.activeClipPlaneIndex    → nv.activeClipPlaneIndex
nv.canvas                         → nv.canvas                    [unchanged]
nv.volumes                        → nv.volumes                   [read getter unchanged]
```

---

## 8. Open items to verify during implementation (`**UNVERIFIED**`)

1. **`frac2mm` replacement parity** — does `model.scene2mm` (scene-fraction in,
   `vec3` out) reproduce fidnii's old `nv.frac2mm([x,y,z])` ("mm in *current
   volume's* affine space", `vec4` out)? The input space (scene fraction vs
   volume fraction) and the dropped `volIdx`/`isForceSliceMM` args may change
   results. Validate numerically (§2).
2. **`hitTest` access + tile-index parity** — confirm the public way to reach
   `hitTest` (via `nv.view` or a controller wrapper) and that
   `isRender`/`tileIndex` reproduces `inRenderTile(x,y) < 0` (§2).
3. **`setClipPlaneDepthAziElev` multi-plane semantics** — how the indexed setter
   establishes/clears the *set* of planes vs fidnii's whole-array replace, and
   how `activeClipPlaneIndex` interacts (§4).
4. **`devicePixelRatio` value** — whether the controller getter returns the
   *effective* DPR (like old `uiData.dpr`) or just the forced override (`-1`
   when unset). Affects `nv.canvas` math (§3).
5. **`sceneExtentsMinMax()` units** — confirm dropping the old `isSliceMM=true`
   argument doesn't change the units fidnii consumes in `ViewportBounds` (§2).
6. **`broadcastTo` subscription semantics** — confirm the new persistent-target
   model preserves fidnii's bidirectional crosshair sync without double-firing
   (§2; coordinate with [[events]]).
7. **`removeVolume` public path** — confirm whether `nv.model.removeVolume` is
   the intended public API or if `loadVolumes`/`removeAllVolumes` should be used
   instead (§2/§5).
