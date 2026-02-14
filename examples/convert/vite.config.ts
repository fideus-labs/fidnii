import { createLogger, defineConfig } from "vite"

const logger = createLogger()
const originalWarnOnce = logger.warnOnce.bind(logger)
logger.warnOnce = (msg, options) => {
  if (msg.includes("points to missing source files")) return
  originalWarnOnce(msg, options)
}

export default defineConfig({
  customLogger: logger,
  worker: {
    format: "es",
  },
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
      "@fideus-labs/ngff-zarr",
      "itk-wasm",
      "@itk-wasm/compress-stringify",
      "@itk-wasm/image-io",
      "@thewtex/zstddec",
    ],
  },
})
