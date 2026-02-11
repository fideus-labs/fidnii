<p align="center">
  <img src="https://raw.githubusercontent.com/fideus-labs/fidnii/main/docs/assets/fidnii-logo.png" alt="fidnii" width="200" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fideus-labs/fidnii"><img src="https://img.shields.io/npm/v/@fideus-labs/fidnii" alt="npm version" /></a>
  <a href="https://github.com/fideus-labs/fidnii/blob/main/LICENSE.txt"><img src="https://img.shields.io/npm/l/@fideus-labs/fidnii" alt="license" /></a>
</p>

<p align="center">
  Render <a href="https://ngff.openmicroscopy.org/">OME-Zarr</a> images in <a href="https://github.com/niivue/niivue">NiiVue</a> with progressive multi-resolution loading.
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/fideus-labs/fidnii/main/docs/assets/beechnut.gif" alt="fidnii demo" width="600" />
</p>

## ✨ Features

- 🚀 **Progressive loading** -- Quick preview from lowest resolution, then
  automatic upgrade to the target level
- 🎯 **Automatic resolution selection** -- Picks the optimal pyramid level
  based on a configurable pixel budget
- 🔍 **Viewport-aware resolution** -- Fetches higher resolution only for the
  visible region when zoomed in
- 📐 **Slab-based 2D rendering** -- Independent per-slice-type buffers with
  their own resolution selection
- ✂️ **Clip planes** -- Up to 6 arbitrary clip planes for cropping and
  visualization
- 💾 **Chunk caching** -- LRU cache for decoded chunks, shared across 3D and
  2D loads
- 🔗 **Request coalescing** -- Deduplicates and parallelizes chunk fetches
- 📡 **Event system** -- Browser-native `EventTarget` API for loading states
  and resolution changes

## 📦 Installation

```bash
npm install @fideus-labs/fidnii @fideus-labs/ngff-zarr @niivue/niivue
```

`@niivue/niivue` is a peer dependency and must be installed alongside fidnii.

## ⚡ Quick Start

```typescript
import { Niivue } from "@niivue/niivue"
import { fromNgffZarr } from "@fideus-labs/ngff-zarr"
import { OMEZarrNVImage } from "@fideus-labs/fidnii"

const nv = new Niivue()
await nv.attachToCanvas(document.getElementById("canvas"))
nv.setSliceType(nv.sliceTypeRender)

const multiscales = await fromNgffZarr("/path/to/data.ome.zarr")

// Image is automatically added to NiiVue and loads progressively
await OMEZarrNVImage.create({ multiscales, niivue: nv })
```

## ⚙️ Options

`OMEZarrNVImage.create()` accepts a single options object:

| Option                | Type          | Default      | Description                                     |
| --------------------- | ------------- | ------------ | ----------------------------------------------- |
| `multiscales`         | `Multiscales` | required     | OME-Zarr multiscales data from `fromNgffZarr()` |
| `niivue`              | `Niivue`      | required     | NiiVue instance                                 |
| `maxPixels`           | `number`      | `50_000_000` | Maximum pixels to load (controls resolution)    |
| `autoLoad`            | `boolean`     | `true`       | Auto-add to NiiVue and start loading            |
| `clipPlaneDebounceMs` | `number`      | `300`        | Debounce delay for clip plane updates (ms)      |
| `viewportAware`       | `boolean`     | `true`       | Enable viewport-aware resolution selection      |
| `max3DZoom`           | `number`      | `10.0`       | Maximum 3D scroll zoom factor                   |
| `min3DZoom`           | `number`      | `0.3`        | Minimum 3D scroll zoom factor                   |
| `maxCacheEntries`     | `number`      | `200`        | LRU chunk cache size                            |

## 📡 Events

Listen to loading events using the browser-native `EventTarget` API:

```typescript
const image = await OMEZarrNVImage.create({ multiscales, niivue: nv })

image.addEventListener("loadingStart", (e) => {
  console.log(`Loading level ${e.detail.levelIndex}...`)
})

image.addEventListener("populateComplete", (e) => {
  console.log(`Done -- loaded level ${e.detail.currentLevel}`)
})
```

| Event                | Description                                       |
| -------------------- | ------------------------------------------------- |
| `loadingStart`       | Loading starts for a resolution level             |
| `loadingComplete`    | Loading completes for a resolution level          |
| `resolutionChange`   | Resolution level changes                          |
| `populateComplete`   | All loading is done                               |
| `clipPlanesChange`   | Clip planes updated (after debounce)              |
| `loadingSkipped`     | Loading was skipped (e.g. already at target)      |
| `slabLoadingStart`   | Slab loading starts for a 2D slice type           |
| `slabLoadingComplete`| Slab loading completes for a 2D slice type        |

## ✂️ Clip Planes

Clip planes define visible sub-regions of the volume. Up to 6 can be active at
once.

