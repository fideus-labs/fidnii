---
type: research
title: Niivue 1.0 — Event System
created: 2026-06-22
tags:
  - niivue
  - changelog
  - breaking-change
related:
  - '[[index]]'
  - '[[migration-map]]'
  - '[[niivue-class-api]]'
  - '[[api-surface]]'
---

# Niivue 1.0 — Event System

Migration of the `@niivue/niivue` event surface that fidnii consumes, framed
`0.68.x → 1.0.0-rc.9`.

- **0.68.1 baseline** (ground truth): `@niivue/niivue@0.68.1` —
  `build/niivue/index.d.ts` (`interface NiivueEventMap` at L211;
  `class NiivueEvent<K> extends CustomEvent<NiivueEventMap[K]>` at L356;
  typed `addEventListener` at L926).
- **1.0 source**: `niivue/mono@main` —
  `packages/niivue/src/NVEvents.ts` (192 lines; `interface NVEventMap` at
  L106–164; typed `NVEventTarget.addEventListener` at L172–192) plus
  `packages/niivue/src/NVTypes.ts` (`NiiVueLocation` L982–990,
  `NiiVueLocationValue` L972–980, `DragReleaseInfo` L789–797).
- **fidnii usage**: `src/OMEZarrNVImage.ts` (registrations + handlers; see
  [[api-surface]] §5).

## TL;DR

The transport model is **unchanged**: Niivue 1.0 is still an `EventTarget`, still
dispatches `CustomEvent`, and the typed
`addEventListener<K extends keyof NVEventMap>(type, (evt: CustomEvent<NVEventMap[K]>) => void, opts)`
signature is preserved (only the map/listener type names changed:
`NiivueEventMap` → `NVEventMap`, `NiivueEventListener` →
`NVEventListener`/`NVEventTarget`). The `{ signal }` `AbortController` teardown
fidnii relies on still works (the listener `options` still accept
`AddEventListenerOptions`).

Of fidnii's **five** consumed events:

- **3 are unchanged** in name and in the `e.detail` field fidnii touches:
  `clipPlaneChange` (`detail.clipPlane`), `sliceTypeChange`
  (`detail.sliceType`), `locationChange` (whole `detail`).
- **2 are renamed/removed breaking changes**: **`mouseUp` → `pointerUp`** and
  **`zoom3DChange` → removed** (closest replacement
  `azimuthElevationChange`). Both old names are **grep-absent** from
  `NVEvents.ts`.

**De-risking finding (verified by reading the handler bodies):** fidnii's three
detail-consuming handlers are all written so that the **handler body never reads
the payload** — the `detail`/`clipPlane`/`location` parameters are
underscore-prefixed and unused; each handler re-derives state from the live
`Niivue` instance (`nv.scene.crosshairPos`, etc.). So the only event-system
contract that can break fidnii is **(a) the event name** and **(b) the
`e.detail.<field>` access that appears at the *registration* call site** (which
must still type-check). The actual *reshape* of `NiiVueLocation` is therefore
**inert** for fidnii. See per-event notes below.

## fidnii's 5 events: 0.68.1 → 1.0.0-rc.9

