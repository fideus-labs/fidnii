# fidnii Getting Started

A minimal example showing how to load and display an OME-Zarr image using fidnii.

## What This Example Does

This example loads an MRI scan of a human head from a remote OME-Zarr dataset and renders it in 3D using NiiVue. The fidnii library handles progressive multi-resolution loading automatically.

**Dataset**: [mri_woman.ome.zarr](https://ome-zarr-scivis.s3.us-east-1.amazonaws.com/v0.5/96x2/mri_woman.ome.zarr) - A 96x2 multiscale MRI volume.

## Prerequisites

- Node.js 18+
- pnpm

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

Open http://localhost:5173 in your browser. The MRI volume will load progressively - you'll see a low-resolution preview first, then the full resolution.

## Build for Production

```bash
# Build static files
pnpm build

# Preview the build
pnpm preview
```

The `dist/` folder contains static files ready for deployment to any web server.

## Code Walkthrough

The entire example is ~20 lines of TypeScript in `main.ts`:

```typescript
import { Niivue } from "@niivue/niivue";
import { fromNgffZarr } from "@fideus-labs/ngff-zarr";
import { OMEZarrNVImage } from "@fideus-labs/fidnii";

async function main() {
  // 1. Get the canvas element
  const canvas = document.getElementById("gl") as HTMLCanvasElement;

  // 2. Initialize NiiVue and attach to canvas
  const nv = new Niivue({ backColor: [0, 0, 0, 1] });
  await nv.attachToCanvas(canvas);
  nv.setSliceType(nv.sliceTypeRender);

  // 3. Load OME-Zarr multiscales data
  const multiscales = await fromNgffZarr(DATA_URL);

  // 4. Create OMEZarrNVImage and populate the volume
  const image = await OMEZarrNVImage.create({ multiscales, niivue: nv });
  await image.populateVolume();

  // 5. Add to NiiVue for rendering
  nv.addVolume(image);
}

main();
```

### Key Steps

1. **Initialize NiiVue** - Create a NiiVue instance and attach it to a canvas element
2. **Load OME-Zarr** - Use `fromNgffZarr()` to load the multiscale image metadata
3. **Create OMEZarrNVImage** - This bridges OME-Zarr data with NiiVue
4. **Populate Volume** - Fetches image data with progressive loading (low-res first, then high-res)
5. **Display** - Add the volume to NiiVue for rendering

## Next Steps

- Adjust `maxPixels` option to control resolution/memory tradeoff
- Add clip planes for cropping the volume
- Listen to loading events for progress feedback

See the [fidnii documentation](https://github.com/fideus-labs/fidnii) for more details.
