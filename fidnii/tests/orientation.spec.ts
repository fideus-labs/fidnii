// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { expect, test } from "@playwright/test"

test.describe("Orientation — getOrientationSigns()", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForFunction(() => (window as any).fidnii !== undefined, {
      timeout: 30000,
    })
  })

  test("returns all +1 when axesOrientations is undefined", async ({
    page,
  }) => {
    const signs = await page.evaluate(() => {
      return (window as any).fidnii.getOrientationSigns(undefined)
    })
    expect(signs).toEqual({ x: 1, y: 1, z: 1 })
  })

  test("returns all +1 for RAS orientation", async ({ page }) => {
    const signs = await page.evaluate(() => {
      const { getOrientationSigns } = (window as any).fidnii
      return getOrientationSigns({
        x: { type: "anatomical", value: "left-to-right" },
        y: { type: "anatomical", value: "posterior-to-anterior" },
        z: { type: "anatomical", value: "inferior-to-superior" },
      })
    })
    expect(signs).toEqual({ x: 1, y: 1, z: 1 })
  })

  test("returns x:-1, y:-1, z:1 for LPS orientation", async ({ page }) => {
    const signs = await page.evaluate(() => {
      const { getOrientationSigns } = (window as any).fidnii
      return getOrientationSigns({
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "anterior-to-posterior" },
        z: { type: "anatomical", value: "inferior-to-superior" },
      })
    })
    expect(signs).toEqual({ x: -1, y: -1, z: 1 })
  })

  test("returns z:-1 for superior-to-inferior on z", async ({ page }) => {
    const signs = await page.evaluate(() => {
      const { getOrientationSigns } = (window as any).fidnii
      return getOrientationSigns({
        x: { type: "anatomical", value: "left-to-right" },
        y: { type: "anatomical", value: "posterior-to-anterior" },
        z: { type: "anatomical", value: "superior-to-inferior" },
      })
    })
    expect(signs).toEqual({ x: 1, y: 1, z: -1 })
  })

  test("returns all -1 for LPI orientation", async ({ page }) => {
    const signs = await page.evaluate(() => {
      const { getOrientationSigns } = (window as any).fidnii
      return getOrientationSigns({
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "anterior-to-posterior" },
        z: { type: "anatomical", value: "superior-to-inferior" },
      })
    })
    expect(signs).toEqual({ x: -1, y: -1, z: -1 })
  })

  test("defaults to +1 for exotic orientations", async ({ page }) => {
    const signs = await page.evaluate(() => {
      const { getOrientationSigns } = (window as any).fidnii
      return getOrientationSigns({
        x: { type: "anatomical", value: "dorsal-to-ventral" },
        y: { type: "anatomical", value: "rostral-to-caudal" },
        z: { type: "anatomical", value: "proximal-to-distal" },
      })
    })
    expect(signs).toEqual({ x: 1, y: 1, z: 1 })
  })

  test("handles partial orientations (only some axes defined)", async ({
    page,
  }) => {
    const signs = await page.evaluate(() => {
      const { getOrientationSigns } = (window as any).fidnii
      // Only x defined, y and z missing
      return getOrientationSigns({
        x: { type: "anatomical", value: "right-to-left" },
      })
    })
    expect(signs).toEqual({ x: -1, y: 1, z: 1 })
  })

  test("handles empty orientations object", async ({ page }) => {
    const signs = await page.evaluate(() => {
      const { getOrientationSigns } = (window as any).fidnii
      return getOrientationSigns({})
    })
    expect(signs).toEqual({ x: 1, y: 1, z: 1 })
  })

  test("handles uppercase axis keys (X, Y, Z)", async ({ page }) => {
    const signs = await page.evaluate(() => {
      const { getOrientationSigns } = (window as any).fidnii
      return getOrientationSigns({
        X: { type: "anatomical", value: "right-to-left" },
        Y: { type: "anatomical", value: "anterior-to-posterior" },
        Z: { type: "anatomical", value: "inferior-to-superior" },
      })
    })
    expect(signs).toEqual({ x: -1, y: -1, z: 1 })
  })
})

