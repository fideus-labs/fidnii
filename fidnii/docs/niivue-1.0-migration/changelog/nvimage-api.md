---
type: research
title: Niivue 1.0 — NVImage / NVVolume API (subclassing)
created: 2026-06-22
tags:
  - niivue
  - changelog
  - breaking-change
related:
  - '[[index]]'
  - '[[migration-map]]'
  - '[[niivue-class-api]]'
  - '[[enums-and-exports]]'
  - '[[api-surface]]'
---

# Niivue 1.0 — NVImage / NVVolume API (subclassing)

Scope: `@niivue/niivue@0.68.1` (fidnii baseline) → `@niivue/niivue@1.0.0-rc.9`,
focused on the **`NVImage` subclass surface** that
`src/OMEZarrNVImage.ts` depends on (`export class OMEZarrNVImage extends
NVImage`, reaching into private fields). This is the single highest-risk topic
in the migration.

> Evidence convention: 0.68.1 citations are line numbers in the baseline
> declaration bundle
> `node_modules/.bun/@niivue+niivue@0.68.1/.../build/nvdocument-CP74afCb.d.ts`
> (the `declare class NVImage` starts at line 914). 1.0 citations are file +
> line in `niivue/mono@main` `packages/niivue/src/` (fetched 2026-06-22 via
> `raw.githubusercontent.com` / `gh api`). The 1.0 package version on `main` is
> `1.0.0-rc.x`; `rc.9` is the migration target.

---

## VERDICT — `extends NVImage` is DEAD in 1.0 🔴 CRITICAL / BLOCKER

**`extends NVImage` is impossible in 1.0. `NVImage` is no longer a class — it is
a plain object type, and the package exports it as a TYPE ONLY. There is no
constructable volume value (`NVImage`, `NVVolume`, or otherwise) exported from
any entrypoint.** The entire `OMEZarrNVImage extends NVImage` strategy must be
replaced.

Three independent proofs:

1. **`NVImage` is `export type NVImage = { ... }`** — a structural object type
   with an index signature `[key: string]: unknown`
   (`src/NVTypes.ts:98–188`, index sig at `:187`). It has **fields only, no
   methods** — no constructor, no `colormap` accessor, no `calMinMax()`, no
   `calculateRAS()`, no `setColormapLabel()`.

2. **No value export of a volume class anywhere.** Grepping every entrypoint for
   an `export { … }` value line naming `NVImage`/`NVVolume` returns nothing.
   `NVImage` appears only inside `export type { … } from './NVTypes'` in all
   three barrels:
   - `src/index.ts:64,83` (`export type { … NVImage … }`)
   - `src/index.webgpu.ts:19,35`
   - `src/index.webgl2.ts:19,35`
   The only value exports from the volume module are **functions**:
   `export { nii2volume, writeVolume } from './volume/NVVolume'`
   (`src/index.ts:121`) and `export { extractVoxelFid, getImageDataRAS } from
   './volume/utils'` (`src/index.ts:131`).

3. **The volume "class" file contains no class.** `src/volume/NVVolume.ts`
   (314 lines) has **no `class`, no `export class`, no `extends`** anywhere. The
   volume is built by a factory that returns a plain object literal:
   `const volume: NVImage = { img, hdr, … }` (`src/volume/NVVolume.ts:265–313`),
   produced by `export function nii2volume(hdr, img, name?, limitFrames4D?):
   NVImage` (`:193`).

There is no subclass hook, no "registered loader" base class, and no
composition base to extend. **A volume in 1.0 is just data.**

### Recommended replacement strategy

Convert `OMEZarrNVImage` from an `NVImage` **subclass** to a **controller /
composition** object that:

- **Owns** an `NVImage` plain object (call it `this.volume`), built once via
  `nii2volume(hdr, img, name)` (public export). All the per-frame work that
  today mutates `this.hdr`/`this.img`/`this._colormap` becomes mutation of
  `this.volume.hdr` / `this.volume.img` / `this.volume.colormap`.
- **Adds** that object to Niivue with `nv.addVolume(this.volume)` —
  `addVolume(volume: ImageFromUrlOptions | NVImage)` accepts a prebuilt
  `NVImage` object directly (`src/NVControlBase.ts:1613`). This is exactly how
  the official extension API does it: `context.addVolume(vol: NVImage)` →
  `this.nv.addVolume(vol)` (`src/extension/context.ts:282–283`), where the
  extension built `vol` via `nii2volume` / `buildDerivedScalarVolume(…,
  nii2volume)` (`src/extension/context.ts:19,199`).