```typescript
import {
  createAxisAlignedClipPlane,
  OMEZarrNVImage,
} from "@fideus-labs/fidnii"

const image = await OMEZarrNVImage.create({ multiscales, niivue: nv })

image.addEventListener("populateComplete", () => {
  const bounds = image.getVolumeBounds()
  const midX = (bounds.min[0] + bounds.max[0]) / 2

  // Clip at X = midpoint, keeping the +X side visible
  const clip = createAxisAlignedClipPlane("x", midX, "positive", bounds)
  image.setClipPlanes([clip])
}, { once: true })
```

## 🧪 Examples

### [Getting Started](examples/getting-started/)

Minimal example that loads a remote MRI scan and renders it in 3D with
progressive loading.

```bash
pnpm --filter @fideus-labs/fidnii-getting-started dev
```

### [Convert to OME-Zarr](examples/convert/)

Browser-based converter from NIFTI, NRRD, DICOM, MRC, TIFF, VTK, and more to
OME-Zarr 0.5 (OZX) with live preview.

```bash
pnpm --filter @fideus-labs/fidnii-example-convert dev
```

## 🛠️ Development

### 📋 Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) 10.29.2 (`corepack enable` to use the bundled
  version)

### 🔧 Setup

```bash
git clone https://github.com/fideus-labs/fidnii.git
cd fidnii
pnpm install
```

### 🏗️ Monorepo Structure

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

### 📝 Commands

| Command                               | Description                          |
| ------------------------------------- | ------------------------------------ |
| `pnpm build`                          | Build all packages                   |
| `pnpm dev`                            | Start dev servers for all packages   |
| `pnpm test`                           | Run all Playwright tests             |
| `pnpm check`                          | Lint, format, and organize imports   |
| `pnpm lint`                           | Lint only (Biome)                    |
| `pnpm format`                         | Auto-format all files (Biome)        |
| `pnpm exec tsc --noEmit`             | Type-check the library (from `fidnii/`) |
| `pnpm exec playwright test`          | Run tests in current package         |
| `pnpm exec playwright test -g "name"`| Run a single test by name            |
| `pnpm changeset`                      | Add a changeset for release tracking |

The dev server runs on port 5173 with COOP/COEP headers for SharedArrayBuffer
support. Tests run against Chromium with WebGL via EGL and have a 120-second
timeout (they load real data from S3).

## 🤝 Contributing

Contributions are welcome! Here's what you need to know:

### 🎨 Code Style

Code is linted and formatted with [Biome](https://biomejs.dev/).
The key rules:

- 2-space indentation, no tabs
- **No semicolons**
- Double quotes
- 80-column line width
- Trailing commas in multi-line constructs
- Imports auto-sorted (external packages first, then relative)

```bash
pnpm check          # Lint + format check (same as CI)
pnpm format         # Auto-format all files
```

### 📏 Conventions

- **Named exports only** -- no default exports
- **Separate `import type`** from value imports
- **Explicit `.js` extensions** in relative imports (required for ESM)
- Every source file starts with SPDX license headers
- All exported APIs must have JSDoc documentation

### ✅ Quality Gates

TypeScript strict mode and Biome are both enforced in CI.

```bash
pnpm check                    # Biome lint + format + imports
pnpm exec tsc --noEmit        # Type-check (from fidnii/)
```

### 📝 Conventional Commits

Commit messages must follow the
[Conventional Commits](https://www.conventionalcommits.org/) specification.
This is enforced by [commitlint](https://commitlint.js.org/) via a
`commit-msg` git hook.

```
feat: add viewport-aware resolution selection
fix: correct affine transform for non-square voxels
docs: update clip planes API reference
```

### 📦 Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for
release management. When your PR includes a user-facing change to
`@fideus-labs/fidnii`, add a changeset:

```bash
pnpm changeset
```

Follow the prompts to select the package and describe the change. A markdown
file is created in `.changeset/` and committed with your PR. When changesets
are merged to `main`, a "Version Packages" PR is automatically opened with
the accumulated changelog and version bump.

### 🪝 Git Hooks

[Lefthook](https://github.com/evilmartians/lefthook) manages git hooks
(installed automatically via `pnpm install`):

- **pre-commit** -- runs `biome check --write` on staged files and re-stages
  fixes
- **commit-msg** -- validates the commit message with commitlint

### 🧪 Testing

All tests are Playwright end-to-end browser tests:

```bash
pnpm test                 # All tests
pnpm exec playwright test # Tests in current package
```

Useful flags: `--headed` (visible browser), `--debug` (step-through),
`--workers=1` (serial execution).

### 💛 Code of Conduct

This project follows the
[Contributor Covenant](CODE_OF_CONDUCT.md) code of conduct.

## 📄 License

[MIT](LICENSE.txt) -- Copyright (c) Fideus Labs LLC