test.describe("Orientation — getOrientationMapping()", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForFunction(() => (window as any).fidnii !== undefined, {
      timeout: 30000,
    })
  })

  test("returns identity mapping when undefined", async ({ page }) => {
    const mapping = await page.evaluate(() => {
      return (window as any).fidnii.getOrientationMapping(undefined)
    })
    expect(mapping).toEqual({
      x: { physicalRow: 0, sign: 1 },
      y: { physicalRow: 1, sign: 1 },
      z: { physicalRow: 2, sign: 1 },
    })
  })

  test("returns correct mapping for LPS", async ({ page }) => {
    const mapping = await page.evaluate(() => {
      const { getOrientationMapping } = (window as any).fidnii
      return getOrientationMapping({
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "anterior-to-posterior" },
        z: { type: "anatomical", value: "inferior-to-superior" },
      })
    })
    // LPS: x→L/R row 0 sign -1, y→A/P row 1 sign -1, z→S/I row 2 sign +1
    expect(mapping).toEqual({
      x: { physicalRow: 0, sign: -1 },
      y: { physicalRow: 1, sign: -1 },
      z: { physicalRow: 2, sign: 1 },
    })
  })

  test("returns permuted mapping for mri.nii.gz-like orientation", async ({
    page,
  }) => {
    const mapping = await page.evaluate(() => {
      const { getOrientationMapping } = (window as any).fidnii
      // mri.nii.gz: y encodes S/I, z encodes A/P
      return getOrientationMapping({
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "superior-to-inferior" },
        z: { type: "anatomical", value: "posterior-to-anterior" },
      })
    })
    // x→row 0 sign -1, y→row 2 sign -1, z→row 1 sign +1
    expect(mapping).toEqual({
      x: { physicalRow: 0, sign: -1 },
      y: { physicalRow: 2, sign: -1 },
      z: { physicalRow: 1, sign: 1 },
    })
  })

  test("returns identity mapping for RAS", async ({ page }) => {
    const mapping = await page.evaluate(() => {
      const { getOrientationMapping } = (window as any).fidnii
      return getOrientationMapping({
        x: { type: "anatomical", value: "left-to-right" },
        y: { type: "anatomical", value: "posterior-to-anterior" },
        z: { type: "anatomical", value: "inferior-to-superior" },
      })
    })
    expect(mapping).toEqual({
      x: { physicalRow: 0, sign: 1 },
      y: { physicalRow: 1, sign: 1 },
      z: { physicalRow: 2, sign: 1 },
    })
  })
})

