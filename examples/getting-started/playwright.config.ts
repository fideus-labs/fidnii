import os from "node:os"
import { defineConfig, devices } from "@playwright/test"

// Each Playwright worker launches a Chromium instance that fetches
// multi-resolution OME-Zarr data from S3. Too many concurrent browsers
// saturate outbound connections and cause timeout flakiness. Scale
// workers with available cores but cap to avoid S3 contention.
const localWorkers = Math.max(2, Math.min(6, Math.floor(os.cpus().length / 8)))

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : localWorkers,
  reporter: "html",
  timeout: 120000, // 120s per test (S3 loading can be slow)
  use: {
    baseURL: "http://localhost:5174",
    trace: "on-first-retry",
    // EGL is only available on Linux; macOS/Windows use native GPU
    launchOptions: {
      args: process.platform === "linux" ? ["--use-gl=egl"] : [],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
})
