import { defineConfig } from "vite"

export default defineConfig({
  ssr: {
    noExternal: ["@awesome.me/webawesome"],
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: [
      "@awesome.me/webawesome",
      "@fideus-labs/fizarrita",
      "@fideus-labs/ngff-zarr",
      "itk-wasm",
      "@itk-wasm/compress-stringify",
      "@itk-wasm/image-io",
      "@thewtex/zstddec",
    ],
  },
})
