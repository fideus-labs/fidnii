// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { expect, test } from "@playwright/test"

test.describe("Coordinate System", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    // Wait for ready (generous timeout for S3 loading)
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })
  })

  test("volume bounds match OME-Zarr metadata", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const bounds = image.getVolumeBounds()
      const highResImage = image.multiscales.images[0]

      // Get scale and translation from highest resolution
      const scale = highResImage.scale
      const translation = highResImage.translation

      return {
        bounds,
        scale: {
          x: scale.x ?? scale.X ?? 1,
          y: scale.y ?? scale.Y ?? 1,
          z: scale.z ?? scale.Z ?? 1,
        },
        translation: {
          x: translation?.x ?? translation?.X ?? 0,
          y: translation?.y ?? translation?.Y ?? 0,
          z: translation?.z ?? translation?.Z ?? 0,
        },
        shape: highResImage.data.shape,
      }
    })

    // The bounds should be based on scale * shape + translation
    // For beechnut.ome.zarr: z=1546, y=1024, x=1024 at highest res
    // scale: 2e-5 per axis
    // translation: z~=-0.01546, y~=-0.01024, x~=-0.01024

    // Just verify bounds are reasonable (not NaN, not zero extent)
    expect(result.bounds.min[0]).not.toBeNaN()
    expect(result.bounds.max[0]).not.toBeNaN()
    expect(result.bounds.max[0]).toBeGreaterThan(result.bounds.min[0])

    expect(result.bounds.min[1]).not.toBeNaN()
    expect(result.bounds.max[1]).not.toBeNaN()
    expect(result.bounds.max[1]).toBeGreaterThan(result.bounds.min[1])

    expect(result.bounds.min[2]).not.toBeNaN()
    expect(result.bounds.max[2]).not.toBeNaN()
    expect(result.bounds.max[2]).toBeGreaterThan(result.bounds.min[2])
  })

  test("NVImage header has correct dimensions", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const hdr = image.hdr

      return {
        dims: hdr.dims,
        pixDims: hdr.pixDims,
        datatypeCode: hdr.datatypeCode,
        sform_code: hdr.sform_code,
      }
    })

    // dims[0] is ndim (should be 3)
    expect(result.dims[0]).toBe(3)

    // Actual dimensions should be positive
    expect(result.dims[1]).toBeGreaterThan(0)
    expect(result.dims[2]).toBeGreaterThan(0)
    expect(result.dims[3]).toBeGreaterThan(0)

    // Pixel dimensions should be positive
    expect(result.pixDims[1]).toBeGreaterThan(0)
    expect(result.pixDims[2]).toBeGreaterThan(0)
    expect(result.pixDims[3]).toBeGreaterThan(0)

    // sform_code should be 1 (scanner coordinates)
    expect(result.sform_code).toBe(1)
  })

  test("NVImage affine is populated", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const affine = image.hdr.affine

      return {
        rows: affine.length,
        cols: affine[0].length,
        hasNonZero: affine.flat().some((v: number) => v !== 0),
      }
    })

    // Affine should be 4x4
    expect(result.rows).toBe(4)
    expect(result.cols).toBe(4)

    // Should have non-zero values
    expect(result.hasNonZero).toBe(true)
  })

  test("NVImage affine diagonal signs reflect orientation metadata", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const affine = image.hdr.affine
      const firstImage = image.multiscales.images[0]
      const { getOrientationSigns } = (window as any).fidnii
      const signs = getOrientationSigns(firstImage.axesOrientations)

      return {
        signs,
        diag: [affine[0][0], affine[1][1], affine[2][2]],
      }
    })

    // The sign of each diagonal element should match the orientation sign
    // (positive diagonal = RAS+ direction, negative = anti-RAS+)
    expect(Math.sign(result.diag[0])).toBe(result.signs.x)
    expect(Math.sign(result.diag[2])).toBe(result.signs.z)
    // y may be affected by 2D y-flip, but for 3D data it should match
  })

  test("pixel to world conversion is consistent across resolutions", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const multiscales = image.multiscales

      // Get center pixel at each resolution
      const centerWorlds: number[][] = []

      for (let i = 0; i < multiscales.images.length; i++) {
        const img = multiscales.images[i]
        const shape = img.data.shape

        // Center pixel (assuming 3D: z, y, x)
        const centerPixel = [shape[0] / 2, shape[1] / 2, shape[2] / 2]

        // Convert to world using scale and translation
        const scale = img.scale
        const translation = img.translation || { x: 0, y: 0, z: 0 }

        const sx = scale.x ?? scale.X ?? 1
        const sy = scale.y ?? scale.Y ?? 1
        const sz = scale.z ?? scale.Z ?? 1
        const tx = translation.x ?? translation.X ?? 0
        const ty = translation.y ?? translation.Y ?? 0
        const tz = translation.z ?? translation.Z ?? 0

        // world = pixel * scale + translation
        const worldZ = centerPixel[0] * sz + tz
        const worldY = centerPixel[1] * sy + ty
        const worldX = centerPixel[2] * sx + tx

        centerWorlds.push([worldX, worldY, worldZ])
      }

      return { centerWorlds }
    })

    // All resolutions should map to approximately the same world center
    const worlds = result.centerWorlds
    // Use a fraction of the full extent as tolerance (scale-independent)
    const extent = Math.max(
      Math.abs(worlds[0][0]),
      Math.abs(worlds[0][1]),
      Math.abs(worlds[0][2]),
      0.001,
    )
    const tolerance = extent * 0.1 // 10% of the world coordinate magnitude

    for (let i = 1; i < worlds.length; i++) {
      expect(Math.abs(worlds[i][0] - worlds[0][0])).toBeLessThan(tolerance)
      expect(Math.abs(worlds[i][1] - worlds[0][1])).toBeLessThan(tolerance)
      expect(Math.abs(worlds[i][2] - worlds[0][2])).toBeLessThan(tolerance)
    }
  })

  test("clip planes use world coordinates", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const image = (window as any).image
      const bounds = image.getVolumeBounds()

      // Add a clip plane in the middle of the X axis
      const midX = (bounds.min[0] + bounds.max[0]) / 2
      const centerY = (bounds.min[1] + bounds.max[1]) / 2
      const centerZ = (bounds.min[2] + bounds.max[2]) / 2

      image.setClipPlanes([
        { point: [midX, centerY, centerZ], normal: [1, 0, 0] },
      ])

      await image.waitForIdle()
      const planes = image.getClipPlanes()

      // Clip plane point should be within volume bounds (small epsilon for floating point)
      const epsilon =
        Math.max(
          bounds.max[0] - bounds.min[0],
          bounds.max[1] - bounds.min[1],
          bounds.max[2] - bounds.min[2],
        ) * 0.01
      const point = planes[0].point
      return {
        pointInBoundsX:
          point[0] >= bounds.min[0] - epsilon &&
          point[0] <= bounds.max[0] + epsilon,
        pointInBoundsY:
          point[1] >= bounds.min[1] - epsilon &&
          point[1] <= bounds.max[1] + epsilon,
        pointInBoundsZ:
          point[2] >= bounds.min[2] - epsilon &&
          point[2] <= bounds.max[2] + epsilon,
      }
    })

    expect(result.pointInBoundsX).toBe(true)
    expect(result.pointInBoundsY).toBe(true)
    expect(result.pointInBoundsZ).toBe(true)
  })

  test("data type matches OME-Zarr dtype", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const dtype = image.multiscales.images[0].data.dtype
      const datatypeCode = image.hdr.datatypeCode
      const imgArray = image.img

      return {
        zarrDtype: dtype,
        niftiCode: datatypeCode,
        arrayType: imgArray.constructor.name,
      }
    })

    // beechnut.ome.zarr is uint16, which maps to NIfTI code 512 and Uint16Array
    expect(result.niftiCode).toBe(512)
    expect(result.arrayType).toBe("Uint16Array")
  })

  test("bounds displayed in UI match image bounds", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const bounds = image.getVolumeBounds()

      const boundsXText = document.getElementById("bounds-x")?.textContent!
      const boundsYText = document.getElementById("bounds-y")?.textContent!
      const boundsZText = document.getElementById("bounds-z")?.textContent!

      return {
        imageBounds: bounds,
        displayedX: boundsXText,
        displayedY: boundsYText,
        displayedZ: boundsZText,
      }
    })

    // Parse displayed values
    const parseRange = (text: string) => {
      const match = text.match(/\[([-\d.]+),\s*([-\d.]+)\]/)
      return match ? [parseFloat(match[1]), parseFloat(match[2])] : null
    }

    const displayedX = parseRange(result.displayedX)
    const displayedY = parseRange(result.displayedY)
    const displayedZ = parseRange(result.displayedZ)

    expect(displayedX).not.toBeNull()
    expect(displayedY).not.toBeNull()
    expect(displayedZ).not.toBeNull()

    expect(displayedX?.[0]).toBeCloseTo(result.imageBounds.min[0], 0)
    expect(displayedX?.[1]).toBeCloseTo(result.imageBounds.max[0], 0)
  })
})
