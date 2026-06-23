---
type: research
title: Niivue 1.0 — Rendering Backend (WebGPU vs WebGL2)
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

# Niivue 1.0 — Rendering Backend (WebGPU vs WebGL2)

Frames the rendering-backend change for the upgrade `@niivue/niivue@0.68.1` →
`@niivue/niivue@1.0.0-rc.9`. This is **fidnii's #1 migration risk**: in 0.68 the
library was WebGL2-only; in 1.0 the package is **"NiiVueGPU"** and the default
entry point boots **WebGPU first**, only falling back to WebGL2 when
`navigator.gpu` is *absent*. fidnii's Playwright suite runs headless Chromium and
relies on rendering actually working.

**Evidence policy.** Every claim cites a mono-repo source path (branch `main`,
the 1.0 SOURCE) and/or an npm field from the published **rc.9 artifact**, and/or
a CHANGELOG/README line. Where source and published artifact must be
distinguished, that is called out. Items that could not be verified are tagged
**UNVERIFIED**.

> Source-vs-artifact note: line numbers below are from files fetched off mono
> `main` on 2026-06-22 (the 1.0 SOURCE). The published **rc.9** artifact
> (`1.0.0-rc.9`, published 2026-06-12) was independently confirmed to match on
> the package-level facts (exports, entry files, `type: module`) via
> `registry.npmjs.org`. `main` may have drifted *forward* of rc.9 in body
> details, but the backend-split architecture (the `NVControl*` dispatch classes
> and the `./webgpu` / `./webgl2` subpath exports) is present and consistent in
> both.

---

## TL;DR for fidnii

- **The default `@niivue/niivue` import is no longer WebGL2.** It is a dual-backend
  build that **prefers WebGPU at construction** (`backend: options.backend ??
  'webgpu'`) and falls back to WebGL2 **only if `navigator.gpu` is undefined**.
  → `NVControlBase.ts:281`, `NVControlBase.ts:1301-1329`.
- **fidnii must force WebGL2.** The robust, single-decision fix is to import the
  WebGL2-only build: `import NiiVueWebGL2 from '@niivue/niivue/webgl2'`. This
  build hard-pins `backend: 'webgl2'` and *cannot* silently switch to WebGPU.
  → `NVControlWebGL2.ts:6-12`, `index.webgl2.ts`, npm `exports["./webgl2"]`.
  - Alternative (keep the default `.` import): construct with
    `new Niivue({ backend: 'webgl2' })`. Equivalent at runtime, but keeps the
    WebGPU code in the bundle and leaves the door open to a future caller
    omitting the option. The subpath import is preferred for fidnii.
- **`attachToCanvas` is still the path and is still `async`** — *good news*, fidnii
  already `await`s it (`test-page/main.ts:445,455`). It now returns `Promise<this>`
  and internally `await ctrl.view.init()` is the **single async init gate**. There
  is **no new separate `ready()` call** to add. → `NVControlBase.ts:1372-1378`,
  `control/viewBoth.ts:57-58`.
- **Headless WebGPU is not free.** niivue's *own* benchmark harness must pass
  `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader` to
  make WebGPU init succeed headless on Linux CI, with a source comment that
  "without this flag WebGPU init fails." fidnii's current launch args are just
  `--use-gl=egl`. → `packages/niivue/bench/run-bench.ts:41-47` (per repo search).
  **WebGL2 remains the safe choice** for fidnii's existing EGL/Chromium tests.

---

## 1. What changed at the package boundary (npm)

| Aspect | 0.68.1 | 1.0.0-rc.9 | Tag |
|---|---|---|---|
| Package display identity | `Niivue` | **"NiiVueGPU"** | **behavior-changed** |
| `type` | (CJS/UMD-style) | `module` | new |
| `main`/`module` | `./build/niivue/index.js` | `./dist/niivuegpu.js` | **signature-changed** |
| `types` | n/a here | `./dist/index.d.ts` | new |
| Subpath: `./utils` | present | **removed** | **removed** |
| Subpath: `./drawing` | present | **removed** | **removed** |
| Subpath: `./min` | present | **removed** | **removed** |
| Subpath: `./webgpu` | — | **added** → `dist/niivuegpu.webgpu.js` | **new** |
| Subpath: `./webgl2` | — | **added** → `dist/niivuegpu.webgl2.js` | **new** |
| Default named export `Niivue` | `class Niivue extends EventTarget` | **removed as a named export** — barrel exports `default` (= class from `./NVControl`) and `default as NiiVueGPU`; **no named `Niivue`** | **removed / signature-changed** |

