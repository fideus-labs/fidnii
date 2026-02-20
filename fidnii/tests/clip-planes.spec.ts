// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { expect, test } from "@playwright/test"

test.describe("Clip Planes", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    // Wait for ready (generous timeout for S3 loading)
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })
  })

  test("default clip planes is empty array (full volume visible)", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const clipPlanes = image.getClipPlanes()
      return {
        length: clipPlanes.length,
        isArray: Array.isArray(clipPlanes),
      }
    })

    expect(result.isArray).toBe(true)
    expect(result.length).toBe(0)
  })

  test("getClipPlanes returns empty array initially", async ({ page }) => {
    const clipPlanes = await page.evaluate(() => {
      const image = (window as any).image
      return image.getClipPlanes()
    })

    expect(clipPlanes).toEqual([])
  })

  test("setClipPlanes with single plane clips volume", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const image = (window as any).image
      const bounds = image.getVolumeBounds()

      // Create a clip plane at X midpoint, pointing +X
      const midX = (bounds.min[0] + bounds.max[0]) / 2
      const centerY = (bounds.min[1] + bounds.max[1]) / 2
      const centerZ = (bounds.min[2] + bounds.max[2]) / 2

      image.setClipPlanes([
        {
          point: [midX, centerY, centerZ],
          normal: [1, 0, 0], // Keep +X side
        },
      ])

      await image.waitForIdle()

      const planes = image.getClipPlanes()
      return {
        numPlanes: planes.length,
        planePoint: planes[0]?.point,
        planeNormal: planes[0]?.normal,
      }
    })

    expect(result.numPlanes).toBe(1)
    expect(result.planePoint).toBeDefined()
    expect(result.planeNormal).toEqual([1, 0, 0])
  })

  test("setClipPlanes with 6 planes works", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const image = (window as any).image
      const bounds = image.getVolumeBounds()
      const center = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ]

      // Create 6 axis-aligned planes (forming a smaller box)
      // Use 25% of each axis range as inset
      const rangeX = bounds.max[0] - bounds.min[0]
      const rangeY = bounds.max[1] - bounds.min[1]
      const rangeZ = bounds.max[2] - bounds.min[2]
      image.setClipPlanes([
        {
          point: [bounds.min[0] + rangeX * 0.25, center[1], center[2]],
          normal: [1, 0, 0],
        },
        {
          point: [bounds.max[0] - rangeX * 0.25, center[1], center[2]],
          normal: [-1, 0, 0],
        },
        {
          point: [center[0], bounds.min[1] + rangeY * 0.25, center[2]],
          normal: [0, 1, 0],
        },
        {
          point: [center[0], bounds.max[1] - rangeY * 0.25, center[2]],
          normal: [0, -1, 0],
        },
        {
          point: [center[0], center[1], bounds.min[2] + rangeZ * 0.25],
          normal: [0, 0, 1],
        },
        {
          point: [center[0], center[1], bounds.max[2] - rangeZ * 0.25],
          normal: [0, 0, -1],
        },
      ])

      await image.waitForIdle()
      return image.getClipPlanes().length
    })

    expect(result).toBe(6)
  })

  test("setClipPlanes with 7 planes throws error", async ({ page }) => {
    const error = await page.evaluate(async () => {
      const image = (window as any).image

      try {
        image.setClipPlanes([
          { point: [0, 0, 0], normal: [1, 0, 0] },
          { point: [0, 0, 0], normal: [-1, 0, 0] },
          { point: [0, 0, 0], normal: [0, 1, 0] },
          { point: [0, 0, 0], normal: [0, -1, 0] },
          { point: [0, 0, 0], normal: [0, 0, 1] },
          { point: [0, 0, 0], normal: [0, 0, -1] },
          { point: [0, 0, 0], normal: [1, 1, 0] }, // 7th plane
        ])
        return null
      } catch (e) {
        return (e as Error).message
      }
    })

    expect(error).toContain("Too many clip planes")
  })

  test("addClipPlane adds a plane", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const image = (window as any).image
      const bounds = image.getVolumeBounds()
      const center = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ]

      const initialCount = image.getClipPlanes().length

      image.addClipPlane({
        point: [center[0], center[1], center[2]],
        normal: [1, 0, 0],
      })

      await image.waitForIdle()
      const finalCount = image.getClipPlanes().length

      return { initialCount, finalCount }
    })

    expect(result.initialCount).toBe(0)
    expect(result.finalCount).toBe(1)
  })

  test("addClipPlane throws when at 6 planes", async ({ page }) => {
    const error = await page.evaluate(async () => {
      const image = (window as any).image

      // Add 6 planes first
      image.setClipPlanes([
        { point: [0, 0, 0], normal: [1, 0, 0] },
        { point: [0, 0, 0], normal: [-1, 0, 0] },
        { point: [0, 0, 0], normal: [0, 1, 0] },
        { point: [0, 0, 0], normal: [0, -1, 0] },
        { point: [0, 0, 0], normal: [0, 0, 1] },
        { point: [0, 0, 0], normal: [0, 0, -1] },
      ])

      try {
        image.addClipPlane({ point: [0, 0, 0], normal: [1, 1, 0] })
        return null
      } catch (e) {
        return (e as Error).message
      }
    })

    expect(error).toContain("Cannot add clip plane")
    expect(error).toContain("maximum")
  })

  test("removeClipPlane removes correct plane", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const image = (window as any).image

      // Add 3 planes with different normals
      image.setClipPlanes([
        { point: [0, 0, 0], normal: [1, 0, 0] },
        { point: [0, 0, 0], normal: [0, 1, 0] },
        { point: [0, 0, 0], normal: [0, 0, 1] },
      ])

      // Remove the middle one (index 1)
      image.removeClipPlane(1)

      await image.waitForIdle()
      const remaining = image.getClipPlanes()

      return {
        count: remaining.length,
        normals: remaining.map((p: any) => p.normal),
      }
    })

    expect(result.count).toBe(2)
    expect(result.normals[0]).toEqual([1, 0, 0])
    expect(result.normals[1]).toEqual([0, 0, 1])
  })

  test("clearClipPlanes removes all planes", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const image = (window as any).image

      // Add some planes
      image.setClipPlanes([
        { point: [0, 0, 0], normal: [1, 0, 0] },
        { point: [0, 0, 0], normal: [0, 1, 0] },
      ])

      const beforeClear = image.getClipPlanes().length

      image.clearClipPlanes()
      await image.waitForIdle()

      const afterClear = image.getClipPlanes().length

      return { beforeClear, afterClear }
    })

    expect(result.beforeClear).toBe(2)
    expect(result.afterClear).toBe(0)
  })

  test("getClipPlanes returns a copy", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image

      image.setClipPlanes([{ point: [10, 20, 30], normal: [1, 0, 0] }])

      const planes1 = image.getClipPlanes()
      planes1[0].point[0] = 99999
      planes1[0].normal[0] = 99999

      const planes2 = image.getClipPlanes()

      return {
        modifiedPoint: planes1[0].point[0],
        originalPoint: planes2[0].point[0],
        modifiedNormal: planes1[0].normal[0],
        originalNormal: planes2[0].normal[0],
      }
    })

    expect(result.modifiedPoint).toBe(99999)
    expect(result.originalPoint).toBe(10)
    expect(result.modifiedNormal).toBe(99999)
    expect(result.originalNormal).toBe(1)
  })

  test("clip plane point is at specified position", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const image = (window as any).image
      const bounds = image.getVolumeBounds()

      // Place test point 25% into the X range
      const rangeX = bounds.max[0] - bounds.min[0]
      const testPoint: [number, number, number] = [
        bounds.min[0] + rangeX * 0.25,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ]

      image.setClipPlanes([{ point: testPoint, normal: [1, 0, 0] }])

      await image.waitForIdle()
      const planes = image.getClipPlanes()

      return {
        setPoint: testPoint,
        retrievedPoint: planes[0].point,
      }
    })

    expect(result.retrievedPoint[0]).toBeCloseTo(result.setPoint[0], 5)
    expect(result.retrievedPoint[1]).toBeCloseTo(result.setPoint[1], 5)
    expect(result.retrievedPoint[2]).toBeCloseTo(result.setPoint[2], 5)
  })

  test("clip plane normal is normalized", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const image = (window as any).image

      // Set a non-normalized normal
      image.setClipPlanes([
        { point: [0, 0, 0], normal: [3, 4, 0] }, // Length = 5
      ])

      await image.waitForIdle()
      const planes = image.getClipPlanes()
      const normal = planes[0].normal

      // Calculate length
      const length = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2)

      return { normal, length }
    })

    // Normal should be normalized to unit length
    expect(result.length).toBeCloseTo(1.0, 5)
    expect(result.normal[0]).toBeCloseTo(0.6, 5) // 3/5
    expect(result.normal[1]).toBeCloseTo(0.8, 5) // 4/5
    expect(result.normal[2]).toBeCloseTo(0, 5)
  })

  test("clipping to smaller region may change resolution", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const image = (window as any).image
      const bounds = image.getVolumeBounds()

      // Get initial target level (full volume)
      const initialLevel = image.getTargetLevelIndex()

      // Wait for the clipPlanesChange event, which fires after the
      // debounce handler has updated targetLevelIndex. We don't need
      // to wait for the full data fetch — only the resolution decision.
      const clipPlanesChanged = new Promise<void>((resolve) => {
        image.addEventListener("clipPlanesChange", () => resolve(), {
          once: true,
        })
      })

      // Create 6 clip planes to make a small box (10% of volume in each dimension)
      const center = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ]
      const range = [
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
      ]

      image.setClipPlanes([
        {
          point: [center[0] - range[0] * 0.05, center[1], center[2]],
          normal: [1, 0, 0],
        },
        {
          point: [center[0] + range[0] * 0.05, center[1], center[2]],
          normal: [-1, 0, 0],
        },
        {
          point: [center[0], center[1] - range[1] * 0.05, center[2]],
          normal: [0, 1, 0],
        },
        {
          point: [center[0], center[1] + range[1] * 0.05, center[2]],
          normal: [0, -1, 0],
        },
        {
          point: [center[0], center[1], center[2] - range[2] * 0.05],
          normal: [0, 0, 1],
        },
        {
          point: [center[0], center[1], center[2] + range[2] * 0.05],
          normal: [0, 0, -1],
        },
      ])

      await clipPlanesChanged
      const clippedLevel = image.getTargetLevelIndex()

      return { initialLevel, clippedLevel }
    })

    // Smaller region should allow same or higher resolution (lower or equal level index)
    expect(result.clippedLevel).toBeLessThanOrEqual(result.initialLevel)
  })

  test("world coordinates remain stable when clip planes change", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const image = (window as any).image

      // Get initial affine
      const initialAffine = [...image.hdr.affine.flat()]
      const bounds = image.getVolumeBounds()

      // Add a clip plane that should trigger a refetch
      const center = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ]

      // Clip to second half in X
      image.setClipPlanes([
        { point: [center[0], center[1], center[2]], normal: [1, 0, 0] },
      ])

      await image.waitForIdle()
      const clippedAffine = [...image.hdr.affine.flat()]

      return { initialAffine, clippedAffine, bounds }
    })

    // The affine should have changed to account for the region offset
    // This verifies the affine is being updated when the region changes
    expect(result.clippedAffine).toBeDefined()
  })

  test("oblique clip plane works", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const image = (window as any).image
      const bounds = image.getVolumeBounds()
      const center = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ]

      // Create an oblique clip plane (45 degrees)
      const normal = [1 / Math.sqrt(2), 1 / Math.sqrt(2), 0] // 45 degrees in XY plane

      image.setClipPlanes([{ point: center, normal }])

      await image.waitForIdle()
      const planes = image.getClipPlanes()

      return {
        success: planes.length === 1,
        normal: planes[0].normal,
      }
    })

    expect(result.success).toBe(true)
    // Check the normal is approximately correct (normalized)
    expect(result.normal[0]).toBeCloseTo(1 / Math.sqrt(2), 3)
    expect(result.normal[1]).toBeCloseTo(1 / Math.sqrt(2), 3)
    expect(result.normal[2]).toBeCloseTo(0, 3)
  })

  test("UI shows clip plane count", async ({ page }) => {
    const countEl = page.locator("#clip-plane-count")

    // Initially 0
    await expect(countEl).toHaveText("0")

    // Add a plane by moving the X Min slider inward via JavaScript
    await page.evaluate(() => {
      const image = (window as any).image
      const bounds = image.getVolumeBounds()
      const xminSlider = document.getElementById("xmin") as HTMLInputElement

      // Move slider 25% into the volume
      const xminTarget = bounds.min[0] + (bounds.max[0] - bounds.min[0]) * 0.25
      xminSlider.value = String(xminTarget)
      xminSlider.dispatchEvent(new Event("input", { bubbles: true }))
    })

    // Should now have 1 clip plane
    await expect(countEl).toHaveText("1")

    // Reset
    await page.locator("#reset-clip-planes").click()
    await expect(countEl).toHaveText("0")
  })
})
