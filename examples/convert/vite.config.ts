import { defineConfig } from "vite";

export default defineConfig({
  ssr: {
    noExternal: ["@awesome.me/webawesome"],
  },
  optimizeDeps: {
    exclude: [
      "@awesome.me/webawesome",
      "itk-wasm",
      "@itk-wasm/compress-stringify",
      "@itk-wasm/image-io",
      "@thewtex/zstddec",
    ],
  },
});