| # | 0.68 event | 1.0 event | 1.0 `detail` shape | `e.detail` field fidnii reads (at registration) | Status | Required action (fidnii file:line) |
|---|---|---|---|---|---|---|
| 1 | `clipPlaneChange` | `clipPlaneChange` | `ClipPlaneChangeDetail = { clipPlane: number[] }` (`NVEvents.ts` L62) | `e.detail.clipPlane` | **Unchanged** | None. `src/OMEZarrNVImage.ts:495–497` stays valid; handler `onNiivueClipPlaneChange` (`:1274`) is a no-op anyway. |
| 2 | `sliceTypeChange` | `sliceTypeChange` | `SliceTypeChangeDetail = { sliceType: number }` (`NVEvents.ts` L63) | `e.detail.sliceType` | **Unchanged** (type note) | None functionally. `src/OMEZarrNVImage.ts:2311–2314`. **Note:** 1.0 types `sliceType` as `number`; 0.68 typed it `SLICE_TYPE`. fidnii passes it to `_handleSliceTypeChange(nv, newSliceType: SLICE_TYPE)` — assigning `number`→`SLICE_TYPE` may need a cast under 1.0 types. **UNVERIFIED** whether `SLICE_TYPE` is a numeric enum that absorbs `number` cleanly (see [[enums-and-exports]]). |
| 3 | `locationChange` | `locationChange` | `NiiVueLocation` (`NVTypes.ts` L982–990) — see shape below | whole `e.detail` (passed as `_location`, **unused**) | **Unchanged (name); detail reshaped but inert** | None. `src/OMEZarrNVImage.ts:2320–2323`; handler `_handleLocationChange` (`:2485`) ignores `_location` and re-reads `nv.scene.crosshairPos`. The reshape cannot break fidnii. |
| 4 | **`mouseUp`** | **`pointerUp`** | `PointerUpDetail = { x: number; y: number; button: number }` (`NVEvents.ts` L67) | none (callback ignores arg) | **RENAMED — breaking** | **Rename the listener string** `"mouseUp"` → `"pointerUp"` at `src/OMEZarrNVImage.ts:1838–1839`. Handler `_handleViewportInteractionEnd(_nv)` (`:1965`) ignores the event object, so no detail work needed. |
| 5 | **`zoom3DChange`** | **(removed)** → `azimuthElevationChange` | `AzimuthElevationChangeDetail = { azimuth: number; elevation: number }` (`NVEvents.ts` L52–55) | none (callback ignores arg) | **REMOVED — breaking; semantic mismatch** | **Replace** `"zoom3DChange"` at `src/OMEZarrNVImage.ts:1847–1848`. See §"Event 5" — `azimuthElevationChange` fires on **rotation**, not zoom; combine with the existing canvas `wheel` listener (and consider `pointerUp`) to retain zoom coverage. |

Bold = **breaking rename/removal**.

## Preserved EventTarget / CustomEvent model

0.68.1 (`index.d.ts`):

```ts
interface NiivueEventMap { /* … */ }
declare class NiivueEvent<K extends keyof NiivueEventMap>
  extends CustomEvent<NiivueEventMap[K]> { constructor(type: K, detail: NiivueEventMap[K]); }
type NiivueEventListener<K> = (event: NiivueEvent<K>) => void | Promise<void>;
// on the Niivue class (L926):
addEventListener<K extends keyof NiivueEventMap>(type: K, listener: NiivueEventListener<K>, options?: …): void;
```

1.0 (`NVEvents.ts` L166–192):

```ts
export type NVEventListener<K extends keyof NVEventMap> =
  NVEventMap[K] extends undefined
    ? (evt: Event) => void
    : (evt: CustomEvent<NVEventMap[K]>) => void

export interface NVEventTarget extends EventTarget {
  addEventListener<K extends keyof NVEventMap>(
    type: K,
    listener: NVEventListener<K>,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener<K extends keyof NVEventMap>(
    type: K,
    listener: NVEventListener<K>,
    options?: boolean | EventListenerOptions,
  ): void
}
```

Conclusion: **the `addEventListener('name', (e) => e.detail…, { signal })` pattern
fidnii uses still works** in 1.0. The browser-native `CustomEvent`/`detail`
delivery is intact; `options` still accept `AddEventListenerOptions`, so fidnii's
`AbortController` `{ signal }` teardown (`src/OMEZarrNVImage.ts:494–500`,
`:2311–2326`, `:1838–1853`; aborted in `detachNiivue` `:2363` and `:2366–2368`)
is preserved. Renames are at the **type-name** level (`NiivueEventMap` →
`NVEventMap`); fidnii never imports those type names, so they cause no fidnii
breakage on their own.

> **Note (type names are internal, not imported by fidnii).** Per
> [[api-surface]] §1, fidnii imports no event types from `@niivue/niivue` — it
> relies on the inferred `CustomEvent<…>` parameter type. So
> `NiivueEventMap`/`NiivueEvent`/`NiivueEventListener` disappearing from the 1.0
> export surface (replaced by `NVEventMap`/`NVEventTarget`/`NVEventListener`) does
> not break a fidnii import. **UNVERIFIED:** whether 1.0 actually *exports*
> `NVEventMap`/`NVEventTarget` from the package barrel (they are defined in
> `NVEvents.ts`); not needed for fidnii, but relevant if any future typed
> handler annotation is added.

## EventTarget vs `onX` callback props (Question 3)

Both APIs exist, in both versions — they are **parallel**, not mutually
exclusive.