Evidence (published rc.9 artifact, `registry.npmjs.org/@niivue/niivue/1.0.0-rc.9`):

```json
"type": "module",
"main": "./dist/niivuegpu.js",
"module": "./dist/niivuegpu.js",
"types": "./dist/index.d.ts",
"exports": {
  ".":        { "types": "./dist/index.d.ts",        "import": "./dist/niivuegpu.js" },
  "./webgpu": { "types": "./dist/index.webgpu.d.ts", "import": "./dist/niivuegpu.webgpu.js" },
  "./webgl2": { "types": "./dist/index.webgl2.d.ts", "import": "./dist/niivuegpu.webgl2.js" },
  "./assets/fonts":   { ... },
  "./assets/matcaps": { ... }
}
```

- rc.9 runtime deps: `cbor-x`, `clipper2-ts`, `earcut`, `gl-matrix`,
  `nifti-reader-js`. `peerDependencies`: none.
- **fidnii impact:** the bare-specifier default import resolves to
  `dist/niivuegpu.js` (the dual-backend build, see §2). To force WebGL2 fidnii
  imports the `./webgl2` subpath, which is a real published export (verified
  above) — **not** something fidnii has to construct itself.

Barrel (mono `main`, `src/index.ts`): the default `.` entry's class export is
`export { default, default as NiiVueGPU } from './NVControl'`
(`src/index.ts`, "export { default, default as NiiVueGPU } from './NVControl'").
There is **no** `export { Niivue }`. The enums (`DRAG_MODE`, `SLICE_TYPE`,
`MULTIPLANAR_TYPE`, `SHOW_RENDER`, `NiiDataType`) now come from `./NVConstants`,
and `BackendType` is a public exported type from `./NVTypes`
(see [[enums-and-exports]]).

---

## 2. Which backend does the default `.` entry select?

**Answer: runtime auto-detect, WebGPU-first, with fallback to WebGL2 only when
`navigator.gpu` is undefined.** It is *not* a pure "auto-detect best"; the
default is literally `'webgpu'` and WebGL2 is a *fallback*, not a co-equal
auto-choice.

### 2.1 Dispatch chain

The three index entries select different controller classes (mono `main`):

| Entry | Exports default class | `distributionBackend` | Source |
|---|---|---|---|
| `.` (`index.ts`) | `./NVControl` | `'both'` | `index.ts` ("export { default, default as NiiVueGPU } from './NVControl'") |
| `./webgpu` (`index.webgpu.ts`) | `./NVControlWebGPU` | `'webgpu'` | `index.webgpu.ts` |
| `./webgl2` (`index.webgl2.ts`) | `./NVControlWebGL2` | `'webgl2'` | `index.webgl2.ts` |

All three subclass the same `NVControlBase` ("NiiVueGPU") and differ only by
which `viewLifecycle` module + `distributionBackend` string they pass to `super`:

- `NVControl.ts:4-8` → `super(options, viewBoth, 'both')` then
  `this.enforceBackendAvailability()`.
- `NVControlWebGL2.ts:6-12` →
  `super({ ...options, backend: options.backend ?? 'webgl2' }, viewWebGL2, 'webgl2')`
  then `this.enforceBackendAvailability()`. **← forces WebGL2.**
- `NVControlWebGPU.ts:4-8` → `super(options, viewWebGPU, 'webgpu')` then
  `this.enforceBackendAvailability()`.

### 2.2 The default's backend value

`NVControlBase` constructor (mono `main`, `NVControlBase.ts:270-324`,
specifically `:281`):

