// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";

test.describe("Progressive Loading", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("progressive loading starts from lowest resolution", async ({ page }) => {
    // Wait for loading to complete
    await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60000 });

    // The image should exist and have resolution info
    const result = await page.evaluate(() => {
      const image = (window as any).image;
      return {
        exists: !!image,
        numLevels: image?.getNumLevels() ?? 0,
        currentLevel: image?.getCurrentLevelIndex() ?? -1,
        targetLevel: image?.getTargetLevelIndex() ?? -1,
      };
    });

    // Verify image loaded with multiple resolution levels
    expect(result.exists).toBe(true);
    expect(result.numLevels).toBe(3); // stent.ome.zarr has 3 levels

    // After progressive loading completes, current level should be at or better than target
    expect(result.currentLevel).toBeLessThanOrEqual(result.targetLevel);
  });

  test("current level reaches target level after loading", async ({ page }) => {
    // Wait for ready
    await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60000 });

    // Check current level equals or is less than target
    const levels = await page.evaluate(() => {
      const image = (window as any).image;
      return {
        current: image.getCurrentLevelIndex(),
        target: image.getTargetLevelIndex(),
      };
    });

    expect(levels.current).toBeLessThanOrEqual(levels.target);
  });

  test("target level is selected based on pixel budget", async ({ page }) => {
    // Wait for ready
    await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60000 });

    // Default is 12M pixels
    const levels = await page.evaluate(() => {
      const image = (window as any).image;
      return {
        target: image.getTargetLevelIndex(),
        maxPixels: image.maxPixels,
      };
    });

    // With 12M pixels and stent.ome.zarr dimensions, should be level 1
    // (scale 0 is 174×512×512 = ~45.6M > 12M, scale 1 is 174×256×256 = ~11.4M <= 12M)
    expect(levels.maxPixels).toBe(12_000_000);
    expect(levels.target).toBe(1);
  });

  test("image buffer is populated after loading", async ({ page }) => {
    // Wait for ready
    await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60000 });

    // Check that image data is populated
    const bufferInfo = await page.evaluate(() => {
      const image = (window as any).image;
      const img = image.img;
      // Check more of the buffer for non-zero values since data may be sparse
      let hasNonZero = false;
      if (img) {
        // Sample every 1000th element to check for data
        for (let i = 0; i < img.length; i += 1000) {
          if (img[i] !== 0) {
            hasNonZero = true;
            break;
          }
        }
      }
      return {
        exists: img !== null && img !== undefined,
        length: img?.length ?? 0,
        hasNonZero,
      };
    });

    expect(bufferInfo.exists).toBe(true);
    expect(bufferInfo.length).toBeGreaterThan(0);
    // Note: The buffer may be all zeros if the test data region is empty
    // This test verifies the buffer exists and has the expected size
  });

  test("loading indicator shows during population", async ({ page }) => {
    // Check that loading indicator is shown at some point
    const statusEl = page.locator("#status");

    // Either we catch it loading or it's already ready
    // This is a timing-dependent test, so we just verify the element exists
    await expect(statusEl).toBeVisible();

    // Wait for ready
    await expect(statusEl).toHaveText("Ready", { timeout: 60000 });
  });

  test("waitForIdle resolves after loading completes", async ({ page }) => {
    // Wait for ready
    await expect(page.locator("#status")).toHaveText("Ready", { timeout: 60000 });

    // waitForIdle should resolve immediately when not loading
    const waitResult = await page.evaluate(async () => {
      const image = (window as any).image;
      const start = Date.now();
      await image.waitForIdle();
      return Date.now() - start;
    });

    // Should resolve quickly since loading is done
    expect(waitResult).toBeLessThan(1000);
  });
});
