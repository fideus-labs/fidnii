# AGENTS.md

Guidance for AI coding agents operating in this repository.

## Project Overview

Fidnii (`@fideus-labs/fidnii`) is a TypeScript library for rendering OME-Zarr
(NGFF) medical/scientific images inside NiiVue with progressive multi-resolution
loading. It is a **pnpm monorepo** (pnpm 10.29.2) with three workspace packages:
`fidnii/` (the library), `examples/getting-started/`, and `examples/convert/`.

## Build Commands

```bash
pnpm build                # Build all workspace packages
pnpm dev                  # Start dev servers for all packages
```

The library (`fidnii/`) builds with plain `tsc` to `fidnii/dist/` (ESM `.js` +
`.d.ts`). Examples use Vite for bundling. The dev server runs on port 5173 with
COOP/COEP headers enabled for SharedArrayBuffer support.

## Linting & Formatting

[Biome](https://biomejs.dev/) handles linting, formatting, and import sorting:

```bash
pnpm check                # Lint + format + import sorting (same as CI)
pnpm lint                 # Lint only
pnpm format               # Auto-format all files
```

## Type Checking

TypeScript strict mode is also enforced:

```bash
pnpm exec tsc --noEmit    # Run from fidnii/ to type-check without emitting
```

`tsconfig.json` enables `strict`, `noUnusedLocals`, `noUnusedParameters`, and
`noFallthroughCasesInSwitch`.

## Test Commands

All tests are **Playwright** end-to-end browser tests (Chromium only, WebGL via
EGL). Tests have a 120-second timeout because they load real data from S3.

```bash
pnpm test                                        # Run all tests across monorepo
pnpm exec playwright test                        # Run all tests in current package
pnpm exec playwright test tests/basic-loading.spec.ts  # Single test file
pnpm exec playwright test -g "page loads"        # Single test by name (grep)
pnpm exec playwright test tests/clip-planes.spec.ts -g "add a clip plane"
pnpm test:ui                                     # Interactive Playwright UI
```

Test files live in `fidnii/tests/` and `examples/getting-started/tests/`, using
the `*.spec.ts` naming convention. Tests run against a Vite-served test page at
`fidnii/test-page/`. The dev server starts automatically when tests run.

Useful flags: `--headed` (visible browser), `--debug` (step-through),
`--workers=1` (serial execution), `--reporter=list`.

## Code Style

### Formatting (Biome)

Code is formatted with [Biome](https://biomejs.dev/). Do not add semicolons.

- **Indentation**: 2 spaces, no tabs
- **Semicolons**: None
- **Quotes**: Double quotes
- **Line width**: 80 columns
- **Trailing commas**: Yes, in multi-line constructs

### Imports

Separate `import type` from value imports, even when importing from the same
module:

```typescript
import { NVImage, SLICE_TYPE } from "@niivue/niivue"
import type { Niivue } from "@niivue/niivue"
```

Group imports in order, separated by blank lines:
1. External / third-party packages
2. Internal relative imports

Relative imports must use explicit `.js` extensions (required for ESM):

```typescript
import { selectResolution } from "./ResolutionSelector.js"
import type { ClipPlane } from "./types.js"
```

### Exports

Use **named exports only** — no default exports anywhere. The barrel file
`index.ts` re-exports from all modules. Use `export type` for type-only
re-exports:

```typescript
export { OMEZarrNVImage } from "./OMEZarrNVImage.js"
export type { ClipPlane, VolumeBounds } from "./types.js"
```

### TypeScript Conventions

- **Interfaces** for object shapes and contracts (`ClipPlane`, `VolumeBounds`)
- **Type aliases** for unions and computed types (`ZarrDtype`, `TypedArray`)
- **`as const` objects** instead of TypeScript enums:
  ```typescript
  export const NiftiDataType = {
    UINT8: 2,
    INT16: 4,
  } as const
  ```
- **`readonly`** on immutable class fields
- **Defensive copies** — always spread arrays on input/output to prevent
  mutation: `[...p.point] as [number, number, number]`
- Generic parameters use single uppercase letters (`K`, `T`)
- Numeric separators for large numbers: `50_000_000`

### Naming Conventions

| Kind                  | Style              | Example                    |
|-----------------------|--------------------|----------------------------|
| Variables, parameters | camelCase          | `levelIndex`, `maxPixels`  |
| Functions             | camelCase          | `selectResolution`         |
| Classes               | PascalCase         | `OMEZarrNVImage`           |
| Interfaces, types     | PascalCase         | `ClipPlane`, `ZarrDtype`   |
| Module-level constants| SCREAMING_SNAKE    | `MAX_CLIP_PLANES`          |
| Private members       | `_camelCase`       | `_clipPlanes`, `_emitEvent`|
| Unused parameters     | `_camelCase`       | `_nv`, `_trigger`          |

**File names**: PascalCase for files exporting a primary class
(`BufferManager.ts`), camelCase for utility/type modules (`types.ts`,
`affine.ts`).

### Error Handling

- Throw plain `new Error(message)` with descriptive template-literal messages
- Validate inputs at public API boundaries; private methods trust their callers
- Use bare `catch` blocks for non-critical failures where the operation should
  continue (e.g., cleanup during teardown)
- Use `console.warn("[fidnii] ...")` for soft/non-fatal warnings
- Use `console.error(...)` for event-listener failures
- Coerce unknown errors: `error instanceof Error ? error : new Error(String(error))`

### Documentation

Every source file starts with SPDX license headers:

```typescript
// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT
```

All exported functions, classes, and interfaces must have JSDoc with `@param`,
`@returns`, and `@throws` tags as applicable. Use `@example` blocks on major
public APIs. Use `//` for inline comments and `/** */` for JSDoc only.

### Architecture Patterns

- **Private constructor + static factory**: `OMEZarrNVImage` uses
  `private constructor()` with `static async create()` as the public API
- **Options object**: Constructors take a single options interface; use `??` for
  defaults: `this.maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS`
- **Composition over inheritance**: Stateful helpers (`BufferManager`,
  `RegionCoalescer`) are composed, not extended
- **Pure function modules**: Utility modules (`ClipPlanes.ts`,
  `ResolutionSelector.ts`, `affine.ts`) export stateless pure functions
- **Async**: Use `async/await` throughout; prefix fire-and-forget calls with
  `void`; use `AbortController` for cancellation; debounce user interactions
  with `setTimeout`/`clearTimeout`
- **Events**: Browser-native `EventTarget` via composition (not inheritance)
  with type-safe generic wrappers (`OMEZarrNVImageEvent<K>`)