test.describe("Orientation — applyOrientationToAffine()", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForFunction(() => (window as any).fidnii !== undefined, {
      timeout: 30000,
    })
  })

  test("does not modify affine when orientations are undefined", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii
      const affine = createAffineFromOMEZarr(
        { x: 2, y: 3, z: 4 },
        { x: 10, y: 20, z: 30 },
      )
      applyOrientationToAffine(affine, undefined)
      return {
        sx: affine[0],
        sy: affine[5],
        sz: affine[10],
        tx: affine[12],
        ty: affine[13],
        tz: affine[14],
      }
    })
    expect(result.sx).toBe(2)
    expect(result.sy).toBe(3)
    expect(result.sz).toBe(4)
    expect(result.tx).toBe(10)
    expect(result.ty).toBe(20)
    expect(result.tz).toBe(30)
  })

  test("does not modify affine for RAS orientation", async ({ page }) => {
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii
      const affine = createAffineFromOMEZarr(
        { x: 2, y: 3, z: 4 },
        { x: 10, y: 20, z: 30 },
      )
      applyOrientationToAffine(affine, {
        x: { type: "anatomical", value: "left-to-right" },
        y: { type: "anatomical", value: "posterior-to-anterior" },
        z: { type: "anatomical", value: "inferior-to-superior" },
      })
      return {
        sx: affine[0],
        sy: affine[5],
        sz: affine[10],
        tx: affine[12],
        ty: affine[13],
        tz: affine[14],
      }
    })
    expect(result.sx).toBe(2)
    expect(result.sy).toBe(3)
    expect(result.sz).toBe(4)
    expect(result.tx).toBe(10)
    expect(result.ty).toBe(20)
    expect(result.tz).toBe(30)
  })

  test("negates x/y scale and translation for LPS", async ({ page }) => {
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii
      const affine = createAffineFromOMEZarr(
        { x: 2, y: 3, z: 4 },
        { x: 10, y: 20, z: 30 },
      )
      applyOrientationToAffine(affine, {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "anterior-to-posterior" },
        z: { type: "anatomical", value: "inferior-to-superior" },
      })
      return {
        sx: affine[0],
        sy: affine[5],
        sz: affine[10],
        tx: affine[12],
        ty: affine[13],
        tz: affine[14],
      }
    })
    // x and y scale and translation negated (LPS→RAS), z unchanged
    expect(result.sx).toBe(-2)
    expect(result.sy).toBe(-3)
    expect(result.sz).toBe(4)
    expect(result.tx).toBe(-10)
    expect(result.ty).toBe(-20)
    expect(result.tz).toBe(30)
  })

  test("negates all scale and translation for LPI", async ({ page }) => {
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii
      const affine = createAffineFromOMEZarr(
        { x: 2, y: 3, z: 4 },
        { x: 10, y: 20, z: 30 },
      )
      applyOrientationToAffine(affine, {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "anterior-to-posterior" },
        z: { type: "anatomical", value: "superior-to-inferior" },
      })
      return {
        sx: affine[0],
        sy: affine[5],
        sz: affine[10],
        tx: affine[12],
        ty: affine[13],
        tz: affine[14],
      }
    })
    expect(result.sx).toBe(-2)
    expect(result.sy).toBe(-3)
    expect(result.sz).toBe(-4)
    expect(result.tx).toBe(-10)
    expect(result.ty).toBe(-20)
    expect(result.tz).toBe(-30)
  })

  test("produces correct permuted affine for mri.nii.gz-like data", async ({
    page,
  }) => {
    // mri.nii.gz has a permuted direction matrix:
    //   x: right-to-left (physical L/R, row 0, sign -1)
    //   y: superior-to-inferior (physical S/I, row 2, sign -1)
    //   z: posterior-to-anterior (physical A/P, row 1, sign +1)
    //
    // OME-Zarr metadata (from itkImageToNgffImage):
    //   scale = {x: 1, y: 1, z: 1}
    //   translation = {x: -127.05, y: 90.13, z: 54.54}
    //
    // Expected NIfTI affine (row-major):
    //   srow_x: [-1,   0,  0,  127.05]
    //   srow_y: [ 0,   0,  1,  -90.13]
    //   srow_z: [ 0,  -1,  0,   54.54]
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii
      const affine = createAffineFromOMEZarr(
        { x: 1, y: 1, z: 1 },
        { x: -127.05, y: 90.13, z: 54.54 },
      )
      applyOrientationToAffine(affine, {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "superior-to-inferior" },
        z: { type: "anatomical", value: "posterior-to-anterior" },
      })
      // Extract NIfTI-style row-major affine
      return {
        srow_x: [affine[0], affine[4], affine[8], affine[12]],
        srow_y: [affine[1], affine[5], affine[9], affine[13]],
        srow_z: [affine[2], affine[6], affine[10], affine[14]],
        row3: [affine[3], affine[7], affine[11], affine[15]],
      }
    })
    // srow_x: [-1, 0, 0, 127.05] — i moves right-to-left
    expect(result.srow_x[0]).toBeCloseTo(-1, 5)
    expect(result.srow_x[1] + 0).toBe(0)
    expect(result.srow_x[2] + 0).toBe(0)
    expect(result.srow_x[3]).toBeCloseTo(127.05, 2)
    // srow_y: [0, 0, 1, -90.13] — k moves posterior-to-anterior
    expect(result.srow_y[0] + 0).toBe(0)
    expect(result.srow_y[1] + 0).toBe(0)
    expect(result.srow_y[2]).toBeCloseTo(1, 5)
    expect(result.srow_y[3]).toBeCloseTo(-90.13, 2)
    // srow_z: [0, -1, 0, 54.54] — j moves superior-to-inferior
    expect(result.srow_z[0] + 0).toBe(0)
    expect(result.srow_z[1]).toBeCloseTo(-1, 5)
    expect(result.srow_z[2] + 0).toBe(0)
    expect(result.srow_z[3]).toBeCloseTo(54.54, 2)
    // Row 3: homogeneous
    expect(result.row3).toEqual([0, 0, 0, 1])
  })

  test("returns the same affine instance (in-place modification)", async ({
    page,
  }) => {
    const isSame = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii
      const affine = createAffineFromOMEZarr(
        { x: 1, y: 1, z: 1 },
        { x: 0, y: 0, z: 0 },
      )
      const returned = applyOrientationToAffine(affine, {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "anterior-to-posterior" },
        z: { type: "anatomical", value: "inferior-to-superior" },
      })
      return affine === returned
    })
    expect(isSame).toBe(true)
  })
})