```ts
this.opts = {
  backend: options.backend ?? 'webgpu',   // ← default = WebGPU
  ...
}
```

So for the `.` entry, if you do `new Niivue()` with no `backend` option,
`opts.backend === 'webgpu'`.

### 2.3 The fallback gate — `enforceBackendAvailability()`

`NVControlBase.ts:1301-1329`:

```ts
protected enforceBackendAvailability(): void {
  if (this._distributionBackend === 'both') {
    if (this.opts.backend === 'webgpu' && !navigator.gpu) {
      log.warn('WebGPU not available, falling back to WebGL2')
      this.opts.backend = 'webgl2'
    }
    return
  }
  if (this.opts.backend === 'webgpu' && !navigator.gpu) {
    throw new Error('This niivuegpu WebGPU-only distribution requires browser WebGPU support.')
  }
  if (this._distributionBackend === 'webgpu') {
    if (this.opts.backend === 'webgl2') {
      throw new Error("This niivuegpu distribution includes only WebGPU. Requested backend 'webgl2' is unavailable.")
    }
    this.opts.backend = 'webgpu'; return
  }
  if (this.opts.backend === 'webgpu') {
    throw new Error("This niivuegpu distribution includes only WebGL2. Requested backend 'webgpu' is unavailable.")
  }
  this.opts.backend = 'webgl2'
}
```

**Critical nuance for fidnii's headless tests:** the `'both'` fallback test is
**`!navigator.gpu`** — i.e. it falls back to WebGL2 only when the WebGPU API is
*entirely absent*. If headless Chromium **exposes `navigator.gpu` but cannot
actually obtain a working adapter/device** (the common Linux-CI situation), the
default build **stays on WebGPU** and then fails later at `view.init()` (§3)
instead of gracefully falling back. The fallback is an API-presence check, not a
device-acquisition check. **→ behavior-changed; this is the trap.**

### 2.4 The actual view object is chosen at attach time

`control/viewBoth.ts:52-56` (the `'both'` lifecycle):

```ts
if (ctrl.opts.backend === 'webgl2') {
  ctrl.view = new NVViewGL(canvas, ctrl.model, ctrl.opts)
} else {
  ctrl.view = new NVViewGPU(canvas, ctrl.model, ctrl.opts)   // default path
}
```

Note the `else` is WebGPU: **anything other than the literal `'webgl2'` →
WebGPU**. So forcing WebGL2 means `opts.backend` must equal `'webgl2'` *before*
`attachToCanvas` runs.

### 2.5 README confirms the narrative

`packages/niivue/README.md`:
- L10: "A browser with WebGPU support (Chrome, Firefox). Safari works if you have
  a recent MacOS (version 26) or iOS. **Older browsers will fall back to the
  WebGL2 renderer.**"
- L62-77 "Backend-specific distributions": "By default, `@niivue/niivue` includes
  both backends (WebGPU + WebGL2 fallback): `import NiiVue from '@niivue/niivue'`
  … `import NiiVueWebGL2 from '@niivue/niivue/webgl2' // WebGL2-only` … In
  backend-only builds, selecting the missing backend throws an explicit error."

### 2.6 How to FORCE WebGL2 — two supported ways

1. **(Recommended) Subpath import** — `import NiiVueWebGL2 from '@niivue/niivue/webgl2'`.
   The class hard-pins `backend: 'webgl2'` (`NVControlWebGL2.ts:6-12`), the
   `'webgl2'` lifecycle's `attachToCanvas` **throws** if `opts.backend === 'webgpu'`
   (`control/viewWebGL2.ts:37-41`), and the build never imports `NVViewGPU` — so
   there is no way to fall into WebGPU. **No `navigator.gpu` dependence at all.**
2. **Constructor option on the default `.` build** — `new Niivue({ backend: 'webgl2' })`.
   `options.backend ?? 'webgpu'` keeps the explicit `'webgl2'`
   (`NVControlBase.ts:281`); `enforceBackendAvailability()` `'both'` branch is a
   no-op for `'webgl2'` (`:1303-1308`); attach picks `NVViewGL`
   (`viewBoth.ts:52-53`). Works, but bundles the WebGPU path and depends on the
   caller never dropping the option.

