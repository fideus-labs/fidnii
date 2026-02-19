// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { expect, test } from "@playwright/test"

test.describe("Slice Mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    // Wait for the 3D render to complete loading
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })
  })

  test("second canvas exists", async ({ page }) => {
    const canvas2 = page.locator("#gl2")
    await expect(canvas2).toBeVisible()
  })

  test("second NV instance is exposed on window", async ({ page }) => {
    const hasNv2 = await page.evaluate(() => {
      return (window as any).nv2 !== null && (window as any).nv2 !== undefined
    })
    expect(hasNv2).toBe(true)
  })

  test("second NV starts in axial slice mode", async ({ page }) => {
    const sliceType = await page.evaluate(() => {
      const nv2 = (window as any).nv2
      return nv2.opts.sliceType
    })
    // SLICE_TYPE.AXIAL = 0
    expect(sliceType).toBe(0)
  })

  test("slice type selector changes NV2 mode", async ({ page }) => {
    // Change to Coronal (value=1)
    await page.selectOption("#slice-type", "1")

    const sliceType = await page.evaluate(() => {
      const nv2 = (window as any).nv2
      return nv2.opts.sliceType
    })
    // SLICE_TYPE.CORONAL = 1
    expect(sliceType).toBe(1)
  })

  test("primary NV remains in render mode when NV2 changes", async ({
    page,
  }) => {
    // Change NV2 to sagittal
    await page.selectOption("#slice-type", "2")

    const primarySliceType = await page.evaluate(() => {
      const nv = (window as any).nv
      return nv.opts.sliceType
    })
    // SLICE_TYPE.RENDER = 4
    expect(primarySliceType).toBe(4)
  })

  test("image has attachNiivue method", async ({ page }) => {
    const hasMethod = await page.evaluate(() => {
      const image = (window as any).image
      return typeof image.attachNiivue === "function"
    })
    expect(hasMethod).toBe(true)
  })

  test("image has detachNiivue method", async ({ page }) => {
    const hasMethod = await page.evaluate(() => {
      const image = (window as any).image
      return typeof image.detachNiivue === "function"
    })
    expect(hasMethod).toBe(true)
  })

  test("both NV instances are attached to the image", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const attached = image.getAttachedNiivues()
      return {
        count: attached.length,
        includesNv: attached.includes((window as any).nv),
        includesNv2: attached.includes((window as any).nv2),
      }
    })
    expect(result.count).toBe(2)
    expect(result.includesNv).toBe(true)
    expect(result.includesNv2).toBe(true)
  })

  test("slab buffer is created for axial mode on NV2", async ({ page }) => {
    // NV2 starts in axial mode, so a slab buffer should be created
    // Wait a bit for slab loading to trigger
    await page.waitForTimeout(2000)

    const result = await page.evaluate(async () => {
      const image = (window as any).image
      await image.waitForIdle()

      // SLICE_TYPE.AXIAL = 0
      const slabState = image.getSlabBufferState(0)
      return {
        exists: slabState !== undefined,
        hasNVImage: slabState?.nvImage !== undefined,
        hasData: slabState?.nvImage?.img?.length > 0,
        slabStart: slabState?.slabStart,
        slabEnd: slabState?.slabEnd,
        levelIndex: slabState?.levelIndex,
        targetLevelIndex: slabState?.targetLevelIndex,
      }
    })

    expect(result.exists).toBe(true)
    expect(result.hasNVImage).toBe(true)
    expect(result.hasData).toBe(true)
  })

  test("slab buffer is lazily created — sagittal not created until NV2 switches", async ({
    page,
  }) => {
    // Initially NV2 is in Axial. Sagittal should not have a slab buffer.
    const beforeSwitch = await page.evaluate(() => {
      const image = (window as any).image
      // SLICE_TYPE.SAGITTAL = 2
      return image.getSlabBufferState(2) !== undefined
    })
    expect(beforeSwitch).toBe(false)

    // Switch NV2 to Sagittal
    await page.selectOption("#slice-type", "2")

    // Wait for slab to load
    await page.waitForTimeout(2000)

    const afterSwitch = await page.evaluate(async () => {
      const image = (window as any).image
      await image.waitForIdle()
      // SLICE_TYPE.SAGITTAL = 2
      const slabState = image.getSlabBufferState(2)
      return {
        exists: slabState !== undefined,
        hasData: slabState?.nvImage?.img?.length > 0,
      }
    })
    expect(afterSwitch.exists).toBe(true)
    expect(afterSwitch.hasData).toBe(true)
  })

  test("2D pixel budget selects higher resolution than 3D for same budget", async ({
    page,
  }) => {
    // Wait for slab to load
    await page.waitForTimeout(2000)

    const result = await page.evaluate(async () => {
      const image = (window as any).image
      await image.waitForIdle()

      const renderLevel = image.getTargetLevelIndex() // 3D render target level
      // SLICE_TYPE.AXIAL = 0
      const slabState = image.getSlabBufferState(0)
      const slabTargetLevel = slabState?.targetLevelIndex

      return {
        renderLevel,
        slabTargetLevel,
      }
    })

    // The slab should select a higher resolution (lower level index) than the 3D render
    // because 2D pixel count (width*height) is much smaller than 3D (width*height*depth)
    expect(result.slabTargetLevel).toBeDefined()
    expect(result.slabTargetLevel).toBeLessThanOrEqual(result.renderLevel)
  })

  test("slab is one chunk thick in orthogonal direction", async ({ page }) => {
    // Wait for slab to load
    await page.waitForTimeout(2000)

    const result = await page.evaluate(async () => {
      const image = (window as any).image
      await image.waitForIdle()

      // SLICE_TYPE.AXIAL = 0 → orthogonal axis = Z (index 0 in [z,y,x])
      const slabState = image.getSlabBufferState(0)
      if (!slabState) return null

      // Get chunk shape at the slab's resolution level
      const ngffImage = image.multiscales.images[slabState.levelIndex]
      const chunks = ngffImage.data.chunks
      const dims = ngffImage.dims
      const zIdx = dims.indexOf("z")
      const zChunkSize = zIdx >= 0 ? chunks[zIdx] : chunks[chunks.length - 3]

      return {
        slabStart: slabState.slabStart,
        slabEnd: slabState.slabEnd,
        slabThickness: slabState.slabEnd - slabState.slabStart,
        zChunkSize,
      }
    })

    expect(result).not.toBeNull()
    if (result) {
      // Slab thickness should be at most one chunk size (could be less at volume edge)
      expect(result.slabThickness).toBeLessThanOrEqual(result.zChunkSize)
      expect(result.slabThickness).toBeGreaterThan(0)
    }
  })

  test("switching to render mode on NV2 uses 3D buffer", async ({ page }) => {
    // Switch NV2 to Render mode
    await page.selectOption("#slice-type", "4")
    await page.waitForTimeout(500)

    const result = await page.evaluate(() => {
      const nv2 = (window as any).nv2
      const image = (window as any).image

      // In render mode, the NV2 should have the main image (OMEZarrNVImage itself)
      // as its volume, not a slab NVImage
      const hasMainVolume = nv2.volumes.some((v: any) => v === image)
      return { hasMainVolume }
    })

    expect(result.hasMainVolume).toBe(true)
  })

  test("switching back from render to axial restores slab buffer", async ({
    page,
  }) => {
    // Switch to Render
    await page.selectOption("#slice-type", "4")
    await page.waitForTimeout(500)

    // Switch back to Axial
    await page.selectOption("#slice-type", "0")
    await page.waitForTimeout(2000)

    const result = await page.evaluate(async () => {
      const image = (window as any).image
      const nv2 = (window as any).nv2
      await image.waitForIdle()

      // SLICE_TYPE.AXIAL = 0
      const slabState = image.getSlabBufferState(0)
      const hasSlabVolume = nv2.volumes.some(
        (v: any) => v === slabState?.nvImage,
      )

      return {
        slabExists: slabState !== undefined,
        hasSlabVolume,
      }
    })

    expect(result.slabExists).toBe(true)
    expect(result.hasSlabVolume).toBe(true)
  })

  test("detachNiivue removes the NV from attached list", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const nv2 = (window as any).nv2

      const countBefore = image.getAttachedNiivues().length
      image.detachNiivue(nv2)
      const countAfter = image.getAttachedNiivues().length

      // Re-attach for subsequent tests
      image.attachNiivue(nv2)
      const countReattached = image.getAttachedNiivues().length

      return { countBefore, countAfter, countReattached }
    })

    expect(result.countBefore).toBe(2)
    expect(result.countAfter).toBe(1)
    expect(result.countReattached).toBe(2)
  })

  test("slab loading emits slabLoadingComplete event", async ({ page }) => {
    // Set up a listener, then switch slice type to trigger a slab load
    const eventFired = await page.evaluate(async () => {
      const image = (window as any).image

      return new Promise<boolean>((resolve) => {
        // Listen for slab loading complete on coronal
        image.addEventListener(
          "slabLoadingComplete",
          () => {
            resolve(true)
          },
          { once: true },
        )

        // Switch NV2 to coronal to trigger slab load
        const nv2 = (window as any).nv2
        nv2.setSliceType(1) // CORONAL

        // Timeout fallback (slab loading at level 0 can take 30s+ for large datasets)
        setTimeout(() => resolve(false), 60000)
      })
    })

    expect(eventFired).toBe(true)
  })

  test("slab info display updates in UI", async ({ page }) => {
    // Wait for the slab info to be updated from its default "-"
    // (progressive loading may take a while for all levels)
    await expect(page.locator("#slab-level")).not.toHaveText("-", {
      timeout: 120000,
    })
    await expect(page.locator("#slab-range")).not.toHaveText("-", {
      timeout: 5000,
    })
  })

  test("gl2-label updates when slice type changes", async ({ page }) => {
    // Initially should show "Axial"
    await expect(page.locator("#gl2-label")).toHaveText("Axial")

    // Switch to Coronal
    await page.selectOption("#slice-type", "1")
    await expect(page.locator("#gl2-label")).toHaveText("Coronal")

    // Switch to Sagittal
    await page.selectOption("#slice-type", "2")
    await expect(page.locator("#gl2-label")).toHaveText("Sagittal")
  })

  test("slab data is non-zero after switching to coronal", async ({ page }) => {
    // Switch NV2 to coronal
    await page.selectOption("#slice-type", "1")

    const result = await page.evaluate(async () => {
      const image = (window as any).image
      await image.waitForIdle()

      // SLICE_TYPE.CORONAL = 1
      const slabState = image.getSlabBufferState(1)
      if (!slabState?.nvImage?.img) return null

      const img = slabState.nvImage.img
      let nonZeroCount = 0
      for (let i = 0; i < img.length; i++) {
        if (img[i] !== 0) nonZeroCount++
      }
      return {
        imgLength: img.length,
        nonZeroCount,
        nonZeroPercent: (nonZeroCount / img.length) * 100,
      }
    })

    expect(result).not.toBeNull()
    if (result) {
      expect(result.imgLength).toBeGreaterThan(1)
      // The slab should contain meaningful data — at least some non-zero pixels
      expect(result.nonZeroCount).toBeGreaterThan(0)
    }
  })

  test("crosshair is positioned within volume after slab switch", async ({
    page,
  }) => {
    // Switch NV2 from Axial to Coronal
    await page.selectOption("#slice-type", "1")

    const result = await page.evaluate(async () => {
      const image = (window as any).image
      const nv2 = (window as any).nv2
      await image.waitForIdle()

      const crosshairPos = nv2.scene?.crosshairPos
      if (!crosshairPos) return null

      return {
        x: crosshairPos[0],
        y: crosshairPos[1],
        z: crosshairPos[2],
      }
    })

    expect(result).not.toBeNull()
    if (result) {
      // All fractional coordinates should be strictly within [0, 1].
      // Before the fix, frac2mm ran against the placeholder and produced
      // out-of-range values (clamped to 0 or 1 at the edges).
      for (const axis of ["x", "y", "z"] as const) {
        expect(result[axis]).toBeGreaterThanOrEqual(0)
        expect(result[axis]).toBeLessThanOrEqual(1)
      }
      // At least one axis should NOT be at the extreme edge (0 or 1),
      // indicating the crosshair is positioned within the volume
      const atEdge = [result.x, result.y, result.z].filter(
        (v) => v === 0 || v === 1,
      )
      expect(atEdge.length).toBeLessThan(3)
    }
  })

  test("switching between all slab types preserves crosshair in bounds", async ({
    page,
  }) => {
    // Switch through all slab types and verify crosshair stays in bounds
    const sliceTypes = [
      { value: "1", name: "Coronal" },
      { value: "2", name: "Sagittal" },
      { value: "0", name: "Axial" },
    ]

    for (const { value, name } of sliceTypes) {
      await page.selectOption("#slice-type", value)

      const result = await page.evaluate(async () => {
        const image = (window as any).image
        const nv2 = (window as any).nv2
        await image.waitForIdle()

        const crosshairPos = nv2.scene?.crosshairPos
        const slabState = image.getSlabBufferState(nv2.opts.sliceType)
        const img = slabState?.nvImage?.img

        let nonZeroCount = 0
        if (img) {
          for (let i = 0; i < img.length; i++) {
            if (img[i] !== 0) nonZeroCount++
          }
        }

        return {
          crosshair: crosshairPos
            ? [crosshairPos[0], crosshairPos[1], crosshairPos[2]]
            : null,
          hasData: nonZeroCount > 0,
          imgLength: img?.length ?? 0,
        }
      })

      expect(result.crosshair).not.toBeNull()
      expect(result.hasData).toBe(true)
      // Crosshair should be in [0, 1] for all axes
      if (result.crosshair) {
        for (const v of result.crosshair) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})
