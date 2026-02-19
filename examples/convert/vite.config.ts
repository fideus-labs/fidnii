import { createLogger, defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
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
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Fidnii Image Converter",
        short_name: "Fidnii Convert",
        description:
          "Convert medical and scientific images to OME-Zarr and other formats. Supports NIfTI, DICOM, OME-TIFF, and more.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        icons: [
          {
            src: "/favicon/android-chrome-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/favicon/android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/favicon/android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell (JS, CSS, HTML, images). WASM pipeline
        // files and sample data are excluded and cached at runtime instead.
        globPatterns: ["**/*.{js,css,html,png,webp,ico}"],
        globIgnores: ["**/mri.nii.gz", "**/pipelines/**"],
        maximumFileSizeToCacheInBytes: 5_000_000,
        runtimeCaching: [
          {
            // Cache ITK-Wasm pipeline files (JS + WASM) on first use
            urlPattern: /\/pipelines\/.+\.(js|wasm|wasm\.zst)$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "wasm-pipelines",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            // Cache the Web Awesome CDN stylesheet for offline use
            urlPattern:
              /^https:\/\/cdn\.jsdelivr\.net\/npm\/@awesome\.me\/webawesome\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "webawesome-cdn",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
})
