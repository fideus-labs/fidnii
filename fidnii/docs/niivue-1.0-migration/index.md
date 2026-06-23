---
type: note
title: Niivue 1.0 Migration — Knowledge Base Index
created: 2026-06-22
tags:
  - niivue
  - migration
  - index
related:
  - '[[api-surface]]'
  - '[[migration-map]]'
  - '[[rendering-backend]]'
  - '[[niivue-class-api]]'
  - '[[nvimage-api]]'
  - '[[events]]'
  - '[[enums-and-exports]]'
---

# Niivue 1.0 Migration — Knowledge Base

This is the entry point for migrating `@fideus-labs/fidnii` from
`@niivue/niivue@0.68.1` (its pinned, green baseline) to **`@niivue/niivue@1.0.0-rc.9`**
(published 2026-06-12 under the npm `next` tag; `latest` is still `0.69.0`). It was
produced in **Phase 01** of the upgrade playbook — entirely from source: the
`niivue/mono` monorepo (`packages/niivue@main`), the published rc.9 npm artifact,
and fidnii's own code — **before any code changes**. Start at [[migration-map]];
use the others as evidence.

## Read in this order

1. **[[api-surface]]** — *reference.* Every `@niivue/niivue` symbol, method, prop,
   event, and field fidnii touches, with `file:line` references. The "what we
   depend on" baseline.
2. **[[migration-map]]** — *analysis (the keystone).* Each API → its 1.0 status
   (`unchanged`/`renamed`/`signature-changed`/`behavior-changed`/`removed`) +
   required action + evidence link, plus **Risk Hotspots**, a runtime-verification
   checklist, and suggested upgrade sequencing.

### Supporting changelog research (`changelog/`)

3. **[[rendering-backend]]** — WebGPU-first default; how to force WebGL2 for
   headless Playwright; async init.
4. **[[niivue-class-api]]** — `Niivue`→`NiiVueGPU`; the dismantling of
   `scene`/`opts`/`uiData`; removed/renamed/async methods.
5. **[[nvimage-api]]** — the 🔴 blocker: `NVImage` is now a *type*, not a class;
   the composition-over-subclassing replacement.
6. **[[events]]** — preserved EventTarget/CustomEvent model; the two renamed
   events (`mouseUp`→`pointerUp`, `zoom3DChange` removed).
7. **[[enums-and-exports]]** — `SLICE_TYPE` forward-only reverse-lookup
   regression; unchanged values; package-export & peerDependency changes.

## Headline findings

- **WebGPU-first.** The default build is now "NiiVueGPU" and prefers WebGPU.
  fidnii's headless-EGL test suite must **force WebGL2**. → [[rendering-backend]]
- **`extends NVImage` is dead** (🔴). `NVImage` is a plain object *type* with an
  index signature; no constructable volume class is exported. Rebuild as
  composition via `nii2volume()`. The index signature makes field renames fail
  **silently**. → [[nvimage-api]]
- **`Niivue` → `NiiVueGPU`**, and `scene`/`uiData` are largely gone (state moved
  to `nv.model`); several methods are removed, renamed, or now async. →
  [[niivue-class-api]]
- **Events mostly survive.** 3 of fidnii's 5 are unchanged and all handlers
  ignore their `detail`; only two listener strings change. → [[events]]
- **Enum values unchanged**, but `SLICE_TYPE[number]` reverse-lookups now return
  `undefined` (a silent buffer-key-collision risk), and fidnii's dep ranges must
  widen to admit the prerelease. → [[enums-and-exports]]

## Verification status (this knowledge base)

All 7 documents carry valid YAML front matter, and every `[[…]]` wiki-link resolves
to an existing file in this folder tree (`api-surface.md`, `migration-map.md`,
`index.md`, and `changelog/{rendering-backend,niivue-class-api,nvimage-api,events,enums-and-exports}.md`).
Verified programmatically at the close of Phase 01.

## Phase 01 deliverables — confirmed

- ✅ **Green baseline captured** at `@niivue/niivue@0.68.1` — all four toolchain
  commands (`bun install`, `bunx tsc --noEmit`, `bun run check`, the Playwright
  smoke test) exit 0. Raw logs + PASS/FAIL summary live under the playbook's
  ephemeral `Working/` folder (`Working/baseline-summary.md`). Re-run and diff
  these after the version bump to localize any regression.
- ✅ **Migration knowledge base** rendered under `docs/niivue-1.0-migration/` —
  this index, the API surface, the cross-referenced migration map, and five
  source-cited changelog topic docs, fully cross-linked for DocGraph/Obsidian.

The migration is **fully mapped**; no code has changed. Later phases execute the
[[migration-map]] in its suggested sequence, starting by forcing WebGL2 and
rebuilding the volume layer.
