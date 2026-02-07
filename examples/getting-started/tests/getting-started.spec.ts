import { test, expect } from "@playwright/test";
import type { Niivue, NVImage } from "@niivue/niivue";
import type { OMEZarrNVImage } from "@fideus-labs/fidnii";

declare global {
  interface Window {
    nv: Niivue;
    image: OMEZarrNVImage;
    loadingComplete: boolean;
  }
}

test.describe("Getting Started Example", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("page loads with canvas element", async ({ page }) => {
    const canvas = page.locator("#gl");
    await expect(canvas).toBeVisible();
  });

  test("NiiVue initializes on canvas", async ({ page }) => {
    // Wait for NiiVue to be exposed on window
    await page.waitForFunction(() => window.nv !== undefined, null, {
      timeout: 30000,
    });

    const hasNv = await page.evaluate(() => {
      return window.nv !== null && window.nv !== undefined;
    });
    expect(hasNv).toBe(true);
  });

  test("OME-Zarr image loads without errors", async ({ page }) => {
    // Collect console errors
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Ignore expected Zarr v2 probe 404s
        if (!text.includes("404")) {
          errors.push(text);
        }
      }
    });

    // Wait for image to be created and exposed
    await page.waitForFunction(() => window.image !== undefined, null, {
      timeout: 60000,
    });

    // Wait for progressive loading to complete
    await page.waitForFunction(
      () => window.loadingComplete === true,
      null,
      { timeout: 120000 }
    );

    // No unexpected errors should have occurred
    expect(errors).toEqual([]);
  });

  test("image has correct multiscales metadata", async ({ page }) => {
    await page.waitForFunction(
      () => window.loadingComplete === true,
      null,
      { timeout: 120000 }
    );

    const metadata = await page.evaluate(() => {
      return {
        numImages: window.image.multiscales.images.length,
        hasMetadata: window.image.multiscales.metadata !== undefined,
      };
    });

    // mri_woman.ome.zarr has 2 resolution levels (scale0, scale1)
    expect(metadata.numImages).toBe(2);
  });

  test("image reaches target resolution level", async ({ page }) => {
    await page.waitForFunction(
      () => window.loadingComplete === true,
      null,
      { timeout: 120000 }
    );

    const resolution = await page.evaluate(() => {
      return {
        currentLevel: window.image.getCurrentLevelIndex(),
        targetLevel: window.image.getTargetLevelIndex(),
        numLevels: window.image.getNumLevels(),
      };
    });

    // Current level should equal target level after loading completes
    expect(resolution.currentLevel).toBe(resolution.targetLevel);
    expect(resolution.numLevels).toBe(2);
  });

  test("volume has valid bounds", async ({ page }) => {
    await page.waitForFunction(
      () => window.loadingComplete === true,
      null,
      { timeout: 120000 }
    );

    const bounds = await page.evaluate(() => {
      return window.image.getVolumeBounds();
    });

    // Bounds should be finite numbers with min < max for each axis
    for (let i = 0; i < 3; i++) {
      expect(Number.isFinite(bounds.min[i])).toBe(true);
      expect(Number.isFinite(bounds.max[i])).toBe(true);
      expect(bounds.max[i]).toBeGreaterThan(bounds.min[i]);
    }
  });

  test("NiiVue has the volume loaded and buffer is populated", async ({
    page,
  }) => {
    await page.waitForFunction(
      () => window.loadingComplete === true,
      null,
      { timeout: 120000 }
    );

    const volumeInfo = await page.evaluate(() => {
      const img = window.image.img;
      return {
        numVolumes: window.nv.volumes.length,
        hasImageData: img !== null && img !== undefined,
        imageDataLength: img ? img.length : 0,
        // Check that the buffer has non-zero values (actual image data)
        hasNonZeroData: img
          ? Array.from(img.slice(0, 1000) as ArrayLike<number>).some(
              (v: number) => v > 0
            )
          : false,
      };
    });

    expect(volumeInfo.numVolumes).toBe(1);
    expect(volumeInfo.hasImageData).toBe(true);
    expect(volumeInfo.imageDataLength).toBeGreaterThan(0);
    expect(volumeInfo.hasNonZeroData).toBe(true);
  });

  test("image is not loading after completion", async ({ page }) => {
    await page.waitForFunction(
      () => window.loadingComplete === true,
      null,
      { timeout: 120000 }
    );

    const isLoading = await page.evaluate(() => {
      return window.image.getIsLoading();
    });

    expect(isLoading).toBe(false);
  });
});
