# fidnii Getting Started

A minimal example showing how to load and display an OME-Zarr image using
[fidnii](https://github.com/fideus-labs/fidnii).

## Quick Start

```bash
# From the repository root
pnpm install
pnpm --filter @fideus-labs/fidnii-getting-started dev
```

Open http://localhost:5173 in your browser.

## What This Example Does

Loads an MRI scan from a remote OME-Zarr dataset and renders it in 3D. The image
loads progressively - you'll see a low-resolution preview first, then the full
resolution.

**Dataset**: [mri_woman.ome.zarr](https://doi.org/10.5281/zenodo.17495293)

## Code

See `main.ts`. Essentially:

```ts
// Initialize NiiVue
const nv = new Niivue({ backColor: [0, 0, 0, 1] });
await nv.attachToCanvas(canvas);
// Add NiiVue configuration as usual
nv.setSliceType(nv.sliceTypeRender);

// Lazily load OME-Zarr data
const multiscales = await fromNgffZarr(DATA_URL);

// Create image - automatically added to NiiVue and loads progressively
await OMEZarrNVImage.create({ multiscales, niivue: nv });
```

For more details, see the
[fidnii README](https://github.com/fideus-labs/fidnii/blob/main/fidnii/README.md).
