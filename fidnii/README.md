# @fideus-labs/fidnii

Render OME-Zarr images in NiiVue with progressive multi-resolution loading.

## Features

- **Progressive loading** - Quick preview from lowest resolution, then target
  resolution
- **Automatic resolution selection** - Picks optimal resolution based on pixel
  budget
- **Clip planes** - Up to 6 arbitrary clip planes for cropping/visualization
- **Dynamic buffer sizing** - Matches fetched data exactly (no upsampling)
- **Chunk caching** - LRU decoded-chunk cache avoids redundant decompression
- **Request coalescing** - Efficient chunk fetching
- **Event system** - Browser-native EventTarget API for loading states

## Installation

```bash
npm install @fideus-labs/fidnii @fideus-labs/ngff-zarr @niivue/niivue
```

## Quick Start

```typescript
import { Niivue } from "@niivue/niivue";
import { fromNgffZarr } from "@fideus-labs/ngff-zarr";
import { OMEZarrNVImage } from "@fideus-labs/fidnii";

const nv = new Niivue();
await nv.attachToCanvas(document.getElementById("canvas"));
nv.setSliceType(nv.sliceTypeRender);

const multiscales = await fromNgffZarr("/path/to/data.ome.zarr");

// Image is automatically added to NiiVue and loads progressively
await OMEZarrNVImage.create({ multiscales, niivue: nv });
```

## Options

| Option                | Type          | Default      | Description                                     |
| --------------------- | ------------- | ------------ | ----------------------------------------------- |
| `multiscales`         | `Multiscales` | required     | OME-Zarr multiscales data from `fromNgffZarr()` |
| `niivue`              | `Niivue`      | required     | NiiVue instance                                 |
| `maxPixels`           | `number`      | `50_000_000` | Maximum pixels to load (controls resolution)    |
| `autoLoad`            | `boolean`     | `true`       | Auto-add to NiiVue and start loading            |
| `clipPlaneDebounceMs` | `number`      | `300`        | Debounce delay for clip plane updates           |
| `maxCacheEntries`     | `number`      | `200`        | Max decoded-chunk cache entries (0 to disable)  |
| `cache`               | `ChunkCache`  | —            | Pre-built cache (overrides `maxCacheEntries`)   |

## Events

Listen to loading events using the browser-native EventTarget API:

```typescript
const image = await OMEZarrNVImage.create({ multiscales, niivue: nv });

image.addEventListener("loadingStart", (e) => {
  console.log(`Loading level ${e.detail.levelIndex}...`);
});

image.addEventListener("populateComplete", (e) => {
  console.log(`Loaded level ${e.detail.currentLevel}`);
});
```

### Available Events

| Event              | Description                                         |
| ------------------ | --------------------------------------------------- |
| `loadingStart`     | Fired when loading starts for a resolution level    |
| `loadingComplete`  | Fired when loading completes for a resolution level |
| `resolutionChange` | Fired when resolution level changes                 |
| `populateComplete` | Fired when all loading is done                      |
| `clipPlanesChange` | Fired when clip planes are updated (after debounce) |

## Advanced Usage

For manual control over when loading starts, use `autoLoad: false`:

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

## Clip Planes

Clip planes define visible regions of the volume. Up to 6 clip planes can be
active.

```typescript
import { createAxisAlignedClipPlane } from "@fideus-labs/fidnii";

const image = await OMEZarrNVImage.create({ multiscales, niivue: nv });

// Wait for initial load
image.addEventListener("populateComplete", () => {
  const bounds = image.getVolumeBounds();

  // Clip at X = midpoint, keeping +X side visible
  const midX = (bounds.min[0] + bounds.max[0]) / 2;
  const clipPlane = createAxisAlignedClipPlane("x", midX, "positive", bounds);

  image.setClipPlanes([clipPlane]);
}, { once: true });
```

## Chunk Caching

Fidnii ships with an LRU decoded-chunk cache that avoids redundant
decompression when the same Zarr chunk is read more than once. This happens
frequently with overlapping clip-plane selections, repeated `populateVolume`
calls, and progressive loading where 2D slabs and 3D volumes share chunks.

Caching is **enabled by default** with a 200-entry limit. No extra code is
needed:

```typescript
// Default: 200-entry LRU cache created automatically
const image = await OMEZarrNVImage.create({ multiscales, niivue: nv });
```

### Custom cache size

```typescript
const image = await OMEZarrNVImage.create({
  multiscales,
  niivue: nv,
  maxCacheEntries: 500,
});
```

### Disabling caching

```typescript
const image = await OMEZarrNVImage.create({
  multiscales,
  niivue: nv,
  maxCacheEntries: 0,
});
```

### Bring-your-own cache

Any object that satisfies the `ChunkCache` interface (`get` / `set` with
`string` keys and `ArrayBuffer` values) can be passed directly:

```typescript
import type { ChunkCache } from "@fideus-labs/fidnii";

const myCache: ChunkCache = {
  get(key: string) { /* ... */ },
  set(key: string, value: ArrayBuffer) { /* ... */ },
};

const image = await OMEZarrNVImage.create({
  multiscales,
  niivue: nv,
  cache: myCache,
});
```

When `cache` is provided it takes precedence over `maxCacheEntries`.

## License

MIT