`BackendType` is `'webgpu' | 'webgl2'` (`NVTypes.ts:608`); `NiiVueOptions.backend?:
BackendType` (`NVTypes.ts:676`); `DistributionBackend = 'both' | 'webgpu' |
'webgl2'` (`NVControlBase.ts:135`).

---

## 3. Constructor / init changes — is `attachToCanvas` still the path?

**Yes — construction + `await attachToCanvas(canvas)` is still the path, and it is
still async. No new separate async init step is required.** fidnii already does
`await nv.attachToCanvas(canvas)` (`test-page/main.ts:445,455`), which remains
correct.

### 3.1 Public method signatures (mono `main`, `NVControlBase.ts`)

```ts
// NVControlBase.ts:1368-1370
async attachTo(id: string, isAntiAlias = null): Promise<this> {
  await this._viewLifecycle.attachTo(this, id, isAntiAlias)
  return this
}

// NVControlBase.ts:1372-1378
async attachToCanvas(
  canvas: HTMLCanvasElement,
  isAntiAlias: boolean | null = null,
): Promise<this> {
  await this._viewLifecycle.attachToCanvas(this, canvas, isAntiAlias)
  return this
}
```

- **Signature delta vs fidnii's call:** fidnii calls `await nv.attachToCanvas(canvas)`
  with one arg — still valid (`isAntiAlias` is optional). Return type is now
  `Promise<this>` (was the instance in 0.68; fidnii ignores the return value, so
  no impact). **Tag: signature-changed (compatible).**

### 3.2 The single async init gate

The lifecycle's `attachToCanvas` (`control/viewBoth.ts:57-58`) does:

```ts
await ctrl.view.init() // Single async entry point
```

and emits `viewAttached` with `{ canvas, backend }` on success
(`viewBoth.ts:69-72`). So **all** GPU/GL context creation is awaited *inside*
`attachToCanvas`. There is **no public `ready()` / `whenReady()` /
`isInitialized` gate** to call afterward — a grep for `ready|isReady|whenReady|
isInitialized` in `NVControlBase.ts` finds only an unrelated comment
(`NVControlBase.ts:3459`). **Tag: new behavior, but no new fidnii call needed.**

> **Failure-mode change (behavior-changed).** If the selected backend cannot
> initialize, `view.init()` **throws** and `attachToCanvas` **rejects**
> (`viewBoth.ts:74-77` logs `'Failed to initialize view:'` and re-throws). In
> 0.68 a WebGL2 context failure surfaced differently. For fidnii: a rejected
> `attachToCanvas` will fail the Playwright step at the `await`. This is *why*
> §2.3's "stays on WebGPU when `navigator.gpu` exists but no device" matters —
> the symptom would be `attachToCanvas` rejecting in CI.

### 3.3 No-arg `super()` for NVImage subclass — unchanged surface (cross-ref)

Not a backend concern, but the backend split did not move `NVImage` out of the
public type surface: `NVImage` is still exported (as a type) from `index.ts` and
the WebGL2/WebGPU barrels. fidnii's `class OMEZarrNVImage extends NVImage` with
`super()` (`src/OMEZarrNVImage.ts:99,352`) depends on the **value** export of
`NVImage`; confirm in [[nvimage-api]] that the WebGL2 build re-exports `NVImage`
as a *value* (the barrels list it under `export type { ... NVImage ... }`,
which is a **type-only** re-export). **UNVERIFIED here whether the runtime value
constructor `NVImage` is importable from `@niivue/niivue/webgl2`** — this is a
separate, important check owned by [[nvimage-api]], flagged so the backend
decision (use the `./webgl2` subpath) is cross-checked against fidnii's need to
*subclass* `NVImage`. If the value isn't exported from the subpath, fidnii would
import `NVImage` (value) from the default `.` entry while importing the
controller from `./webgl2` — both are fine to mix since they share the same
`dist` internals, but it must be verified.

