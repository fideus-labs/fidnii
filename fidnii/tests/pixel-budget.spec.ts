// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { expect, test } from "@playwright/test"

test.describe("Pixel Budget", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    // Wait for ready (generous timeout for S3 loading)
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })
  })

  test("default maxPixels is 50 million", async ({ page }) => {
    const maxPixels = await page.evaluate(() => {
      const image = (window as any).image
      return image.maxPixels
    })

    expect(maxPixels).toBe(50_000_000)
  })

  test("maxPixels slider changes displayed value", async ({ page }) => {
    const slider = page.locator("#maxpixels")
    const valueEl = page.locator("#maxpixels-value")

    // Initial value
    await expect(valueEl).toHaveText("50")

    // Change slider
    await slider.fill("25")
    await slider.dispatchEvent("input")

    await expect(valueEl).toHaveText("25")
  })

  test("reload with lower pixel budget may select lower resolution", async ({
    page,
  }) => {
    // Get initial level with default 4M
    const initialLevel = await page.evaluate(() => {
      const image = (window as any).image
      return image.getTargetLevelIndex()
    })

    // Set very low pixel budget (1M) using JavaScript
    await page.evaluate(() => {
      const slider = document.getElementById("maxpixels") as HTMLInputElement
      slider.value = "1"
      slider.dispatchEvent(new Event("input", { bubbles: true }))
    })

    // Reload
    await page.locator("#reload").click()

    // Wait for reload to complete (with longer timeout for reload)
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })

    // Get new level
    const newLevel = await page.evaluate(() => {
      const image = (window as any).image
      return image.getTargetLevelIndex()
    })

    // Lower pixel budget should select higher level index (lower resolution)
    expect(newLevel).toBeGreaterThanOrEqual(initialLevel)
  })

  test("reload with higher pixel budget may select higher resolution", async ({
    page,
  }) => {
    // Increase test timeout for large data reload from S3
    test.setTimeout(300000)

    // First reload with low budget
    await page.evaluate(() => {
      const slider = document.getElementById("maxpixels") as HTMLInputElement
      slider.value = "1"
      slider.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await page.locator("#reload").click()
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })

    const lowBudgetLevel = await page.evaluate(() => {
      const image = (window as any).image
      return image.getTargetLevelIndex()
    })

    // Now reload with high budget
    await page.evaluate(() => {
      const slider = document.getElementById("maxpixels") as HTMLInputElement
      slider.value = "100"
      slider.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await page.locator("#reload").click()
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 180000,
    })

    const highBudgetLevel = await page.evaluate(() => {
      const image = (window as any).image
      return image.getTargetLevelIndex()
    })

    // Higher pixel budget should select lower or equal level index (higher resolution)
    expect(highBudgetLevel).toBeLessThanOrEqual(lowBudgetLevel)
  })

  test("buffer dimensions respect pixel budget", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const img = image.img
      const maxPixels = image.maxPixels

      return {
        bufferLength: img.length,
        maxPixels,
      }
    })

    // Buffer should not exceed max pixels (with some tolerance for chunk alignment)
    // Allow 2x for chunk alignment overhead
    expect(result.bufferLength).toBeLessThan(result.maxPixels * 2)
  })

  test("very small pixel budget still works", async ({ page }) => {
    // Set very small budget (1M pixels)
    await page.evaluate(() => {
      const slider = document.getElementById("maxpixels") as HTMLInputElement
      slider.value = "1"
      slider.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await page.locator("#reload").click()

    // Should still complete successfully (longer timeout for reload)
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })

    // Should have loaded something
    const hasData = await page.evaluate(() => {
      const image = (window as any).image
      return image.img && image.img.length > 0
    })

    expect(hasData).toBe(true)
  })

  test("very large pixel budget selects higher resolution", async ({
    page,
  }) => {
    // Increase test timeout for large data from S3
    test.setTimeout(300000)

    // Set large budget (100M pixels — enough for beechnut level 2: 386×256×256 = ~25.3M)
    await page.evaluate(() => {
      const slider = document.getElementById("maxpixels") as HTMLInputElement
      slider.value = "100"
      slider.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await page.locator("#reload").click()

    // Should still complete successfully (longer timeout for large S3 data)
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 180000,
    })

    // With 100M budget, should target level 2 (25.3M pixels fits, level 1 at 202M doesn't)
    const level = await page.evaluate(() => {
      const image = (window as any).image
      return image.getTargetLevelIndex()
    })

    expect(level).toBe(2)
  })

  test("pixel budget is stored on image", async ({ page }) => {
    // Reload with different budget
    await page.evaluate(() => {
      const slider = document.getElementById("maxpixels") as HTMLInputElement
      slider.value = "30"
      slider.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await page.locator("#reload").click()
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })

    const maxPixels = await page.evaluate(() => {
      const image = (window as any).image
      return image.maxPixels
    })

    expect(maxPixels).toBe(30_000_000)
  })

  test("clip planes affect resolution selection with pixel budget", async ({
    page,
  }) => {
    // Get level for full volume
    const fullVolumeLevel = await page.evaluate(() => {
      const image = (window as any).image
      return image.getTargetLevelIndex()
    })

    // Clip to small region using 6 axis-aligned planes
    await page.evaluate(async () => {
      const image = (window as any).image
      const bounds = image.getVolumeBounds()

      // Clip to ~10% of volume (center region)
      const rangeX = bounds.max[0] - bounds.min[0]
      const rangeY = bounds.max[1] - bounds.min[1]
      const rangeZ = bounds.max[2] - bounds.min[2]

      const centerX = (bounds.min[0] + bounds.max[0]) / 2
      const centerY = (bounds.min[1] + bounds.max[1]) / 2
      const centerZ = (bounds.min[2] + bounds.max[2]) / 2

      // 6 planes forming a box at 45%-55% of each axis
      image.setClipPlanes([
        {
          point: [bounds.min[0] + rangeX * 0.45, centerY, centerZ],
          normal: [1, 0, 0],
        }, // X min
        {
          point: [bounds.min[0] + rangeX * 0.55, centerY, centerZ],
          normal: [-1, 0, 0],
        }, // X max
        {
          point: [centerX, bounds.min[1] + rangeY * 0.45, centerZ],
          normal: [0, 1, 0],
        }, // Y min
        {
          point: [centerX, bounds.min[1] + rangeY * 0.55, centerZ],
          normal: [0, -1, 0],
        }, // Y max
        {
          point: [centerX, centerY, bounds.min[2] + rangeZ * 0.45],
          normal: [0, 0, 1],
        }, // Z min
        {
          point: [centerX, centerY, bounds.min[2] + rangeZ * 0.55],
          normal: [0, 0, -1],
        }, // Z max
      ])

      await image.waitForIdle()
    })

    // Get level for cropped region
    const croppedLevel = await page.evaluate(() => {
      const image = (window as any).image
      return image.getTargetLevelIndex()
    })

    // Small cropped region should allow same or higher resolution
    expect(croppedLevel).toBeLessThanOrEqual(fullVolumeLevel)
  })
})