- **0.68.1** exposed `onX` callback *properties* on the instance:
  `onClipPlaneChange(clipPlane: number[])` (L838), `onSliceTypeChange(sliceType: SLICE_TYPE)`
  (L871), `onLocationChange(location: unknown)` (L699), `onMouseUp(data: Partial<UIData>)`
  (L687), `onZoom3DChange(zoom: number)` (L821) — alongside the `EventTarget`
  `addEventListener`.
- **1.0** keeps the `EventTarget` route (the verified backbone above). Whether
  the `onX` setter aliases are *all* retained 1:1 in 1.0 is **UNVERIFIED** here
  (`NVEvents.ts` defines only the `EventTarget`; the `onX` props, if any, live on
  the `Niivue` class — see [[niivue-class-api]]). **fidnii does not use any `onX`
  callback prop** ([[api-surface]] §5), so this is informational only.

**Bottom line:** fidnii should stay on `addEventListener` — it is confirmed
present and typed in 1.0, and supports the `{ signal }` teardown the `onX`
single-slot setters do not.

## Event-by-event detail

### Events 1–2 — `clipPlaneChange`, `sliceTypeChange` (unchanged)

Identical names and field shapes across versions.

- `clipPlaneChange`: 0.68 `{ clipPlane: number[] }` → 1.0
  `ClipPlaneChangeDetail = { clipPlane: number[] }` (`NVEvents.ts` L62). fidnii
  reads `e.detail.clipPlane` at `:497`; valid unchanged.
- `sliceTypeChange`: 0.68 `{ sliceType: SLICE_TYPE }` → 1.0
  `SliceTypeChangeDetail = { sliceType: number }` (`NVEvents.ts` L63). The
  **runtime value is the same**; only the *static type* widened from
  `SLICE_TYPE` to `number`. fidnii reads `e.detail.sliceType` at `:2314` and
  feeds `_handleSliceTypeChange(nv, newSliceType: SLICE_TYPE)`. Under 1.0 types
  the `number`→`SLICE_TYPE` assignment may require a cast at the call site.
  Low risk; flag for a typecheck pass.

### Event 3 — `locationChange` and the `NiiVueLocation` shape (Question 1)

1.0 `NiiVueLocation` (`NVTypes.ts` L982–990):

```ts
export type NiiVueLocation = {
  mm: number[]
  axCorSag: number
  vox: number[]
  frac: number[]
  xy: [number, number]
  values: NiiVueLocationValue[]   // L972–980: { name, value, id, mm[], vox[], label? }
  string: string
}
```

In 0.68.1 the map typed this event as `locationChange: unknown` (`index.d.ts`
L217) — i.e. 0.68 gave **no** static shape at all; 1.0 *adds* a concrete
`NiiVueLocation` type. So 1.0 is strictly *more* typed here.

**Does `_handleLocationChange(nv, e.detail)` still get what it needs? Yes,
trivially.** The handler signature is
`private _handleLocationChange(nv: Niivue, _location: unknown)`
(`src/OMEZarrNVImage.ts:2485`) and the body **never references `_location`**
(underscore-prefixed, unused). It instead reads `nv.scene?.crosshairPos`
(`:2494`) and calls `nv.frac2mm(...)` to recompute position. Therefore:

- The `NiiVueLocation` reshape (any added/renamed/removed field) is **inert**
  for fidnii — there is no `detail.field` dependency to break.
- The registration site `(e) => this._handleLocationChange(nv, e.detail)`
  (`:2320–2323`) passes the whole `detail` and type-checks regardless of shape.
- The real dependencies are on `nv.scene.crosshairPos` and `nv.frac2mm` —
  tracked separately under [[api-surface]] §3 / [[niivue-class-api]], **not**
  here.

### Event 4 — `mouseUp` → `pointerUp` (Question 2a)

**Breaking rename.** `mouseUp` is **absent** from 1.0 `NVEvents.ts`; the analogous
end-of-pointer-interaction event is `pointerUp`:

```ts
export type PointerUpDetail = { x: number; y: number; button: number }  // NVEvents.ts L67
// NVEventMap (L114):  pointerUp: PointerUpDetail
```

