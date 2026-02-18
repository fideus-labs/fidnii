import { createLogger, defineConfig } from "vite"
import { viteStaticCopy } from "vite-plugin-static-copy"

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
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    include: ["@fideus-labs/worker-pool"],
    exclude: [
      "@awesome.me/webawesome",
      "@fideus-labs/fiff",
      "@fideus-labs/ngff-zarr",
      "itk-wasm",
      "@itk-wasm/image-io",
      "@itk-wasm/downsample",
      "@thewtex/zstddec",
    ],
  },
  plugins: [
    // put lazy loaded JavaScript and Wasm bundles in dist directory
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@itk-wasm/image-io/dist/pipelines/*.{js,wasm,wasm.zst}",
          dest: "pipelines/",
        },
        {
          src: "node_modules/@itk-wasm/downsample/dist/pipelines/*.{js,wasm,wasm.zst}",
          dest: "pipelines/",
        },
      ],
    }),
  ],
})