---

## 4. Headless-Chromium support — does WebGPU run headless?

**Only with explicit Chromium flags and a software Vulkan adapter.** It does not
"just work" under plain headless Chromium on Linux CI.

### 4.1 niivue's own benchmark harness (the strongest evidence)

From a repo-wide search of `niivue/mono` (`packages/niivue/bench/run-bench.ts`,
~L41-47):

```ts
// In headless mode we explicitly force the SwiftShader Vulkan ICD. On Linux CI
// runners there is no other Vulkan driver, so without this flag WebGPU init fails.
const args = ['--enable-unsafe-webgpu', '--no-sandbox']
if (!headed) args.push('--enable-features=Vulkan', '--use-vulkan=swiftshader')
```

- `--enable-unsafe-webgpu` is passed **unconditionally**; the Vulkan/SwiftShader
  flags are added **only in headless** mode.
- Launch: `import { chromium } from 'playwright'` →
  `chromium.launch({ headless: !headed, args })` (Playwright **chromium**, not the
  `chrome` channel). Playwright dep `^1.59.1` (`packages/niivue/package.json`).
- The benchmark URL selects backend via `?backend=webgpu` / `?backend=webgl2`;
  the default backend set is `webgpu webgl2`
  (`packages/niivue/bench/compare-to-main.sh`, `BENCH_BACKENDS="${BENCH_BACKENDS:-webgpu webgl2}"`).

> Source-vs-artifact: these `bench/` facts come from mono `main` via code search
> (Explore agent), not from the published npm artifact (bench tooling isn't
> shipped to npm). They establish *how the niivue authors make WebGPU work
> headless*, which is exactly fidnii's environment question.

### 4.2 CI gate does not run browser WebGPU

The PR-gate workflow runs unit tests (Bun) + lint + typecheck + a packed
consumer smoke test; the **Playwright benchmarks are not part of the PR gate**
(they are a local/manual `bench:compare` tool). CHANGELOG `1.0.0-rc.9` entries
confirm the perf harness is bench-only: e.g. "replace CI perf gate with local
bench:compare script", "dual-backend bench (WebGPU + WebGL2) with GPU timer
queries", "add Playwright bench runner" (`packages/niivue/CHANGELOG.md:13-23`).
**Implication:** niivue does not itself prove "WebGPU works in a generic headless
Chromium PR CI" — it proves the opposite (it needs special flags), so fidnii
should not assume the default WebGPU path is CI-safe.

> The `packages/niivue/CHANGELOG.md` (165 lines) has **no prose "0.68 → 1.0
> backend split" entry**; the backend split is documented in **source + npm
> exports + README**, which is why this doc cites those rather than a changelog
> bullet. Stated explicitly to avoid implying a changelog narrative that does not
> exist.

### 4.3 fidnii's current headless setup

`fidnii/playwright.config.ts:24-27` launches Chromium with **only**:

```ts
launchOptions: {
  args: process.platform === "linux" ? ["--use-gl=egl"] : [],
}
```

