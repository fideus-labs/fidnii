# AGENTS.md

Guidance for AI coding agents operating in this repository.

## Project Overview

Fidnii (`@fideus-labs/fidnii`) is a TypeScript library for rendering OME-Zarr
(NGFF) medical/scientific images inside NiiVue with progressive multi-resolution
loading. It is a **pnpm monorepo** with three workspace packages: `fidnii/`
(the library), `examples/getting-started/`, and `examples/convert/`.

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

TypeScript strict mode is enforced. Run from `fidnii/`:

```bash
pnpm exec tsc --noEmit    # Type-check without emitting
```

`tsconfig.json` enables `strict`, `noUnusedLocals`, `noUnusedParameters`, and
`noFallthroughCasesInSwitch`.

## Test Commands

All tests are **Playwright** end-to-end browser tests (Chromium only, WebGL via
EGL). Tests have a 120-second timeout because they load real data from S3.

```bash
pnpm test                                              # All tests (monorepo)
pnpm exec playwright test                              # All tests (current pkg)
pnpm exec playwright test tests/basic-loading.spec.ts  # Single test file
pnpm exec playwright test -g "page loads"              # Single test by grep
pnpm exec playwright test tests/clip-planes.spec.ts -g "add a clip plane"
```

Test files live in `fidnii/tests/` and `examples/getting-started/tests/` using
`*.spec.ts`. Tests run against a Vite-served test page at `fidnii/test-page/`;
the dev server starts automatically.

Useful flags: `--headed` (visible browser), `--debug` (step-through),
`--workers=1` (serial execution), `--reporter=list`.

## Git Hooks & Commit Messages

Lefthook runs a pre-commit hook that auto-fixes staged files with `biome check`.
Commit messages are validated by **commitlint** using Conventional Commits
(`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, etc.).

## Code Style

### Formatting (Biome)

- **Indentation**: 2 spaces, no tabs
- **Semicolons**: `asNeeded` — do not add unnecessary semicolons
- **Quotes**: Double quotes
- **Line width**: 80 columns
- **Trailing commas**: All (in multi-line constructs)

### Imports

Separate `import type` from value imports, even from the same module:

```typescript
import { NVImage, SLICE_TYPE } from "@niivue/niivue"
import type { Niivue } from "@niivue/niivue"
```

Group imports: (1) external packages, (2) blank line, (3) internal relative.
Relative imports must use explicit `.js` extensions (ESM requirement):

```typescript
import { selectResolution } from "./ResolutionSelector.js"
import type { ClipPlane } from "./types.js"
```

### Exports

**Named exports only** — no default exports. The barrel file `index.ts`
re-exports all public API. Use `export type` for type-only re-exports:

```typescript
export { OMEZarrNVImage } from "./OMEZarrNVImage.js"
export type { ClipPlane, VolumeBounds } from "./types.js"
```

### TypeScript Conventions

- **Interfaces** for object shapes/contracts; **type aliases** for unions
- **`as const` objects** instead of TypeScript enums
- **`readonly`** on immutable class fields
- **Defensive copies** — spread arrays on input/output: `[...arr] as [x, y, z]`
- Generic parameters: single uppercase letters (`K`, `T`)
- Numeric separators for large numbers: `50_000_000`

### Naming Conventions

| Kind                  | Style           | Example                   |
|-----------------------|-----------------|---------------------------|
| Variables, parameters | camelCase       | `levelIndex`, `maxPixels` |
| Functions             | camelCase       | `selectResolution`        |
| Classes               | PascalCase      | `OMEZarrNVImage`          |
| Interfaces, types     | PascalCase      | `ClipPlane`, `ZarrDtype`  |
| Module-level consts   | SCREAMING_SNAKE | `MAX_CLIP_PLANES`         |
| Private members       | `_camelCase`    | `_clipPlanes`             |
| Unused parameters     | `_camelCase`    | `_nv`, `_trigger`         |

**File names**: PascalCase for class files (`BufferManager.ts`), camelCase for
utility/type modules (`types.ts`, `affine.ts`).

### Error Handling

- Throw `new Error(message)` with descriptive template-literal messages
- Validate inputs at public API boundaries; private methods trust callers
- Bare `catch` for non-critical failures (e.g., cleanup during teardown)
- `console.warn("[fidnii] ...")` for soft warnings
- `console.error(...)` for event-listener failures
- Coerce unknowns: `error instanceof Error ? error : new Error(String(error))`

### Documentation

Every source file starts with SPDX license headers:

```typescript
// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT
```

All exported APIs must have JSDoc with `@param`, `@returns`, `@throws` as
applicable. Use `@example` on major public APIs. Use `//` for inline comments.

### Architecture Patterns

- **Private constructor + static factory**: `OMEZarrNVImage` uses
  `private constructor()` with `static async create()` as the public API
- **Options object**: Constructors take a single options interface; use `??` for
  defaults: `options.maxPixels ?? DEFAULT_MAX_PIXELS`
- **Composition over inheritance**: Stateful helpers (`BufferManager`,
  `RegionCoalescer`) are composed, not extended
- **Pure function modules**: `ClipPlanes.ts`, `ResolutionSelector.ts`,
  `affine.ts` export stateless pure functions
- **Async**: `async/await` throughout; `void` prefix for fire-and-forget;
  `AbortController` for cancellation; `setTimeout`/`clearTimeout` for debounce
- **Events**: Browser-native `EventTarget` via composition with type-safe
  generic wrappers (`OMEZarrNVImageEvent<K>`)
