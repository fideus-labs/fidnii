// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, "test-page"),
  publicDir: resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@fideus-labs/fidnii": resolve(__dirname, "src/index.ts"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Disable history API fallback for ome.zarr paths
    // to avoid returning index.html for zarr metadata requests
    middlewareMode: false,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  appType: "mpa", // Multi-page app mode to avoid SPA fallback
  build: {
    outDir: resolve(__dirname, "dist-test-page"),
    emptyOutDir: true,
  },
  optimizeDeps: {
    // Force Vite to pre-bundle these dependencies
    include: [
      "@niivue/niivue",
      "gl-matrix",
      "zarrita",
      "zod",
      "@itk-wasm/downsample",
      "@fideus-labs/worker-pool",
    ],
    // Exclude fizarrita (and ngff-zarr which transitively imports it) from
    // pre-bundling so fizarrita's Web Worker (codec-worker.js) loads correctly
    // via new URL(..., import.meta.url). If ngff-zarr is pre-bundled, Vite
    // inlines fizarrita's code and the relative worker URL resolves to the
    // wrong location (.vite/deps/ instead of fizarrita's dist/).
    exclude: [
      "@fideus-labs/fizarrita",
      "@fideus-labs/ngff-zarr",
      "@fideus-labs/ngff-zarr/browser",
    ],
  },
});