- `--use-gl=egl` is a **WebGL/ANGLE** flag (per the in-file comment "WebGL
  requires a real browser context; EGL is only available on Linux"). It does
  **nothing** to provision a headless WebGPU adapter (no `--enable-unsafe-webgpu`,
  no `--enable-features=Vulkan`, no `--use-vulkan=swiftshader`).
- Project: `chromium` / `devices["Desktop Chrome"]`; per-test timeout 120s; loads
  real S3 OME-Zarr; `workers: 1` on CI (`playwright.config.ts:18-34`).
- Therefore, under the **default WebGPU-first** niivue build, fidnii's tests would
  attempt WebGPU and (if no usable device) reject at `attachToCanvas`. **WebGL2 is
  the safe, already-provisioned path** for this exact config.

---

## 5. Recommended backend choice for fidnii

**Force WebGL2 via the dedicated subpath build.** Concretely:

1. **In the test page / any place that constructs the viewer**, change
   `import { Niivue } from '@niivue/niivue'` →
   `import NiiVueWebGL2 from '@niivue/niivue/webgl2'` and construct
   `new NiiVueWebGL2(...)`.
   - `test-page/main.ts:34` imports `Niivue` (value) today; this is the primary
     construction site (`test-page/main.ts:445,455` call `attachToCanvas`).
   - Rationale: the `./webgl2` build *cannot* select WebGPU — it hard-pins
     `'webgl2'` (`NVControlWebGL2.ts:6-12`) and throws on a `'webgpu'` request
     (`viewWebGL2.ts:37-41`). This removes the `navigator.gpu`-presence trap (§2.3)
     entirely and keeps fidnii on the renderer its EGL flag already supports.
2. **Library code** (`src/OMEZarrNVImage.ts:10`, `src/types.ts:5`,
   `src/ViewportBounds.ts:4`) imports `Niivue` **as a type only** — those become
   `import type { NVImage } from '@niivue/niivue'` (type surface) and the
   controller type. Because 1.0 has **no named `Niivue` type** (§1), the
   type-only references must be repointed to the 1.0 type/class name
   (default export / `NiiVueGPU`). Track that rename in [[niivue-class-api]];
   the **backend** action here is only "don't import the WebGPU-defaulting
   value constructor."
3. **Keep `await nv.attachToCanvas(canvas)`** exactly as-is — no new async init
   call is needed (§3).

If fidnii instead keeps the default `.` import, the minimum viable change is
`new Niivue({ backend: 'webgl2' })` at **every** construction site — but the
subpath import is preferred because it is a single, un-bypassable decision and it
shrinks the bundle (no WebGPU/WGSL code).

> **Do not rely on the WebGPU→WebGL2 auto-fallback** for fidnii's headless tests.
> The fallback triggers on `!navigator.gpu` (§2.3), which is *not* the failure
> mode of a headless runner that exposes the API but lacks a device.

---

## 6. Headless Playwright implications

- **WebGL2 path = no config change needed.** fidnii's existing
  `--use-gl=egl` (`playwright.config.ts:26`) already provisions the ANGLE/EGL GL
  context the WebGL2 renderer uses. Forcing WebGL2 (§5) keeps the suite green
  without touching `launchOptions`.
- **If fidnii ever wants to test the WebGPU path**, it must mirror niivue's bench
  flags: add `--enable-unsafe-webgpu` and (headless Linux)
  `--enable-features=Vulkan --use-vulkan=swiftshader` to
  `launchOptions.args`, and expect SwiftShader-level performance, not GPU. That is
  a *separate, optional* effort and **not** required for migration. → modeled on
  `packages/niivue/bench/run-bench.ts:41-47`.
- **Failure signal to watch for after the bump:** a rejected
  `await attachToCanvas(...)` (Playwright step fails at that line) or a console
  warning `'WebGPU not available, falling back to WebGL2'`
  (`NVControlBase.ts:1303-1306`). The former means WebGPU was attempted and no
  device was available; the latter means the API was absent and fallback worked.
  Forcing WebGL2 makes both moot.
- **Canvas ownership (cross-ref to [[api-surface]] §4).** fidnii attaches DOM
  `wheel` listeners to `nv.canvas` (`src/OMEZarrNVImage.ts:1858,1899`). In 1.0 the
  lifecycle may **replace the canvas element** on backend switch / recreate
  (`viewBoth.ts:107-133` `replaceCanvasElement`, also in the webgl2/webgpu
  `recreateView`). With a **fixed WebGL2 build** there is no backend switch, but
  `recreateView` (e.g. on antialias/DPR change via `reinitializeView`) still
  swaps the `<canvas>`. Any fidnii listener bound to the *old* `nv.canvas` would
  be orphaned. **Tag: behavior-changed (new in 1.0).** Low risk for the current
  suite (fidnii doesn't call `reinitializeView`), but flag for Risk Hotspots
  since fidnii re-reads `nv.canvas` each use rather than caching — that pattern is
  actually safe here.

---

## 7. Change inventory (tagged)

| # | Change (0.68.1 → 1.0.0-rc.9) | Tag | Evidence | fidnii action |
|---|---|---|---|---|
| 1 | Default `.` build prefers **WebGPU** (`backend ?? 'webgpu'`); WebGL2 only as fallback | **behavior-changed** | `NVControlBase.ts:281`; README L62-64 | Force WebGL2 (item 4) |
| 2 | Fallback gate is `!navigator.gpu` (API-presence, not device-acquisition) | **behavior-changed** | `NVControlBase.ts:1303-1306` | Don't rely on fallback in headless CI |
| 3 | New `./webgl2` subpath build, hard-pins `'webgl2'`, throws on WebGPU request | **new** | `index.webgl2.ts`; `NVControlWebGL2.ts:6-12`; `viewWebGL2.ts:37-41`; npm `exports["./webgl2"]` | Import `@niivue/niivue/webgl2` |
| 4 | New `./webgpu` subpath build (WebGPU-only) | **new** | `index.webgpu.ts`; `NVControlWebGPU.ts`; npm `exports["./webgpu"]` | Do **not** use |
| 5 | New `backend?: BackendType` constructor option (`'webgpu' \| 'webgl2'`) | **new** | `NVTypes.ts:608,676` | Optional alt: `new Niivue({ backend:'webgl2' })` |
| 6 | `attachToCanvas(canvas, isAntiAlias?)` now `async → Promise<this>` | **signature-changed** (compatible) | `NVControlBase.ts:1372-1378` | Keep `await nv.attachToCanvas(canvas)` (already correct) |
| 7 | Single async init `await view.init()` inside attach; attach **rejects** on init failure | **behavior-changed** | `viewBoth.ts:57-58,74-77` | None (no new call); watch for rejected attach in CI |
| 8 | No separate public `ready()`/`whenReady()` gate | **unchanged** (none added) | grep `NVControlBase.ts` (only `:3459` comment) | No new call to add |
| 9 | Package renamed identity **"NiiVueGPU"**; `main` → `dist/niivuegpu.js`; `type: module` | **signature-changed** | npm rc.9 fields | Update imports/specifiers |
| 10 | Named export `Niivue` **removed**; default + `NiiVueGPU` instead | **removed** | `index.ts` barrel | Repoint type/value imports ([[niivue-class-api]]) |
| 11 | Subpaths `./utils`, `./drawing`, `./min` **removed** | **removed** | 0.68 vs rc.9 npm `exports` | n/a if fidnii didn't use them (verify) |
| 12 | Lifecycle may replace the `<canvas>` element on recreate/backend switch | **behavior-changed** | `viewBoth.ts:107-133` | Low risk (no `reinitializeView` use); keep re-reading `nv.canvas` |
| 13 | Headless WebGPU needs `--enable-unsafe-webgpu` + SwiftShader Vulkan | **new** (env) | `bench/run-bench.ts:41-47` | Stay WebGL2; no flag change to `playwright.config.ts` |

---

## 8. Open / UNVERIFIED items (hand off, do not guess)

- **`NVImage` as a runtime *value* from `@niivue/niivue/webgl2`.** The barrels
  list `NVImage` under `export type { ... }` (type-only). fidnii needs the
  **value** constructor to `extends NVImage`. Whether the value is importable
  from the `./webgl2` subpath (vs only from `.`) is **UNVERIFIED** — owned by
  [[nvimage-api]] / [[niivue-class-api]]. (Mixing: importing the value from `.`
  and the controller from `./webgl2` is safe because both resolve into the same
  `dist` internals, but confirm the value export path.)
- **Exact `view.init()` body / whether WebGL2 init can also throw on a bad EGL
  context** (`gl/NVViewGL.ts` not read in this pass) — **UNVERIFIED**; not needed
  for the backend decision, but relevant if WebGL2 init ever rejects in CI.
- **rc.9 artifact body-level parity with mono `main`** for `NVControlBase`
  internals (line numbers cited are `main`). Package-level facts (exports, entry
  files) are verified against the published artifact; deep method bodies are
  verified against `main` SOURCE only.
