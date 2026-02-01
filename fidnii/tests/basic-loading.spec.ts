// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";

test.describe("Basic Loading", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("page loads successfully", async ({ page }) => {
    await expect(page.locator("h1")).toHaveText("@fideus-labs/fidnii");
  });

  test("canvas element exists", async ({ page }) => {
    const canvas = page.locator("#gl");
    await expect(canvas).toBeVisible();
  });

  test("OME-Zarr loads and status becomes Ready", async ({ page }) => {
    // Wait for loading to complete (status should change to "Ready")
    const statusEl = page.locator("#status");

    // Should show loading state initially or during load
    await expect(statusEl).toBeVisible();

    // Wait for ready state (with generous timeout for loading)
    await expect(statusEl).toHaveText("Ready", { timeout: 30000 });
  });

  test("resolution info is populated after load", async ({ page }) => {
    // Wait for ready
    await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30000 });

    // Check resolution info is populated
    const numLevels = page.locator("#num-levels");
    await expect(numLevels).not.toHaveText("-");

    // stent.ome.zarr has 3 levels
    await expect(numLevels).toHaveText("3");
  });

  test("volume bounds are displayed", async ({ page }) => {
    // Wait for ready
    await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30000 });

    // Check bounds are populated
    const boundsX = page.locator("#bounds-x");
    const boundsY = page.locator("#bounds-y");
    const boundsZ = page.locator("#bounds-z");

    await expect(boundsX).not.toHaveText("-");
    await expect(boundsY).not.toHaveText("-");
    await expect(boundsZ).not.toHaveText("-");
  });

  test("OMEZarrNVImage is exposed on window", async ({ page }) => {
    // Wait for ready
    await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30000 });

    // Check that image is exposed on window
    const hasImage = await page.evaluate(() => {
      return (window as any).image !== null && (window as any).image !== undefined;
    });
    expect(hasImage).toBe(true);
  });

  test("NiiVue is exposed on window", async ({ page }) => {
    // Wait for ready
    await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30000 });

    // Check that nv is exposed on window
    const hasNv = await page.evaluate(() => {
      return (window as any).nv !== null && (window as any).nv !== undefined;
    });
    expect(hasNv).toBe(true);
  });

  test("image has correct multiscales metadata", async ({ page }) => {
    // Wait for ready
    await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30000 });

    // Check multiscales info
    const metadata = await page.evaluate(() => {
      const image = (window as any).image;
      return {
        numImages: image.multiscales.images.length,
        hasMetadata: image.multiscales.metadata !== undefined,
      };
    });

    expect(metadata.numImages).toBe(3);
  });
});
