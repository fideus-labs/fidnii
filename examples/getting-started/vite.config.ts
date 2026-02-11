import { defineConfig } from "vite"

export default defineConfig({
  server: {
    port: 5174,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: ["@fideus-labs/ngff-zarr", "@fideus-labs/fizarrita"],
  },
})
