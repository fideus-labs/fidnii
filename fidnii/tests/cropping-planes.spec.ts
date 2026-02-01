// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";

test.describe("Cropping Planes", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for ready
    await expect(page.locator("#status")).toHaveText("Ready", { timeout: 30000 });
  });

  test("default cropping planes cover full volume", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image;
      const planes = image.getCroppingPlanes();
      const bounds = image.getVolumeBounds();

      return {
        planes,
        bounds,
        xMatch: Math.abs(planes.xMin - bounds.min[0]) < 0.01 && Math.abs(planes.xMax - bounds.max[0]) < 0.01,
        yMatch: Math.abs(planes.yMin - bounds.min[1]) < 0.01 && Math.abs(planes.yMax - bounds.max[1]) < 0.01,
        zMatch: Math.abs(planes.zMin - bounds.min[2]) < 0.01 && Math.abs(planes.zMax - bounds.max[2]) < 0.01,
      };
    });

    expect(result.xMatch).toBe(true);
    expect(result.yMatch).toBe(true);
    expect(result.zMatch).toBe(true);
  });

  test("sliders are initialized with correct range", async ({ page }) => {
    const sliderRanges = await page.evaluate(() => {
      const xmin = document.getElementById("xmin") as HTMLInputElement;
      const xmax = document.getElementById("xmax") as HTMLInputElement;

      const image = (window as any).image;
      const bounds = image.getVolumeBounds();

      return {
        xminRange: { min: parseFloat(xmin.min), max: parseFloat(xmin.max) },
        xmaxRange: { min: parseFloat(xmax.min), max: parseFloat(xmax.max) },
        boundsX: { min: bounds.min[0], max: bounds.max[0] },
      };
    });

    expect(sliderRanges.xminRange.min).toBeCloseTo(sliderRanges.boundsX.min, 1);
    expect(sliderRanges.xminRange.max).toBeCloseTo(sliderRanges.boundsX.max, 1);
  });

  test("setCroppingPlanes updates the planes", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image;
      const bounds = image.getVolumeBounds();

      // Set cropping to half the volume in X
      const midX = (bounds.min[0] + bounds.max[0]) / 2;
      image.setCroppingPlanes({
        xMin: midX,
      });

      const newPlanes = image.getCroppingPlanes();
      return {
        newXMin: newPlanes.xMin,
        expectedXMin: midX,
      };
    });

    expect(result.newXMin).toBeCloseTo(result.expectedXMin, 1);
  });

  test("slider change updates cropping planes", async ({ page }) => {
    // Get initial planes
    const initialPlanes = await page.evaluate(() => {
      const image = (window as any).image;
      return image.getCroppingPlanes();
    });

    // Move xmin slider using JavaScript (fill doesn't work well with range inputs)
    const newValue = initialPlanes.xMin + (initialPlanes.xMax - initialPlanes.xMin) * 0.25;

    await page.evaluate((val) => {
      const slider = document.getElementById("xmin") as HTMLInputElement;
      slider.value = String(val);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }, newValue);

    // Check planes updated
    const newPlanes = await page.evaluate(() => {
      const image = (window as any).image;
      return image.getCroppingPlanes();
    });

    expect(newPlanes.xMin).toBeGreaterThan(initialPlanes.xMin);
  });

  test("reset cropping restores full volume", async ({ page }) => {
    // Change cropping
    await page.evaluate(() => {
      const image = (window as any).image;
      const bounds = image.getVolumeBounds();
      const midX = (bounds.min[0] + bounds.max[0]) / 2;
      image.setCroppingPlanes({ xMin: midX });
    });

    // Click reset
    await page.locator("#reset-crop").click();

    // Check planes are restored
    const result = await page.evaluate(() => {
      const image = (window as any).image;
      const planes = image.getCroppingPlanes();
      const bounds = image.getVolumeBounds();

      return {
        xMinMatch: Math.abs(planes.xMin - bounds.min[0]) < 0.1,
      };
    });

    expect(result.xMinMatch).toBe(true);
  });

  test("cropping planes values displayed in UI", async ({ page }) => {
    const xminValue = page.locator("#xmin-value");
    const xmaxValue = page.locator("#xmax-value");

    // Should have actual values, not placeholder
    await expect(xminValue).not.toHaveText("-");
    await expect(xmaxValue).not.toHaveText("-");

    // Values should be numbers
    const xmin = await xminValue.textContent();
    const xmax = await xmaxValue.textContent();

    expect(parseFloat(xmin!)).not.toBeNaN();
    expect(parseFloat(xmax!)).not.toBeNaN();
  });

  test("cropping to smaller region may change resolution", async ({ page }) => {
    // Get initial target level
    const initialLevel = await page.evaluate(() => {
      const image = (window as any).image;
      return image.getTargetLevelIndex();
    });

    // Crop to a very small region (should allow higher resolution)
    await page.evaluate(async () => {
      const image = (window as any).image;
      const bounds = image.getVolumeBounds();

      // Crop to ~10% of volume in each dimension
      const rangeX = bounds.max[0] - bounds.min[0];
      const rangeY = bounds.max[1] - bounds.min[1];
      const rangeZ = bounds.max[2] - bounds.min[2];

      image.setCroppingPlanes({
        xMin: bounds.min[0] + rangeX * 0.4,
        xMax: bounds.min[0] + rangeX * 0.6,
        yMin: bounds.min[1] + rangeY * 0.4,
        yMax: bounds.min[1] + rangeY * 0.6,
        zMin: bounds.min[2] + rangeZ * 0.4,
        zMax: bounds.min[2] + rangeZ * 0.6,
      });

      // Wait for any reload to complete
      await image.waitForIdle();
    });

    // Get new target level
    const newLevel = await page.evaluate(() => {
      const image = (window as any).image;
      return image.getTargetLevelIndex();
    });

    // Smaller region should allow same or higher resolution (lower or equal level index)
    expect(newLevel).toBeLessThanOrEqual(initialLevel);
  });

  test("getCroppingPlanes returns a copy", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image;
      const planes1 = image.getCroppingPlanes();
      planes1.xMin = 99999;
      const planes2 = image.getCroppingPlanes();

      return planes2.xMin !== 99999;
    });

    expect(result).toBe(true);
  });
});
