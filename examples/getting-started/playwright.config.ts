import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 8,
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
