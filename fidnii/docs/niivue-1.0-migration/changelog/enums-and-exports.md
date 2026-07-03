---
type: research
title: Niivue 1.0 — Enums & Package Exports
created: 2026-06-22
tags:
  - niivue
  - changelog
  - breaking-change
related:
  - '[[index]]'
  - '[[migration-map]]'
  - '[[rendering-backend]]'
  - '[[nvimage-api]]'
  - '[[api-surface]]'
---

# Niivue 1.0 — Enums & Package Exports

Scope: `@niivue/niivue` **`0.68.x → 1.0.0-rc.9`**, focused on the enum runtime
shapes (`SLICE_TYPE`, `DRAG_MODE`) and the package `exports`/ESM surface that
fidnii consumes. Cross-references [[api-surface]] §1 (imports/re-exports) and §8
(enum value deps).

Baseline = `@niivue/niivue@0.68.1` (fidnii's pinned version). Target =
`1.0.0-rc.9` (npm `next` tag; `latest` is `0.69.0`).

> **TL;DR**
>
> - **BREAKING:** `SLICE_TYPE` changed runtime shape from a TS `enum`
>   (reverse-mapped) to `Object.freeze({...})` (a frozen plain object,
>   **forward-only, no reverse map**). fidnii's `SLICE_TYPE[number]` lookups now
>   yield `undefined`. See [§1a](#1a-slice_type-reverse-lookup-regression-breaking).
> - **Non-breaking:** all enum **values** are unchanged (`AXIAL=0 … RENDER=4`,
>   `DRAG_MODE` identical). Forward access (`SLICE_TYPE.AXIAL`, `DRAG_MODE.pan`)
>   still works.
> - **Non-breaking:** fidnii imports `SLICE_TYPE`/`DRAG_MODE` from the package
>   **root** (`@niivue/niivue`), and the root barrel still exports them in 1.0.
>   Import **location** is unchanged.
> - **Non-breaking for fidnii:** removed subpaths (`./utils`, `./drawing`,
>   `./min`) and added subpaths (`./webgpu`, `./webgl2`); fidnii imports **only**
>   from root `.`, so the subpath churn does not affect it.
> - **Action required:** fidnii's `package.json` peerDependency range
>   `>=0.68.1` will **not** match `1.0.0-rc.9` under semver prerelease rules — the
>   range must be widened. See [§4](#4-peerdependency--version-range).

---

## 1. Enums

### 1a. `SLICE_TYPE` reverse-lookup regression (BREAKING)

**This is the headline breaking change for fidnii in this area.**

| | 0.68.1 | 1.0.0-rc.9 |
|---|---|---|
| Declaration | `declare enum SLICE_TYPE { … }` (TS `enum`) | `export const SLICE_TYPE = Object.freeze({ … } as const)` |
| Runtime shape | Reverse-mapped object | Frozen plain object |
| Forward (`SLICE_TYPE.AXIAL`) | `0` | `0` |
| **Reverse (`SLICE_TYPE[0]`)** | **`"AXIAL"`** | **`undefined`** ⚠ |
| Members | AXIAL=0, CORONAL=1, SAGITTAL=2, MULTIPLANAR=3, RENDER=4 | same **+ `NONE=5`** (new) |

**Evidence — 0.68.1 HAS runtime reverse-mapping.** The compiled runtime
`build/niivue/index.js` contains the canonical TS-enum reverse-map signature:

```js
SLICE_TYPE2[SLICE_TYPE2["AXIAL"] = 0] = "AXIAL"
// …and likewise: ["RENDER"] = 4] = "RENDER"
```

That `obj[obj["NAME"] = n] = "NAME"` form is exactly what `tsc` emits for a
(non-`const`) `enum`, and it installs **both** directions: `SLICE_TYPE.AXIAL===0`
**and** `SLICE_TYPE[0]==="AXIAL"`. So in 0.68.1, `SLICE_TYPE[sliceType]` returns
the member name string at runtime. (Evidence file:
`node_modules/.bun/@niivue+niivue@0.68.1/node_modules/@niivue/niivue/build/niivue/index.js`.)

**Evidence — 1.0 is forward-only.** `1.0` `src/NVConstants.ts:83`:

```ts
export const SLICE_TYPE = Object.freeze({
  AXIAL: 0, CORONAL: 1, SAGITTAL: 2, MULTIPLANAR: 3, RENDER: 4, NONE: 5,
} as const)
```

This object has **no numeric keys**, so `SLICE_TYPE[0]` … `SLICE_TYPE[5]` are all
`undefined`. (Note: in the same file `1.0` `MULTIPLANAR_TYPE` *does* include
numeric reverse keys `0:'AUTO',1:'COLUMN',…` — so the omission of reverse keys on
`SLICE_TYPE` is deliberate, not an oversight. `SLICE_TYPE` is forward-only by
design in 1.0.)

**fidnii impact — `SLICE_TYPE[number]` call sites** (from [[api-surface]] §8;
`file:line` relative to `fidnii/`):

| File:line | Expression | What it builds | Severity if `undefined` |
|---|---|---|---|
| `src/OMEZarrNVImage.ts:2958` | `` `slab-${SLICE_TYPE[sliceType]}-${levelIndex}` `` | **Buffer/cache KEY** | **HIGH** — key becomes `slab-undefined-N`; all slab buffers collide on one key per level, breaking per-orientation slab buffering. |
| `src/OMEZarrNVImage.ts:2671` | `` nvImage.name = `${this.name ?? "OME-Zarr"} [${SLICE_TYPE[sliceType]}]` `` | NVImage **`name`** | **MEDIUM** — name becomes `… [undefined]`; user-visible/diagnostic, and `name` may be used elsewhere as an identifier. |
| `src/OMEZarrNVImage.ts:2633` | `` `[fidnii] Error loading slab for ${SLICE_TYPE[sliceType]}:` `` | Log message | LOW — cosmetic (`… for undefined:`). |
| `test-page/main.ts:336` | `SLICE_TYPE[detail.sliceType] ?? String(detail.sliceType)` | Display label | LOW — already has a `?? String(...)` fallback, so it degrades to the numeric string. |

> **Severity: HIGH (one site) — `src/OMEZarrNVImage.ts:2958`.** The buffer key
> `slab-${SLICE_TYPE[sliceType]}-${levelIndex}` silently degrades to
> `slab-undefined-${levelIndex}`. This produces **no type error** (indexing a
> frozen object by `number` is still `string | undefined` in TS, and template
> interpolation accepts `undefined`), and **no runtime exception** — it just
> mis-keys the buffer. Axial/coronal/sagittal slabs at the same level would all
> map to the same `slab-undefined-N` key. This is the worst kind of regression:
> compiles clean, runs without throwing, corrupts behavior.

**Recommended fixes** (any of):

1. Build a local forward→name map once and use it instead of indexing the enum,
   e.g. `const SLICE_TYPE_NAME = { 0:"AXIAL", 1:"CORONAL", 2:"SAGITTAL",
   3:"MULTIPLANAR", 4:"RENDER", 5:"NONE" } as const` and key/label via
   `SLICE_TYPE_NAME[sliceType]`. This is backend-version-agnostic.
2. Or use a numeric key directly for the buffer (`slab-${sliceType}-${levelIndex}`)
   since `sliceType` is already a unique number — only the human-readable name
   needs the lookup table (sites :2633/:2671).
3. Do **not** rely on `SLICE_TYPE[n]` continuing to work; it is gone in 1.0.

### 1b. `SLICE_TYPE` / `DRAG_MODE` values (UNCHANGED — non-breaking)

All values fidnii compares against are stable across versions:

| Member | Value (0.68.1) | Value (1.0.0-rc.9) | fidnii usage |
|---|---|---|---|
| `SLICE_TYPE.AXIAL` | 0 | 0 | switch/compare ([[api-surface]] §8) |
| `SLICE_TYPE.CORONAL` | 1 | 1 | switch/compare |
| `SLICE_TYPE.SAGITTAL` | 2 | 2 | switch/compare |
| `SLICE_TYPE.MULTIPLANAR` | 3 | 3 | compare (**MULTIPLANAR=3 in both**) |
| `SLICE_TYPE.RENDER` | 4 | 4 | compare; `nv.sliceTypeRender` |
| `SLICE_TYPE.NONE` | *(absent)* | 5 | **new in 1.0**; not used by fidnii |

| `DRAG_MODE` member | Value (0.68.1) | Value (1.0.0-rc.9) | fidnii usage |
|---|---|---|---|
| `none` | 0 | 0 | — |
| `contrast` | 1 | 1 | `test-page/main.ts:419` |
| `measurement` | 2 | 2 | — |
| `pan` | 3 | 3 | `test-page/main.ts:418` |
| `slicer3D` | 4 | 4 | — |
| `callbackOnly` | 5 | 5 | — |
| `roiSelection` | 6 | 6 | — |
| `angle` | 7 | 7 | — |
| `crosshair` | 8 | 8 | — |
| `windowing` | 9 | 9 | — |

`DRAG_MODE` is a **TS `enum` in both versions** (`1.0` `src/NVConstants.ts:10`;
0.68.1 baseline `declare enum DRAG_MODE`), so its runtime shape is unchanged and
it **retains reverse-mapping** (`DRAG_MODE[3]==="pan"`). fidnii only uses forward
access (`DRAG_MODE.pan`, `DRAG_MODE.contrast`), so it is unaffected either way.

> **Forward comparisons all still hold:** `SLICE_TYPE.AXIAL`/`.RENDER`/etc. and
> `DRAG_MODE.pan`/`.contrast` evaluate to the same numbers in 1.0. Only the
> **reverse** direction on `SLICE_TYPE` regresses (§1a).

### 1c. New enums in 1.0 (informational)

`1.0` `src/NVConstants.ts` adds, beyond the above:

- `enum SHOW_RENDER { NEVER=0, ALWAYS=1, AUTO=2 }` (TS enum) — also existed as a
  `declare enum` in 0.68.1's types, now exported from the root barrel.
- `MULTIPLANAR_TYPE` `{AUTO/COLUMN/GRID/ROW}` as a `const` object **with**
  numeric reverse keys (also barrel-exported).
- `enum COLORMAP_TYPE { MIN_TO_MAX=0, ZERO_TO_MAX_TRANSPARENT_BELOW_MIN=1,
  ZERO_TO_MAX_TRANSLUCENT_BELOW_MIN=2 }`.
- `const NiiIntentCode` (frozen) and `const NiiDataType` (frozen) — `NiiDataType`
  mirrors NIfTI datatype codes (`DT_RGB24=128`, `DT_RGBA32=2304`, …). fidnii
  currently keeps its **own** `NiftiDataType` const in `src/types.ts:323`; it does
  **not** import niivue's, so this addition is informational only (a possible
  future de-duplication opportunity, not a migration requirement).

None of these new symbols are consumed by fidnii today.

---

## 2. Import locations (root barrel — UNCHANGED, non-breaking)

fidnii imports the enums **only from the package root** `"@niivue/niivue"`. In
1.0 the root barrel (`src/index.ts`) still re-exports them, now sourced from
`./NVConstants`:

`1.0` `src/index.ts:26-32`:

```ts
export {
  DRAG_MODE,
  MULTIPLANAR_TYPE,
  // (COLORMAP_TYPE etc.)
  SHOW_RENDER,
  SLICE_TYPE,
} from './NVConstants'
```

**All fidnii niivue imports resolve from root** (verified via grep over `src/`,
`test-page/`, `tests/`):

| File:line | Import |
|---|---|
| `src/types.ts:5` | `import type { Niivue, NVImage } from "@niivue/niivue"` |
| `src/types.ts:6` | `import { SLICE_TYPE } from "@niivue/niivue"` |
| `src/ViewportBounds.ts:4` | `import type { Niivue } from "@niivue/niivue"` |
| `src/ViewportBounds.ts:5` | `import { SLICE_TYPE } from "@niivue/niivue"` |
| `src/events.ts:4` | `import type { SLICE_TYPE } from "@niivue/niivue"` |
| `src/OMEZarrNVImage.ts:10` | `import type { Niivue } from "@niivue/niivue"` |
| `src/OMEZarrNVImage.ts:11` | `import { NVImage, SLICE_TYPE } from "@niivue/niivue"` |
| `test-page/main.ts:34` | `import { DRAG_MODE, Niivue, SLICE_TYPE } from "@niivue/niivue"` |

→ **Import location is stable.** `import { SLICE_TYPE } from "@niivue/niivue"`
continues to resolve in 1.0. No import path edits are required for the enums.

> **BREAKING for fidnii's own public API shape (re-export).** fidnii
> **re-exports** `SLICE_TYPE` as part of *its own* public surface:
>
> - `src/types.ts:238` — `export { SLICE_TYPE }`
> - `src/index.ts:134` — barrel re-export (comment: "Re-export SLICE_TYPE from
>   types (which re-exports from niivue)")
> - `src/types.ts:245-247` — `SliceType` union derived from
>   `typeof SLICE_TYPE.AXIAL | .CORONAL | .SAGITTAL`
> - `src/types.ts:298` — interface field typed `currentSliceType: SLICE_TYPE`
>   (uses `SLICE_TYPE` as a **type**)
>
> Because the *runtime shape* of the re-exported value changes (TS `enum` →
> frozen object), **fidnii's own consumers** who do `SLICE_TYPE[n]` on fidnii's
> re-export would break identically. Also note `SLICE_TYPE` is used as a **type**
> at `src/types.ts:298` (`currentSliceType: SLICE_TYPE`): a TS `enum` is both a
> value and a type, but `Object.freeze({...} as const)` is a **value only** —
> `SLICE_TYPE` is no longer usable in *type position* in 1.0. The correct 1.0
> type is `typeof SLICE_TYPE[keyof typeof SLICE_TYPE]` (the value union) or
> fidnii's existing `SliceType` union. **This `currentSliceType: SLICE_TYPE`
> annotation will fail to type-check against 1.0** and must be changed. (See also
> the `SliceType`/`SlabSliceType` `typeof` unions, which already use
> `typeof SLICE_TYPE.X` and therefore keep working.)

---

## 3. Package `exports` map / ESM (subpaths — non-breaking for fidnii)

`type: module` in **both** versions (pure ESM). Entry point and subpaths changed:

| Subpath | 0.68.1 | 1.0.0-rc.9 | Note |
|---|---|---|---|
| `.` (root) | `./build/niivue/index.js` (+ `index.d.ts`) | `./dist/niivuegpu.js` (+ `index.d.ts`) | Entry **file moved** `build/ → dist/`, renamed to `niivuegpu.js`. Resolved via `exports`, so consumers using the package specifier are unaffected. |
| `./min` | `./build/index.min.js` | **removed** | — |
| `./utils` | `./build/utils/index.js` | **removed** | — |
| `./drawing` | `./build/drawing/index.js` | **removed** | — |
| `./webgpu` | — | `./dist/niivuegpu.webgpu.js` | **new** (explicit WebGPU build) |
| `./webgl2` | — | `./dist/niivuegpu.webgl2.js` | **new** (explicit WebGL2 build) |
| `./assets/fonts` | — | `./dist/assets/fonts/index.js` | **new** |
| `./assets/matcaps` | — | `./dist/assets/matcaps/index.js` | **new** |

(Source: `npm registry .../1.0.0-rc.9` and `.../0.68.1` — `exports`, `type`,
`main`, `module`, `types`.)

**fidnii impact:** fidnii imports **only** from the root `.` (grep for
`@niivue/niivue/{utils,drawing,min,webgpu,webgl2}` over `src/`, `test-page/`,
`tests/` → **no matches**). Therefore:

- The **removed** subpaths (`./utils`, `./drawing`, `./min`) do **not** affect
  fidnii.
- fidnii does **not** need the new `./webgpu` / `./webgl2` subpaths for the enum
  imports (the default root `.` resolves to the GPU build `niivuegpu.js`).

> The root entry now points at a **WebGPU-first** bundle (`niivuegpu.js`). That
> is a *rendering-backend* concern (canvas/context ownership, async
> `attachToCanvas`, headless Playwright), **out of scope here** — tracked in
> [[rendering-backend]]. For **enums/exports**, the only relevant fact is that
> the root specifier still exports `SLICE_TYPE`/`DRAG_MODE`.

---

## 4. peerDependency / version range

**niivue declares NO `peerDependencies`** in either version (`peerDependencies:
null` in both npm registry records). So there is nothing fidnii must satisfy
*from niivue's side*.

**fidnii's own `package.json` (current, baseline):**

```json
"dependencies":     { "@niivue/niivue": "^0.68.1" },   // package.json:30
"peerDependencies": { "@niivue/niivue": ">=0.68.1" }   // package.json:47
```

> **BREAKING / action required.** `1.0.0-rc.9` is a **prerelease** (it carries a
> `-rc.9` suffix and lives under the npm **`next`** dist-tag; `latest` is
> `0.69.0`). Under semver rules, a range **without** a prerelease component does
> **not** match a prerelease version unless the prerelease is for the *same*
> `[major.minor.patch]` tuple. Concretely:
>
> - `^0.68.1` → does **not** match `1.0.0-rc.9` (different major, and no
>   prerelease tag in the range).
> - `>=0.68.1` → does **not** match `1.0.0-rc.9` either. A bare `>=0.68.1` only
>   admits prereleases whose `[major.minor.patch]` equals `0.68.1`
>   (e.g. `0.68.1-x`); it will **not** admit `1.0.0-rc.9`.
>
> To allow installing/using `1.0.0-rc.9`, fidnii must widen **both** the
> `dependencies` and `peerDependencies` ranges to explicitly include the
> prerelease. Options, least-to-most permissive:
>
> - Pin exactly: `"@niivue/niivue": "1.0.0-rc.9"`.
> - Floor at the rc:   `">=1.0.0-rc.9"` (admits `1.0.0-rc.9` and any later
>   `1.0.0` prerelease/stable; note `>=1.0.0-rc.9` does **not** admit
>   `1.0.0-rc.8`).
> - Range incl. stable: `">=1.0.0-rc.9 <2"` or `"^1.0.0-rc.9"`
>   (`^1.0.0-rc.9` admits `1.0.0` prereleases ≥ rc.9 and `1.x` stable).
> - Tag-based (dev only, **not** publishable to a registry as a dependency
>   range): `"next"`.
>
> **Recommended** for the migration branch: set both ranges to admit the rc and
> the eventual stable, e.g.
> `dependencies: "@niivue/niivue": ">=1.0.0-rc.9 <2"` (or
> `"^1.0.0-rc.9"`), and the same for `peerDependencies`. If fidnii must keep
> working against `0.68.1` simultaneously, a disjunction such as
> `"^0.68.1 || >=1.0.0-rc.9 <2"` is required — but note the `SLICE_TYPE[n]`
> reverse-lookup regression (§1a) means the **code** cannot transparently support
> both runtime shapes without the local-map fix, so a dual-support range is only
> safe **after** §1a is addressed.

---

## 5. Summary — breaking vs non-breaking (feeds [[migration-map]])

| Item | Status | fidnii action |
|---|---|---|
| `SLICE_TYPE[number]` reverse-lookup | **BREAKING** (enum→frozen object, no reverse map) | Replace `SLICE_TYPE[n]` at `OMEZarrNVImage.ts:2958` (**HIGH** — buffer key), `:2671` (MED — name), `:2633` (LOW — log) with a local name map; `test-page/main.ts:336` already has a fallback. |
| `SLICE_TYPE` used in **type position** (`currentSliceType: SLICE_TYPE`, `types.ts:298`) | **BREAKING** (value-only in 1.0) | Retype to the value union / existing `SliceType`. |
| `SLICE_TYPE` re-exported by fidnii (`types.ts:238`, `index.ts:134`) | **BREAKING shape** (fidnii's public re-export changes enum→object) | Document in fidnii changelog; downstream `SLICE_TYPE[n]` breaks too. |
| Enum **values** (`SLICE_TYPE.*`, `DRAG_MODE.*`) | unchanged | none (MULTIPLANAR=3 both; `NONE=5` new but unused). |
| `DRAG_MODE` runtime shape | unchanged (TS `enum` both) | none. |
| Import **location** (root `@niivue/niivue`) | unchanged | none. |
| Subpaths `./utils` `./drawing` `./min` | **removed** in 1.0 | none (fidnii doesn't import them). |
| Subpaths `./webgpu` `./webgl2` `./assets/*` | **added** in 1.0 | none for enums; backend → [[rendering-backend]]. |
| Root entry file `build/niivue/index.js` → `dist/niivuegpu.js` | moved/renamed (via `exports`) | none (resolved by specifier). |
| `type: module` | unchanged (ESM both) | none. |
| niivue `peerDependencies` | `null` both | none (nothing to satisfy). |
| fidnii dep/peer range `^0.68.1` / `>=0.68.1` | **does NOT match** prerelease `1.0.0-rc.9` | **Widen both** ranges, e.g. `>=1.0.0-rc.9 <2` (or `^1.0.0-rc.9`). |

**Evidence index.** 1.0 enums: `niivue/mono@main` `packages/niivue/src/NVConstants.ts`
(`SLICE_TYPE` :83, `DRAG_MODE` :10). 1.0 barrel: same repo `src/index.ts:26-32`.
0.68.1 enums: baseline `…/@niivue+niivue@0.68.1/…/build/nvdocument-CP74afCb.d.ts`
(`declare enum SLICE_TYPE` ~:1539, `declare enum DRAG_MODE` ~:1570) and reverse-map
proof in `…/build/niivue/index.js`. npm `exports`/`type`/`peerDependencies`:
registry records for `1.0.0-rc.9` and `0.68.1`; dist-tags (`latest=0.69.0`,
`next=1.0.0-rc.9`) from the package registry root. fidnii usage: `src/types.ts`,
`src/index.ts`, `src/OMEZarrNVImage.ts`, `src/ViewportBounds.ts`, `src/events.ts`,
`test-page/main.ts`, `package.json`; grep over `src/`/`test-page/`/`tests/`.