test.describe("Orientation — LPS affine consistency with Python reference", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForFunction(() => (window as any).fidnii !== undefined, {
      timeout: 30000,
    })
  })

  test("LPS affine has correct row structure", async ({ page }) => {
    // Simulates the Python ome_zarr_to_nifti.py _build_affine() logic:
    // For LPS with scale=[2,3,4] and translation=[10,20,30]:
    // Python: affine[i,i] = -abs(scale[i]) for negative axes
    //   x: right-to-left -> negative -> affine[0,0] = -2
    //   y: anterior-to-posterior -> negative -> affine[1,1] = -3
    //   z: inferior-to-superior -> positive -> affine[2,2] = 4
    //
    // Our implementation also sign-flips translations for RAS output:
    //   tx = -1 * 10 = -10 (LPS x → RAS x)
    //   ty = -1 * 20 = -20 (LPS y → RAS y)
    //   tz = +1 * 30 = 30  (LPS z = RAS z)
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii
      const affine = createAffineFromOMEZarr(
        { x: 2, y: 3, z: 4 },
        { x: 10, y: 20, z: 30 },
      )
      applyOrientationToAffine(affine, {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "anterior-to-posterior" },
        z: { type: "anatomical", value: "inferior-to-superior" },
      })
      return {
        row0: [affine[0], affine[4], affine[8], affine[12]],
        row1: [affine[1], affine[5], affine[9], affine[13]],
        row2: [affine[2], affine[6], affine[10], affine[14]],
        row3: [affine[3], affine[7], affine[11], affine[15]],
      }
    })

    // Row 0 (x axis): scale negated, off-diagonals zero
    expect(result.row0[0]).toBe(-2)
    expect(result.row0[1] + 0).toBe(0)
    expect(result.row0[2] + 0).toBe(0)
    expect(result.row0[3]).toBe(-10)
    // Row 1 (y axis): scale negated, off-diagonals zero
    expect(result.row1[0] + 0).toBe(0)
    expect(result.row1[1]).toBe(-3)
    expect(result.row1[2] + 0).toBe(0)
    expect(result.row1[3]).toBe(-20)
    // Row 2 (z axis): scale positive, off-diagonals zero
    expect(result.row2[0] + 0).toBe(0)
    expect(result.row2[1] + 0).toBe(0)
    expect(result.row2[2]).toBe(4)
    expect(result.row2[3]).toBe(30)
    // Row 3: homogeneous
    expect(result.row3).toEqual([0, 0, 0, 1])
  })

  test("RAS affine is identical to no-orientation affine", async ({ page }) => {
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii

      const affineNoOrient = createAffineFromOMEZarr(
        { x: 2, y: 3, z: 4 },
        { x: 10, y: 20, z: 30 },
      )
      const noOrientArr = Array.from(affineNoOrient)

      const affineRAS = createAffineFromOMEZarr(
        { x: 2, y: 3, z: 4 },
        { x: 10, y: 20, z: 30 },
      )
      applyOrientationToAffine(affineRAS, {
        x: { type: "anatomical", value: "left-to-right" },
        y: { type: "anatomical", value: "posterior-to-anterior" },
        z: { type: "anatomical", value: "inferior-to-superior" },
      })
      const rasArr = Array.from(affineRAS)

      return { noOrientArr, rasArr }
    })

    // RAS is the default NIfTI convention, so applying RAS orientation
    // should produce the same affine as no orientation
    expect(result.rasArr).toEqual(result.noOrientArr)
  })

  test("single axis flip only affects that column and translation", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii

      // Only x is anti-RAS+
      const affine = createAffineFromOMEZarr(
        { x: 5, y: 7, z: 11 },
        { x: 1, y: 2, z: 3 },
      )
      applyOrientationToAffine(affine, {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "posterior-to-anterior" },
        z: { type: "anatomical", value: "inferior-to-superior" },
      })

      return {
        sx: affine[0],
        sy: affine[5],
        sz: affine[10],
        tx: affine[12],
        ty: affine[13],
        tz: affine[14],
      }
    })

    expect(result.sx).toBe(-5) // negated
    expect(result.sy).toBe(7) // unchanged
    expect(result.sz).toBe(11) // unchanged
    expect(result.tx).toBe(-1) // negated (sign flip for RAS)
    expect(result.ty).toBe(2) // unchanged
    expect(result.tz).toBe(3) // unchanged
  })
})

