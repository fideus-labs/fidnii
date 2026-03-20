<!-- SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC -->
<!-- SPDX-License-Identifier: MIT -->
# 🤝 Contributing to fidnii

Welcome! 👋 We're glad you're interested in contributing to fidnii. Whether
you're fixing bugs, adding features, improving documentation, or helping with
testing, your contributions are greatly appreciated. 🎉

## 📜 Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md). We are
committed to providing a welcoming and inclusive environment for everyone.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Bun](https://bun.sh/) >= 1.2

### ⚙️ Setup

1. Fork and clone the repository
2. Install dependencies (this also installs git hooks via Lefthook):
   ```bash
    bun install
   ```

## 🔄 Contributing Workflow

We use the standard GitHub pull request workflow:

1. 💬 **Open an Issue First** - For significant changes, open a GitHub Issue to
   discuss your proposal before starting work
2. 🍴 **Fork the Repository** - Create your own fork
3. 🌿 **Create a Branch** - Create a feature branch from `main`
4. ✏️ **Make Changes** - Implement your changes with tests
5. 💾 **Commit** - Use Conventional Commit messages
6. 📤 **Push** - Push to your fork
7. 📬 **Open a Pull Request** - Submit a PR against `main`

### 📋 Pull Request Guidelines

- ✅ **CI must pass** - All checks must be green before merge
- 📦 **Include a changeset** - If your PR includes a user-facing change to
  `@fideus-labs/fidnii`, add a changeset (see [Changesets](#-changesets) below)
- 💬 **Be responsive** - Please respond to review comments in a timely manner
- ⏳ **Be patient** - Reviews may take time; we appreciate your patience
- 🤖 **Copilot reviews** - GitHub Copilot may flag false positives; if you
  believe a suggestion is incorrect, leave a comment explaining why and
  resolve as appropriate

## 📝 Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/)
standard. All commit messages are validated by
[commitlint](https://commitlint.js.org/) via a `commit-msg` git hook.

### 📐 Format

```
<type>: <description>

[optional body]

[optional footer]
```

### 🏷️ Types

- ✨ `feat` - New feature
- 🐛 `fix` - Bug fix
- 📖 `docs` - Documentation changes
- 🎨 `style` - Code style changes (formatting, etc.)
- ♻️ `refactor` - Code refactoring
- ⚡ `perf` - Performance improvements
- 🧪 `test` - Adding or updating tests
- 🏗️ `build` - Build system changes
- 🔧 `ci` - CI/CD changes
- 🧹 `chore` - Maintenance tasks

### 💡 Examples

```bash
feat: add viewport-aware resolution selection
fix: correct affine transform for non-square voxels
docs: update clip planes API reference
chore: update dependencies
```

### 🛡️ Pre-commit Validation

[Lefthook](https://github.com/evilmartians/lefthook) manages git hooks
(installed automatically via `bun install`):

- **pre-commit** - Runs `biome check --write` on staged files and re-stages
  fixes
- **commit-msg** - Validates the commit message with commitlint

If a commit message doesn't follow the Conventional Commits format, the commit
will be rejected with helpful error messages.

## 📦 Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for
release management. When your PR includes a user-facing change to
`@fideus-labs/fidnii`, add a changeset:

```bash
bunx changeset
```

Follow the prompts to select the package and describe the change. A markdown
file is created in `.changeset/` and committed with your PR. When changesets
are merged to `main`, a "Version Packages" PR is automatically opened with
the accumulated changelog and version bump.

## 🗂️ Project Overview

fidnii is a TypeScript library for rendering OME-Zarr images in NiiVue with
progressive multi-resolution loading. It is a bun monorepo:

```
fidnii/                    # @fideus-labs/fidnii library
  src/                     # TypeScript source
  dist/                    # Build output (ESM)
  tests/                   # Playwright e2e tests
  test-page/               # Vite-served page for tests
examples/
  getting-started/         # Minimal usage example
  convert/                 # Browser-based format converter
docs/
  assets/                  # Logos, demo GIFs
```

## 🛠️ Development Commands

| Command                               | Description                          |
| ------------------------------------- | ------------------------------------ |
| `bun run build`                          | Build all packages                   |
| `bun run dev`                            | Start dev servers for all packages   |
| `bun run test`                           | Run all Playwright tests             |
| `bun run check`                          | Lint, format, and organize imports   |
| `bun run lint`                           | Lint only (Biome)                    |
| `bun run format`                         | Auto-format all files (Biome)        |
| `bunx tsc --noEmit`                      | Type-check the library (from `fidnii/`) |
| `bunx playwright test`                   | Run tests in current package         |
| `bunx playwright test -g "name"`         | Run a single test by name            |
| `bunx changeset`                         | Add a changeset for release tracking |

The dev server runs on port 5173 with COOP/COEP headers for SharedArrayBuffer
support.

## 🎨 Code Style

Code is linted and formatted with [Biome](https://biomejs.dev/). TypeScript
strict mode is enforced in CI alongside Biome.

```bash
bun run check                 # Biome lint + format + imports (same as CI)
bunx tsc --noEmit             # Type-check (from fidnii/)
```

### Formatting (Biome)

- 📏 **Indentation**: 2 spaces, no tabs
- 🚫 **Semicolons**: None
- 💬 **Quotes**: Double quotes
- 📐 **Line width**: 80 columns
- ➕ **Trailing commas**: Yes, in multi-line constructs

### 📦 Imports

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

### 📤 Exports

Use **named exports only** — no default exports anywhere. The barrel file
`index.ts` re-exports from all modules. Use `export type` for type-only
re-exports:

```typescript
export { OMEZarrNVImage } from "./OMEZarrNVImage.js"
export type { ClipPlane, VolumeBounds } from "./types.js"
```

### 🏷️ Naming Conventions

| Kind                  | Style              | Example                    |
|-----------------------|--------------------|----------------------------|
| Variables, parameters | camelCase          | `levelIndex`, `maxPixels`  |
| Functions             | camelCase          | `selectResolution`         |
| Classes               | PascalCase         | `OMEZarrNVImage`           |
| Interfaces, types     | PascalCase         | `ClipPlane`, `ZarrDtype`   |
| Module-level constants| SCREAMING_SNAKE    | `MAX_CLIP_PLANES`          |
| Private members       | `_camelCase`       | `_clipPlanes`, `_emitEvent`|

**File names**: PascalCase for files exporting a primary class
(`BufferManager.ts`), camelCase for utility/type modules (`types.ts`,
`affine.ts`).

### 📖 Documentation

Every source file starts with SPDX license headers:

```typescript
// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT
```

All exported functions, classes, and interfaces must have JSDoc with `@param`,
`@returns`, and `@throws` tags as applicable.

## 🧪 Testing

All tests are Playwright end-to-end browser tests (Chromium only, WebGL via
EGL). Tests have a 120-second timeout because they load real data from S3.

```bash
bun run test                                     # All tests
bunx playwright test                             # Tests in current package
bunx playwright test tests/basic-loading.spec.ts # Single test file
bunx playwright test -g "page loads"             # Single test by name
```

Useful flags: `--headed` (visible browser), `--debug` (step-through),
`--workers=1` (serial execution).

Run tests before submitting PRs to ensure nothing is broken. ✅

## ❓ Questions?

If you have questions, please open a
[GitHub Issue](https://github.com/fideus-labs/fidnii/issues).

Thank you for contributing! 💖
