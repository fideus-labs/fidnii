---
type: report
title: Niivue 1.0 (rc.9) — Build-Breakage Inventory
created: 2026-06-22
tags:
  - niivue
  - migration
  - errors
related:
  - '[[index]]'
  - '[[migration-map]]'
  - '[[enums-and-exports]]'
  - '[[nvimage-api]]'
  - '[[niivue-class-api]]'
  - '[[events]]'
  - '[[rendering-backend]]'
---

# Niivue 1.0 (rc.9) — Build-Breakage Inventory

Concrete compiler breakage from pinning `@niivue/niivue` to **`1.0.0-rc.9`** (Phase
02). Every `tsc` error is grouped **by source file** and **by offending API**, and
each API group links to its resolution row in [[migration-map]] and the supporting
changelog doc. This is the exact work-list the code-adaptation phases execute.

> Phase 02 applied **only** the trivial, mechanical fixes (the `SLICE_TYPE`
> type-position regression). All substantive errors are intentionally **left
> unfixed** and catalogued below — see [Remaining (Phase 3)](#remaining-phase-3).

## Toolchain snapshot

| Check | Command | Scope | Result |
|---|---|---|---|
| Type-check | `bunx tsc --noEmit` (from `fidnii/`) | `src/**/*` only (`tsconfig.json` excludes `test-page`, `tests`) | ❌ exit 2 — **47 errors** after Phase-02 fixes (54 before) |
| Lint/format | `bun run check` (Biome, repo root) | all packages | ✅ exit 0 — only 3 pre-existing CSS specificity warnings (unrelated to the upgrade) |
| Install | `bun install` (repo root) | monorepo | ✅ exit 0 — `1.0.0-rc.9` resolved, lockfile saved |

Raw logs: `Working/rc9-tsc.txt` (refreshed post-fix), `Working/rc9-biome.txt`,
`Working/rc9-install.txt`. Baseline (0.68.1, green) logs: `Working/baseline-*.txt`.

## Headline

- **54** errors on first `tsc` after the bump; **all in 4 files**, **0** from Biome.
- **8** resolved by the Phase-02 mechanical fix (`SLICE_TYPE` used in type position,
  7× `TS2749` + 1× unused-import `TS6133`) — see [§2](#2-mechanical-fixes-applied-phase-02).
- **1** error *surfaced* by that fix (`TS2322` at `OMEZarrNVImage.ts:2404`) — a
  downstream symptom of the still-broken `Niivue` import, not new debt; folded into
  group **G1**.
- **47** remaining, **100% substantive** (NVImage subclassing, controller rename,
  scene/opts access, reverse-lookup) — Phase 3 (+ Phase 4 for the test page).
- `test-page/main.ts` is **out of `tsc` scope** here — see [§4](#4-test-pagemaints-out-of-scope-here).

## 1. Breakage by source file

| File | Errors (post-fix) | Dominant APIs | Migration evidence |
|---|---:|---|---|
| `src/OMEZarrNVImage.ts` | 45 | `extends NVImage` blocker; `Niivue` import; `hdr`/`img`/`name`/`global_min`/`_opacity`/`_colormap`; `SLICE_TYPE[n]`; removed methods | [[migration-map]] §1,§2,§6; [[nvimage-api]] |
| `src/ViewportBounds.ts` | 1 | `import type { Niivue }` | [[migration-map]] §1,§2; [[niivue-class-api]] |
| `src/types.ts` | 1 | `import type { Niivue }` | [[migration-map]] §1,§2; [[niivue-class-api]] |
| `src/events.ts` | 0 | *(fixed in Phase 02 — `SLICE_TYPE`-as-type)* | [[enums-and-exports]] §2 |
| `test-page/main.ts` | n/a | not type-checked by the library `tsc` run | see [§4](#4-test-pagemaints-out-of-scope-here) |

## 2. Mechanical fixes applied (Phase 02)

The single class of trivial, no-logic fixes: **`SLICE_TYPE` used in type position.**
In 1.0 `SLICE_TYPE` is `Object.freeze({…} as const)` — a value, no longer usable as
a type ([[enums-and-exports]] §1a/§2). Added one faithful value-union alias and
applied it everywhere `SLICE_TYPE` annotated a type:

```ts
// src/types.ts
export type SliceType = (typeof SLICE_TYPE)[keyof typeof SLICE_TYPE]
```

| Site (pre-fix line) | Before | After | Was |
|---|---|---|---|
| `types.ts:298` | `currentSliceType: SLICE_TYPE` | `: SliceType` | `TS2749` |
| `events.ts:4` | `import type { SLICE_TYPE } from "@niivue/niivue"` | removed (now unused) | `TS6133` |
| `events.ts:100,111` | `sliceType: SLICE_TYPE` | `: SliceType` (imported from `./types.js`) | `TS2749` |
| `ViewportBounds.ts:187` | `sliceType: SLICE_TYPE` | `: SliceType` | `TS2749` |
| `OMEZarrNVImage.ts:2397` | `_detectSliceType(nv): SLICE_TYPE` | `: SliceType` | `TS2749` |
| `OMEZarrNVImage.ts:2412` | `_isSlabSliceType(st: SLICE_TYPE)` | `(st: SliceType)` | `TS2749` |
| `OMEZarrNVImage.ts:2463` | `_handleSliceTypeChange(…, newSliceType: SLICE_TYPE)` | `: SliceType` | `TS2749` |

Import hygiene per AGENTS.md: `import type` kept separate from value imports; the
value `import { SLICE_TYPE }` (still used for forward access like `SLICE_TYPE.AXIAL`)
was retained in `OMEZarrNVImage.ts`/`ViewportBounds.ts`; `SliceType` is imported from
`./types.js`. **The enum import *location* did not move** (root `@niivue/niivue` in
both versions, [[enums-and-exports]] §2), so no import paths changed.

> **NOT touched** (deferred): the `SLICE_TYPE[number]` **reverse-lookup** call sites
> (`TS7053`, group **G7**) — those are *runtime-logic* fixes (buffer keys / display
> names), out of Phase-02 scope.

## 3. Remaining (Phase 3) — substantive errors by offending API

The 47 errors below, grouped by API and ranked by blast radius, each mapped to its
[[migration-map]] row and risk hotspot. Line numbers are **post-Phase-02** (they
shift +1 below the new `SliceType` import) and match the refreshed `Working/rc9-tsc.txt`.

### G1 — 🔴 `Niivue` → `NiiVueGPU` controller rename · `TS2614` ×3 (+ dependent `TS2322` ×1)

`@niivue/niivue` 1.0 has **no `Niivue` export**; the controller class is the default
export, also named `NiiVueGPU` (`export { default, default as NiiVueGPU }`).

| File:line | Error | Detail |
|---|---|---|
| `OMEZarrNVImage.ts:10` | `TS2614` | `import type { Niivue }` |
| `ViewportBounds.ts:4` | `TS2614` | `import type { Niivue }` |
| `types.ts:5` | `TS2614` | `import type { Niivue, NVImage }` |
| `OMEZarrNVImage.ts:2404` | `TS2322` | `number` not assignable to `SliceType` — `nv.opts.sliceType` is `any` because `nv: Niivue` is an error type; resolves once `nv` is `NiiVueGPU` and the read moves to `nv.sliceType` (opts reshaped) |

**Resolve:** retype `import type { Niivue }` → `NiiVueGPU` (and split the
value/type imports). → [[migration-map]] §1 (import row), §2, §4 (`opts.sliceType` →
`nv.sliceType` for `:2404`); [[niivue-class-api]]. **Hotspot H3.**

### G2 — 🔴 `NVImage` is a type, not a class (subclassing dismantled) · `TS2693` ×2, `TS4112` ×2, `TS2345` ×3, `TS2352` ×2

`NVImage` is now `export type NVImage = {…}` (methodless object type, index
signature) — `class … extends NVImage` is not viable. Rebuild as **composition**
over a `nii2volume()`-built volume; add it with `await nv.addVolume(volume)`.

| File:line | Error | Detail |
|---|---|---|
| `OMEZarrNVImage.ts:100` | `TS2693` | `NVImage` used as a value (class extension) |
| `OMEZarrNVImage.ts:2650` | `TS2693` | `NVImage` used as a value (slab `new NVImage`) |
| `OMEZarrNVImage.ts:127,131` | `TS4112` | `override` on `get/set colormap` — class no longer extends anything |
| `OMEZarrNVImage.ts:839,865,2278` | `TS2345` | `this` passed where an `NVImage` is expected (e.g. `addVolume(this)`) |
| `OMEZarrNVImage.ts:2478,2709` | `TS2352` | `this as NVImage` cast no longer overlaps |

**Resolve:** compose, don't subclass; pass the owned `volume`, not `this`; replace
the `colormap` accessor override with a data field + `nv.setVolume(index,{colormap})`.
→ [[migration-map]] §6; [[nvimage-api]]. **Hotspot H1.**

### G3 — 🔴/🟠 Inherited `NVImage` members gone from the (ex-)subclass · `TS2339` ×17

Direct consequence of G2 — these become accesses on the owned `volume: NVImage`.
Several also carry **silent renames** (audit by name, not `tsc`).

| Member | Sites | Action | Note |
|---|---|---|---|
| `hdr` | `533, 911, 920, 924, 992, 1114, 1129, 1130` | `volume.hdr` | header keeps snake_case, now non-null |
| `img` | `581, 828, 1621` | `volume.img` | `TypedVoxelArray \| null` |
| `name` | `577, 2672` | `volume.name` | unchanged field |
| `global_min` | `851, 1627` | `volume.globalMin` | 🟠 **renamed**, now required `number` (recompute trick gone) |
| `_opacity` | `587` | `volume.opacity` | 🟠 **renamed** (silent no-op risk) |
| `calculateRAS` | `995` | free fn `calculateRAS()` | method removed (see G5) |

→ [[migration-map]] §6; [[nvimage-api]]. **Hotspots H1 + H5.**

### G4 — 🟠 Private-field rename `_colormap` → `colormap` · `TS2551` ×3

| File:line | Error | Detail |
|---|---|---|
| `OMEZarrNVImage.ts:128, 585, 2675` | `TS2551` | `_colormap` → data field `colormap` (side effects via `nv.setVolume`/`updateGLVolume`) |

→ [[migration-map]] §6; [[nvimage-api]]. **Hotspot H5** (silent-no-op class).

### G5 — 🔴 Removed `NVImage` methods now typed `unknown` · `TS18046` ×2

| File:line | Member | Replacement |
|---|---|---|
| `OMEZarrNVImage.ts:1179` | `setColormapLabel` | `nv.setColormapLabel(index, cmap)` or `volume.colormapLabel = makeLabelLut(cmap)` |
| `OMEZarrNVImage.ts:3163` | `calculateRAS` | free fn in `math/NVTransforms.ts` (not publicly exported) — or `nv.setVolumeAffine(index, affine)` / rebuild via `nii2volume` |

→ [[migration-map]] §6; [[nvimage-api]]. **Hotspot H1.** (`calculateRAS` public path is an open **runtime-verification** item.)

### G6 — 🟠 Volume min/max now non-null + camelCase · `TS18047` ×4

| File:line | Members | Action |
|---|---|---|
| `OMEZarrNVImage.ts:3217` | `global_max`, `cal_max` | `globalMax` / `calMax` — now required `number`, drop the null guards |
| `OMEZarrNVImage.ts:3221` | `global_min`, `cal_min` | `globalMin` / `calMin` |

→ [[migration-map]] §6; [[nvimage-api]]. **Hotspots H5/H6.**

### G7 — 🟠 `SLICE_TYPE[number]` reverse-lookup removed · `TS7053` ×3

The frozen `SLICE_TYPE` has **no numeric keys**, so `SlabSliceType` (0|1|2) can't
index it. **Forward access is fine** — only reverse lookups break.

| File:line | Builds | Severity |
|---|---|---|
| `OMEZarrNVImage.ts:2959` | **slab buffer cache KEY** `` `slab-${SLICE_TYPE[st]}-${lvl}` `` | **HIGH** — degrades to `slab-undefined-N`; all orientations collide on one key. Compiles clean, never throws, corrupts buffering. |
| `OMEZarrNVImage.ts:2672` | NVImage `name` suffix | MED — `… [undefined]` |
| `OMEZarrNVImage.ts:2634` | log message | LOW — cosmetic |

**Resolve:** local `number → name` map, or use the numeric `st` directly for the key.
→ [[migration-map]] §1 (reverse-lookup row); [[enums-and-exports]] §1a. **Hotspot H5.**

### G8 — 🟠 Implicit-any callback/handler params · `TS7006` ×5

Inference lost because the surrounding controller/NVImage types are broken; expect
most to clear once G1/G2 land, otherwise add explicit annotations.

| File:line | Param | Context |
|---|---|---|
| `OMEZarrNVImage.ts:497` | `e` | event handler |
| `OMEZarrNVImage.ts:512` | `v` | setter callback |
| `OMEZarrNVImage.ts:2314, 2323` | `e` | event handlers |
| `OMEZarrNVImage.ts:2715` | `v` | setter callback |

→ [[migration-map]] §5 (events), §2 (async setters); [[events]], [[niivue-class-api]].
**Hotspots H4/H6.** (Also re-verify the listener renames `mouseUp`→`pointerUp` and the
`zoom3DChange` removal here — those are name-level, not yet `tsc`-visible.)

### Phase-3 work-list by file (summary)

- **`src/OMEZarrNVImage.ts` (45):** the whole composition rewrite (G2–G7), the
  `Niivue` import (G1), event-param typing (G8). The keystone file.
- **`src/ViewportBounds.ts` (1):** `Niivue` → `NiiVueGPU` import (G1); also inline the
  removed `swizzleVec3MM` math ([[migration-map]] §2, not yet `tsc`-visible).
- **`src/types.ts` (1):** `Niivue` → `NiiVueGPU` import (G1).

## 4. `test-page/main.ts` — out of scope here

`fidnii/tsconfig.json` sets `include: ["src/**/*"]` and `exclude: [… "test-page",
"tests"]`, so `bunx tsc --noEmit` from `fidnii/` **does not** type-check the test page
or tests. Its known 1.0 issues — `Niivue`/`DRAG_MODE` import (`main.ts:34`), the
`SLICE_TYPE[detail.sliceType]` display label (`:336`, already has a `?? String(...)`
fallback), `DRAG_MODE.pan/.contrast` (`:418-419`, unchanged) — are tracked in
[[migration-map]] §1/§5 and belong to **Phase 04** (test page + rendering
verification), surfaced via Vite build / Playwright rather than the library `tsc`.

## Convergence check

`54 − 8 (mechanical) + 1 (surfaced) = 47`. After Phase 3 resolves G1–G8 the library
`tsc` should reach 0; then re-run all four [[index]] baseline commands and diff
against `Working/baseline-*.txt` to localize any runtime regression.