test.describe("Orientation — createAffineFromNgffImage integration", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })
  })

  test("affine from loaded image has correct structure", async ({ page }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const affine = image.hdr.affine

      return {
        rows: affine.length,
        cols: affine[0].length,
        lastRow: affine[3],
        // Check that at least one element per column is non-zero
        // (for permuted axes, diagonal may be zero)
        hasNonZeroColumns:
          Math.abs(affine[0][0]) +
            Math.abs(affine[1][0]) +
            Math.abs(affine[2][0]) >
            0 &&
          Math.abs(affine[0][1]) +
            Math.abs(affine[1][1]) +
            Math.abs(affine[2][1]) >
            0 &&
          Math.abs(affine[0][2]) +
            Math.abs(affine[1][2]) +
            Math.abs(affine[2][2]) >
            0,
      }
    })

    expect(result.rows).toBe(4)
    expect(result.cols).toBe(4)
    expect(result.lastRow).toEqual([0, 0, 0, 1])
    expect(result.hasNonZeroColumns).toBe(true)
  })

  test("pixDims remain positive regardless of orientation", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      return {
        pixDim1: image.hdr.pixDims[1],
        pixDim2: image.hdr.pixDims[2],
        pixDim3: image.hdr.pixDims[3],
      }
    })

    // pixDims should always be positive per NIfTI spec
    expect(result.pixDim1).toBeGreaterThan(0)
    expect(result.pixDim2).toBeGreaterThan(0)
    expect(result.pixDim3).toBeGreaterThan(0)
  })

  test("orientation metadata is accessible on multiscales images", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const image = (window as any).image
      const firstImage = image.multiscales.images[0]

      return {
        hasAxesOrientations: firstImage.axesOrientations !== undefined,
        axesOrientations: firstImage.axesOrientations ?? null,
      }
    })

    // The test dataset may or may not have orientations. We just verify
    // the property is accessible and is either null/undefined or a proper object.
    if (result.hasAxesOrientations) {
      expect(result.axesOrientations).toBeTruthy()
      expect(typeof result.axesOrientations).toBe("object")
    } else {
      expect(result.axesOrientations).toBeNull()
    }
  })
})

test.describe("Orientation — placeholder affine", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })
  })

  test("orientation signs are valid for loaded dataset", async ({ page }) => {
    // Verifies that the getOrientationSigns function returns valid signs
    // for the loaded dataset's orientation metadata. The placeholder
    // affine is overwritten during loading, but the signs should be
    // consistent with the first image's orientations.
    const result = await page.evaluate(() => {
      const { getOrientationSigns } = (window as any).fidnii
      const image = (window as any).image
      const firstImage = image.multiscales.images[0]
      const signs = getOrientationSigns(firstImage.axesOrientations)

      return {
        signs,
        hasOrientations: firstImage.axesOrientations !== undefined,
      }
    })

    // Verify signs are valid
    expect([1, -1]).toContain(result.signs.x)
    expect([1, -1]).toContain(result.signs.y)
    expect([1, -1]).toContain(result.signs.z)
  })
})