- **Drives display changes through instance methods keyed by volume index**
  instead of volume accessors: `nv.setVolume(index, { colormap, opacity,
  calMin, calMax, … })` (`src/NVControlBase.ts:2262`) and
  `nv.setColormapLabel(index, cmap)` (`src/NVControlBase.ts:2215`).
- **Re-derives RAS after writing the affine** via the free function
  `NVTransforms.calculateRAS(volume)` (see ⚠ caveat below — not part of the
  public barrel).

This mirrors fidnii's *existing* composition machinery: `OMEZarrNVImage`
already keeps a `private readonly niivue: Niivue` (`OMEZarrNVImage.ts:142`), a
`private readonly _eventTarget = new EventTarget()`
(`OMEZarrNVImage.ts:228`), and per-slab `nvImage` objects — so the codebase is
already half-composition. The migration extends that pattern to the primary
volume.

> **⚠ Public-API gap — `calculateRAS` is not exported.**
> `nii2volume` calls `NVTransforms.calculateRAS(volume)` internally
> (`src/volume/NVVolume.ts:297`), but `calculateRAS` (defined
> `src/math/NVTransforms.ts:638` as `export function calculateRAS(nvImage:
> NVImage): void`) is **not** re-exported from `src/index.ts`. fidnii currently
> calls `this.calculateRAS()` after every header rewrite
> (`OMEZarrNVImage.ts:994,3162`). In 1.0 there is **no public way to recompute
> RAS on an existing volume after mutating its affine** — the only public path
> that runs `calculateRAS` is constructing a *fresh* volume with `nii2volume`,
> or `nv.setVolumeAffine(index, affine)` (`src/NVControlBase.ts:2285`), which
> recomputes via `updateVolumeAffineOnly()`. **Action: file an upstream request
> to export `calculateRAS`, or rebuild the volume object via `nii2volume` on
> each region load (heavier), or route every affine change through
> `nv.setVolumeAffine`.** Flagged **UNVERIFIED** whether `rc.9` adds a public
> RAS-recompute helper — not present on `main` today.

---

## Member-by-member matrix (fidnii usage → 0.68 → 1.0 → status → action)

Legend: 🔴 critical/blocking · 🟠 breaking, mechanical fix · 🟡 minor/rename ·
🟢 unchanged.

