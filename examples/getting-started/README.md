# fidnii Getting Started

A minimal example showing how to load and display an OME-Zarr image using fidnii.

## What This Example Does

This example loads an MRI scan of a human head from a remote OME-Zarr dataset and renders it in 3D using NiiVue. The fidnii library handles progressive multi-resolution loading automatically - you'll see a low-resolution preview first, then the full resolution.

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

Open http://localhost:5173 in your browser.

## Build for Production

```bash
# Build static files
pnpm build

# Preview the build
pnpm preview
```

The `dist/` folder contains static files ready for deployment to any web server.

## Code Walkthrough

The entire example is ~15 lines of TypeScript in `main.ts`:

```typescript
import { Niivue } from "@niivue/niivue";
import { fromNgffZarr } from "@fideus-labs/ngff-zarr";
import { OMEZarrNVImage } from "@fideus-labs/fidnii";

async function main() {
  const canvas = document.getElementById("gl") as HTMLCanvasElement;

  // Initialize NiiVue
  const nv = new Niivue({ backColor: [0, 0, 0, 1] });
  await nv.attachToCanvas(canvas);
  nv.setSliceType(nv.sliceTypeRender);

  // Load OME-Zarr data
  const multiscales = await fromNgffZarr(DATA_URL);

  // Create image - automatically added to NiiVue and loads progressively
  await OMEZarrNVImage.create({ multiscales, niivue: nv });
}

main();
```

### Key Steps

1. **Initialize NiiVue** - Create a NiiVue instance and attach it to a canvas element
2. **Load OME-Zarr** - Use `fromNgffZarr()` to load the multiscale image metadata
3. **Create OMEZarrNVImage** - The image is automatically added to NiiVue and starts loading progressively

That's it! The `create()` method handles adding the image to NiiVue and starts progressive loading automatically.

## Advanced Usage

For more control over when loading starts, use `autoLoad: false`:

```typescript
const image = await OMEZarrNVImage.create({
  multiscales,
  niivue: nv,
  autoLoad: false,
});

// Set up event listeners before loading starts
image.addEventListener("populateComplete", () => {
  console.log("Loading complete!");
});

// Manually add to NiiVue and start loading
nv.addVolume(image);
await image.populateVolume();
```

## Next Steps

- Adjust `maxPixels` option to control resolution/memory tradeoff
- Add clip planes for cropping the volume
- Listen to loading events for progress feedback

See the [fidnii documentation](https://github.com/fideus-labs/fidnii) for more details.