**Semantics:** good match for "end of mouse/touch interaction." 0.68's `mouseUp`
carried `Partial<UIData>`; 1.0's `pointerUp` carries pointer coords + button.
fidnii's handler `_handleViewportInteractionEnd(_nv)` ignores the event object
entirely (`:1965`, arg unused — it just debounces a viewport-bounds recompute),
so the **payload difference is irrelevant**; only the **listener string** needs
to change.

- **Action:** `"mouseUp"` → `"pointerUp"` at `src/OMEZarrNVImage.ts:1838–1839`.

### Event 5 — `zoom3DChange` → (removed; closest: `azimuthElevationChange`) (Question 2b)

**Breaking removal.** `zoom3DChange` is **absent** from 1.0 `NVEvents.ts` (no 3D
zoom-level event survives). The nearest 3D-view-control event is
`azimuthElevationChange`:

```ts
export type AzimuthElevationChangeDetail = { azimuth: number; elevation: number }  // NVEvents.ts L52–55
// NVEventMap (L137):  azimuthElevationChange: AzimuthElevationChangeDetail
```

**Semantic mismatch — read carefully.** `azimuthElevationChange` reports
**rotation** of the 3D render (camera azimuth/elevation), **not zoom**. 0.68's
`zoom3DChange` fired on 3D **zoom-level** changes. So the rename is **not a clean
semantic substitute**:

- fidnii used `zoom3DChange` to detect "3D viewport changed → recompute bounds"
  (`_handleViewportInteractionEnd`, `:1847–1850`). Rotation is one such change;
  **zoom is the other and `azimuthElevationChange` does not cover it.**
- **Mitigating fact:** fidnii *already* listens to the canvas DOM `wheel` event
  for scroll-zoom and routes it to the same `_handleViewportInteractionEnd`
  (`src/OMEZarrNVImage.ts:1856–1864`), and separately installs a capturing
  `wheel` override for 3D zoom (`_hookZoomOverride`, `:1898`). So the **wheel
  path already captures most 3D zoom**; `zoom3DChange` was a secondary signal.

**Recommended replacement (best-fit):**

1. **`azimuthElevationChange`** — subscribe to keep recompute-on-3D-**rotation**.
   This is the direct map-entry replacement for the "3D view changed" intent.
2. Retain the existing canvas **`wheel`** listener (`:1856`) for 3D **zoom**
   coverage (it already calls `_handleViewportInteractionEnd`).
3. Optionally add **`pointerUp`** (already being added for Event 4) and/or
   **`dragRelease`** (`DragReleaseInfo`, `NVTypes.ts` L789–797) as a catch-all
   for end-of-3D-drag, if rotation-via-drag needs an explicit settle signal.

- **Action:** at `src/OMEZarrNVImage.ts:1847–1848`, replace `"zoom3DChange"` with
  `"azimuthElevationChange"`; **UNVERIFIED** that this fully reproduces the old
  firing cadence for *zoom* — validate against the existing `wheel` handlers and
  confirm no double-counting (both can call the debounced
  `_handleViewportInteractionEnd`, which is debounce-safe). **Cannot be verified
  by types alone** — recommend a runtime smoke test of 3D zoom + rotation
  triggering a resolution reselection.

## Detail-payload field renames relevant to fidnii (Question 4)

None that fidnii reads.

- `clipPlaneChange.clipPlane`, `sliceTypeChange.sliceType` — **field names
  unchanged** (only `sliceType`'s static *type* widened `SLICE_TYPE` → `number`).
- `locationChange` — detail *reshaped* (0.68 `unknown` → 1.0 `NiiVueLocation`),
  but **fidnii reads no field of it**, so no rename affects fidnii.
- `mouseUp`→`pointerUp` and `zoom3DChange`→`azimuthElevationChange` change the
  payload *type*, but fidnii's handlers **ignore the payload** in both cases.

For completeness (not consumed by fidnii), broader 1.0 detail/name changes vs
0.68 include: `imageLoaded`(NVImage) → **`volumeLoaded`** (`{ volume }`);
`frameChange` `{ volume, index }` → `{ volume, frame }`; `meshRemoved`
`{ mesh }` → `{ mesh, index }`; `volumeUpdated` `undefined` → `VolumeUpdatedDetail`;
plus new `viewAttached`/`viewDestroyed`/`canvasResize` lifecycle and
`perfFrame`/`graphRangeChange`/annotation events. These are catalogued for
[[niivue-class-api]] / [[migration-map]] and listed here only so the map sees the
overall direction of travel.