| fidnii-used member | 0.68 shape (baseline) | 1.0 shape | Status | Action |
|---|---|---|---|---|
| **`class … extends NVImage`** | `declare class NVImage { … }` — real constructable/extendable class (`d.ts:914`) | `export type NVImage = { … }` — plain object type, methodless, `[key: string]: unknown` (`NVTypes.ts:98–188`) | **🔴 REMOVED (class→type)** | Stop subclassing. Compose: own a `volume: NVImage` built by `nii2volume(...)`. |
| **`super()` (no-arg ctor)** | `constructor(dataBuffer?, name?, …)` — all params optional; no-arg construction OK (`d.ts:~990`) + `init()` + `static new()`/`static loadFromUrl()` factories | **No constructor.** Volume is built by `nii2volume(hdr, img, name='', limitFrames4D=Infinity): NVImage` (`NVVolume.ts:193`), returning an object literal (`:265`) | **🔴 REMOVED** | Replace `super()` + `initializeNVImageProperties()` with a `nii2volume(hdr, img, name)` factory call producing `this.volume`. |
| **`override get/set colormap`** | `get colormap(): string` + `set colormap(cm: string)` accessor pair (also `colorMap` alias); setter ran `calMinMax` + `onColormapChange` (`d.ts` accessor block) | Plain data field `colormap?: string` on the object (`NVTypes.ts:134`). **No accessor, no side effects.** Side effects now live on the instance: `nv.setVolume(index, { colormap })` does `Object.assign` + emits `volumeUpdated` + `updateGLVolume` (`NVControlBase.ts:2262–2277`) | **🔴 ACCESSOR REMOVED** | Can't `override`/intercept a setter. To propagate colormap to slabs: set `this.volume.colormap = cm` then for each slab call `nv.setVolume(slabIndex, { colormap: cm })` (or assign `slab.colormap` + `updateGLVolume`). |
| **`super.colormap = cm`** | inherited settable accessor with `calMinMax`+`onColormapChange` side effects | n/a — no accessor to delegate to | **🔴 REMOVED** | Replace with `this.volume.colormap = cm` + `nv.setVolume(index, { colormap: cm })` (which re-runs the display pipeline via `updateGLVolume`). |
| **`_colormap` (private backing)** | `_colormap: string` — declared field, written directly by fidnii (`OMEZarrNVImage.ts:584,2674`; read `:127`) (`d.ts:919`) | **GONE.** No `_colormap` on the type. The public field is `colormap` (`NVTypes.ts:134`). Index sig `[key: string]: unknown` means writes won't *type*-error but the renderer reads `colormap`, not `_colormap` | **🔴 REMOVED/RENAMED** → `colormap` | Replace all `_colormap` reads/writes with `colormap`. Beware: index signature hides the rename — **no compile error**, silent no-op at render time. |
| **`_opacity` (private backing)** | `_opacity: number` — written by fidnii (`OMEZarrNVImage.ts:586,2676`) (`d.ts:920`) | **GONE.** Public field is `opacity?: number` (`NVTypes.ts:141`) | **🔴 REMOVED/RENAMED** → `opacity` | Replace `_opacity = 1.0` with `opacity = 1.0` (or `nv.setVolume(index, { opacity: 1 })`). Same silent-no-op trap via index sig. |
| **`img`** | `img?: TypedVoxelArray` (`d.ts`); fidnii casts `… as NVImage["img"]` (`:580,827,1620`) | `img: TypedVoxelArray \| null` (**required**, nullable) (`NVTypes.ts:103`). `NVImage["img"]` indexed type still resolves | **🟡 nullability changed** | `NVImage["img"]` cast still compiles. Set `this.volume.img = …`. Note required-but-nullable; `nii2volume` always sets it. |
| **`hdr`** | `hdr: NIFTI1 \| NIFTI2 \| null` (`d.ts`) | `hdr: NIFTI1 \| NIFTI2` (**non-null**) (`NVTypes.ts:101`). `NIFTI1 = NIFTI2 = NIFTIHeader` alias (`NVTypes.ts:62–63`) | **🟢 present (non-null now)** | `this.volume.hdr = new NIFTI1()` still works (`NIFTI1` is the structural header type). Drop the `if (!this.hdr) return` null-guards (or keep harmlessly). |
| `hdr.affine` | `number[][]` on NIFTI header | `affine: number[][]` (`NVTypes.ts:57`) — **snake_case preserved on the header** | **🟢 unchanged** | `this.volume.hdr.affine = …` unchanged. |
| `hdr.pixDims` | `pixDims: number[]` | `pixDims: number[]` (`NVTypes.ts:29`) | **🟢 unchanged** | unchanged. |
| `hdr.dims` | `dims: number[]` | `dims: number[]` (`NVTypes.ts:28`) | **🟢 unchanged** | unchanged. |
| `hdr.sform_code` | `sform_code: number` | `sform_code: number` (`NVTypes.ts:50`) | **🟢 unchanged** | unchanged. |
| `hdr.cal_min` / `hdr.cal_max` | on NIFTI header | `cal_min: number` / `cal_max: number` (`NVTypes.ts:43–44`) — **snake_case preserved on the header** | **🟢 unchanged** | `this.volume.hdr.cal_min = …` unchanged. (Do **not** confuse with the volume-level `calMin`/`calMax`, which *were* renamed — see next rows.) |
| **`global_min` / `global_max`** (volume-level) | `global_min?: number` / `global_max?: number` on the class (`d.ts`); fidnii resets to `undefined` (`:850,1626,3020`), reads (`:3206,3216,3220`) | **RENAMED** → `globalMin: number` / `globalMax: number` (**required, not optional**) (`NVTypes.ts:112–113`) | **🟠 RENAMED + required** | Rename `global_min`→`globalMin`, `global_max`→`globalMax`. **Can no longer set to `undefined`** (type is `number`). The "reset so `refreshLayers()` re-runs `calMinMax`" trick (`:845–850`) no longer applies — see calMinMax row + Behavioral notes. |
| **`cal_min` / `cal_max`** (volume-level) | `cal_min?: number` / `cal_max?: number` on the class (`d.ts`); fidnii widens (`:3216–3221`) | **RENAMED** → `calMin: number` / `calMax: number` (`NVTypes.ts:108–109`) | **🟠 RENAMED** | Rename volume-level `cal_min`→`calMin`, `cal_max`→`calMax`. (Header `hdr.cal_min/cal_max` keep snake_case — two different fields now.) |
| **`name`** | `name: string` on class | `name: string` (`NVTypes.ts:99`) | **🟢 unchanged** | `this.volume.name = …` / `nvImage.name = …` unchanged. |
| **`calMinMax()`** (method) | `calMinMax(vol?, isBorder?): number[]` — **instance method** returning `[pct2,pct98,mnScale,mxScale]` (`d.ts`) | **REMOVED as method.** Now a free function `calMinMax(hdr, img): [robustMin, robustMax, globalMin, globalMax]` (`volume/utils.ts:230`), called internally by `nii2volume` (`NVVolume.ts:263`). **Different signature** (takes hdr+img, not `vol`/`isBorder`) | **🔴 method→free fn + sig change** | fidnii never *calls* it directly (relies on `updateGLVolume()→refreshLayers()→calMinMax`). See Behavioral notes — that implicit recompute path changed. If you need it explicitly, import via the NVVolume re-export, not the barrel (see ⚠ export gap). |
| **`calculateRAS()`** (method) | `calculateRAS(): void` — **instance method** (`d.ts`); called `:994,3162` | **REMOVED as method.** Now free function `calculateRAS(nvImage: NVImage): void` (`math/NVTransforms.ts:638`), called by `nii2volume` (`NVVolume.ts:297`). **Not in the public barrel.** | **🔴 method→free fn + NOT public** | Replace `this.calculateRAS()`. Options: (a) rebuild via `nii2volume`; (b) `nv.setVolumeAffine(index, affine)` (`NVControlBase.ts:2285`) which recomputes RAS; (c) upstream request to export `calculateRAS`. See ⚠ gap above. |
| **`setColormapLabel(cm)`** (method) | `setColormapLabel(cm: ColorMap): void` — **instance method on NVImage** (`d.ts`); fidnii calls on a slab `nvImage.setColormapLabel({R,G,B,A,I,labels})` (`:1178`) | **REMOVED from volume.** Now (a) instance method `nv.setColormapLabel(volumeIndex, cmap: ColorMap \| null)` (`NVControlBase.ts:2215`), which internally calls `makeLabelLut(cmap)` and sets `volume.colormapLabel`, marks `isDirty`, runs `updateGLVolume`; or (b) build the LUT yourself: `volume.colormapLabel = makeLabelLut(cmap)` (`makeLabelLut(cm: ColorMap, alphaFill?, maxIdx?): LUT` — `cmap/NVCmaps.ts:36`, **exported** from `index.ts:9`) | **🔴 method→instance method / free fn** | Replace `slab.setColormapLabel(cm)` with `nv.setColormapLabel(slabIndex, cm)` **or** `slab.colormapLabel = makeLabelLut(cm)` + `updateGLVolume`. |
| **`ColorMap` shape** `{R,G,B,A,I,labels}` | `ColorMap` type with `R,G,B,A,I` arrays + `labels?` | `export type ColorMap = { R, G, B, A, I: number[]; min?; max?; labels?: string[] }` (`NVTypes.ts:198–207`) | **🟢 unchanged** | fidnii's `{R,G,B,A,I,labels}` payload (`OMEZarrNVImage.ts:1148–1178`) is **fully compatible** with both `setColormapLabel` and `makeLabelLut`. |

