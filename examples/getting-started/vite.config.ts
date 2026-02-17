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
  server: {
    port: 5174,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: ["@fideus-labs/ngff-zarr", "@fideus-labs/fizarrita"],
  },
})