---

## Construction / extension pattern in 1.0 (intended)

There is **no subclass or registered-loader base class.** The evidenced,
first-class pattern (used by Niivue's own extension API) is **build-a-plain-
object + addVolume**:

```text
1. const { hdr, img } = <build NIFTI1 header + typed-array data>   // fidnii does this today
2. const volume: NVImage = nii2volume(hdr, img, name)             // public: index.ts:121
3. nv.addVolume(volume)                                            // accepts NVImage object: NVControlBase.ts:1613
4. // display changes by volume index, not by mutating accessors:
   nv.setVolume(index, { colormap, opacity, calMin, calMax })     // NVControlBase.ts:2262
   nv.setColormapLabel(index, { R,G,B,A,I,labels })               // NVControlBase.ts:2215
   nv.updateGLVolume()                                            // re-derives display (refreshLayers)
```

Supporting evidence that this is the sanctioned path:

- **`addVolume` accepts a prebuilt object:** `async addVolume(volume:
  ImageFromUrlOptions | NVImage)` (`NVControlBase.ts:1613`).
- **Extension API builds volumes exactly this way:** `import { nii2volume }
  from '@/volume/NVVolume'` (`extension/context.ts:19`); `context.addVolume(vol:
  NVImage)` → `this.nv.addVolume(vol)` (`:282–283`);
  `buildDerivedScalarVolume(vol, data, name, nii2volume)` (`:199`);
  `MrsVolumeAccess.makeScalarOverlay(data, name): NVImage` returns a plain
  object to hand to `addVolume` (`extension/types.ts:127`).
- **Per-volume read access** for extensions is the read-only
  `BackgroundVolumeAccess` interface (getters for `img`, `hdr`, `dims`,
  `calMin/Max`, `globalMin/Max`, `imgRAS`) — `extension/types.ts:71–105`. This
  is what an extension is *supposed* to use instead of reaching into fields.
- **`VolumeUpdate`** (the typed mutation payload for `setVolume`) =
  `Omit<ImageFromUrlOptions, 'url'|'urlImageData'|'limitFrames4D'> & {
  frame4D? }` (`NVTypes.ts:954`); `ImageFromUrlOptions` (`NVTypes.ts:851`)
  carries `colormap` (`:859`), `opacity` (`:873`), `calMin` (`:875`),
  `calMax` (`:877`), `colormapNegative`, etc.

> **CHANGELOG / docs note.** `packages/niivue/CHANGELOG.md` on `main` is an
> autogenerated conventional-commit log with **no migration narrative** for the
> NVImage class→type change (the only volume-adjacent entry is "add Signal data
> class", `CHANGELOG.md:13`). **UNVERIFIED:** no prose migration guide for
> volume subclassing was found in the changelog. The authoritative guidance is
> the extension API surface (`src/extension/`) cited above. `FEATURE_PARITY.md`
> / `FEATURES.md` were not located under `packages/niivue/` on `main`
> (**UNVERIFIED** — may live elsewhere or be unpublished).

---

## Behavioral notes (silent-breakage hazards)

- **The `global_min = undefined` recompute trick is gone.** fidnii relies on
  resetting `global_min` to `undefined` so `updateGLVolume()→refreshLayers()`
  re-runs `calMinMax()` on real data (`OMEZarrNVImage.ts:845–850,1626,3020`).
  In 1.0 `globalMin` is a **required `number`** (`NVTypes.ts:112`) — you cannot
  store `undefined`. Min/max is computed **once** by `nii2volume` via the free
  `calMinMax(hdr, img)` (`NVVolume.ts:263`). After mutating `img`/`hdr` in place,
  you must **recompute and re-assign** `calMin/calMax/robustMin/robustMax/
  globalMin/globalMax` yourself (call `calMinMax(hdr, img)` and spread its
  4-tuple), or rebuild the volume with `nii2volume`. **This is a logic change,
  not just a rename** — the "reset to force recompute" contract no longer
  exists. 🔴

- **Index signature `[key: string]: unknown` masks every rename.** Because
  `NVImage` ends with `[key: string]: unknown` (`NVTypes.ts:187`), writing the
  *old* names (`this.volume._colormap = …`, `.global_min = …`, `.cal_min = …`)
  **compiles without error** but is ignored by the renderer (which reads
  `colormap` / `globalMin` / `calMin`). Every field rename in the matrix is a
  **silent no-op risk** — these will not surface as type errors. Audit by name,
  not by `tsc`. 🔴

- **`isDirty` is a real per-volume flag in 1.0.** `setColormapLabel` sets
  `volumes[index].isDirty = true` before `updateGLVolume`
  (`NVControlBase.ts:2227`). If fidnii mutates a volume's data out-of-band, it
  may need to set `volume.isDirty = true` to force a re-upload. **UNVERIFIED**
  whether `addVolume`/`setVolume` always set it; treat as a knob to check.

- **`getImageDataRAS(volume)` / `extractVoxelFid(...)` are public** (`index.ts:131`)
  and take the plain `NVImage` object — useful if fidnii later needs RAS voxel
  reads without the old `img2RAS()`/`getVolumeData()` methods (which are gone
  from the type).

---

## Quick-reference: public vs internal (for the migration map)

| Symbol fidnii will need | Exported from public barrel? | Where |
|---|---|---|
| `nii2volume` | ✅ value | `index.ts:121` |
| `writeVolume` | ✅ value | `index.ts:121` |
| `makeLabelLut` | ✅ value | `index.ts:9` |
| `getImageDataRAS`, `extractVoxelFid` | ✅ value | `index.ts:131` |
| `NVImage`, `NIFTI1`, `NIFTI2`, `ColorMap`, `TypedVoxelArray`, `VolumeUpdate` | ✅ **type only** | `index.ts:64–101` |
| `nv.addVolume / setVolume / setColormapLabel / updateGLVolume` | ✅ instance methods | `NVControlBase.ts` (1613 / 2262 / 2215 / 1381) |
| **`calculateRAS`** | 🔴 **NOT exported** | only `math/NVTransforms.ts:638` (internal) |
| **`calMinMax` (free fn)** | 🔴 not via top barrel | re-exported from `volume/NVVolume.ts:21` but `index.ts` pulls only `nii2volume,writeVolume` from it |
| a constructable `NVImage`/`NVVolume` class | 🔴 **DOES NOT EXIST** | — |
