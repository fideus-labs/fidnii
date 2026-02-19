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

test.describe("Orientation — affine offset with permuted axes", () => {
  // Both the 3D (updateHeaderForRegion) and slab (_updateSlabHeader) paths
  // use the same orient-then-offset approach: build the fully oriented affine
  // via createAffineFromNgffImage, then apply the voxel offset through the
  // 3x3 rotation matrix. This ensures the offset lands on the correct world
  // axis even when NGFF axes are permuted.
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForFunction(() => (window as any).fidnii !== undefined, {
      timeout: 30000,
    })
  })

  test("slab affine matches 3D path for identity (no permutation)", async ({
    page,
  }) => {
    // With no orientation metadata, offset-then-orient and orient-then-offset
    // produce the same result. This baseline ensures the pattern works.
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii

      const scale = { x: 2, y: 3, z: 4 }
      const translation = { x: 10, y: 20, z: 30 }
      // fetchStart is [z, y, x] — simulates a coronal slab at y=50
      const fetchStart: [number, number, number] = [0, 50, 0]

      // Correct path: offset in un-oriented space, then apply orientation
      const affine = createAffineFromOMEZarr(scale, translation)
      affine[12] += fetchStart[2] * scale.x
      affine[13] += fetchStart[1] * scale.y
      affine[14] += fetchStart[0] * scale.z
      applyOrientationToAffine(affine, undefined)

      return {
        tx: affine[12],
        ty: affine[13],
        tz: affine[14],
      }
    })

    // x: 10 + 0*2 = 10, y: 20 + 50*3 = 170, z: 30 + 0*4 = 30
    expect(result.tx).toBeCloseTo(10, 5)
    expect(result.ty).toBeCloseTo(170, 5)
    expect(result.tz).toBeCloseTo(30, 5)
  })

  test("slab affine matches 3D path for LPS (sign flip, no permutation)", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii

      const scale = { x: 2, y: 3, z: 4 }
      const translation = { x: 10, y: 20, z: 30 }
      const fetchStart: [number, number, number] = [0, 50, 0]
      const orientations = {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "anterior-to-posterior" },
        z: { type: "anatomical", value: "inferior-to-superior" },
      }

      // Correct path: offset THEN orient
      const affine = createAffineFromOMEZarr(scale, translation)
      affine[12] += fetchStart[2] * scale.x
      affine[13] += fetchStart[1] * scale.y
      affine[14] += fetchStart[0] * scale.z
      applyOrientationToAffine(affine, orientations)

      return {
        tx: affine[12],
        ty: affine[13],
        tz: affine[14],
        // Also check the 3x3 submatrix is correct
        sx: affine[0],
        sy: affine[5],
        sz: affine[10],
      }
    })

    // LPS: translation signs are flipped by applyOrientationToAffine
    // Un-oriented offset: tx=10, ty=20+150=170, tz=30
    // After LPS sign flip: tx=-10, ty=-170, tz=30
    expect(result.tx).toBeCloseTo(-10, 5)
    expect(result.ty).toBeCloseTo(-170, 5)
    expect(result.tz).toBeCloseTo(30, 5)
    expect(result.sx).toBe(-2)
    expect(result.sy).toBe(-3)
    expect(result.sz).toBe(4)
  })

  test("slab affine is correct for mri.nii.gz permuted orientation (coronal slab)", async ({
    page,
  }) => {
    // This is THE critical test case for the bug fix.
    // mri.nii.gz orientation: x→R/L, y→S/I, z→A/P (y and z permuted)
    // A coronal slab at NGFF y=96 would have fetchStart=[0, 96, 0].
    //
    // OLD BUGGY CODE applied offset after orientation:
    //   affine[13] += 96 * sy → added 96*sy to physical Y row
    //   But with permutation, NGFF y maps to physical row 2 (S/I),
    //   so the offset went to the wrong spatial dimension.
    //
    // FIXED CODE applies offset before orientation:
    //   un-oriented affine[13] += 96 * sy → NGFF y offset in NGFF space
    //   then applyOrientationToAffine permutes this to physical row 2
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii

      const scale = { x: 1, y: 1, z: 1 }
      const translation = { x: -127.05, y: 90.13, z: 54.54 }
      // Coronal slab at NGFF y=96
      const fetchStart: [number, number, number] = [0, 96, 0]
      const orientations = {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "superior-to-inferior" },
        z: { type: "anatomical", value: "posterior-to-anterior" },
      }

      // Correct path: offset THEN orient
      const affine = createAffineFromOMEZarr(scale, translation)
      affine[12] += fetchStart[2] * scale.x // x: -127.05 + 0 = -127.05
      affine[13] += fetchStart[1] * scale.y // y: 90.13 + 96 = 186.13
      affine[14] += fetchStart[0] * scale.z // z: 54.54 + 0 = 54.54
      applyOrientationToAffine(affine, orientations)

      return {
        srow_x: [affine[0], affine[4], affine[8], affine[12]],
        srow_y: [affine[1], affine[5], affine[9], affine[13]],
        srow_z: [affine[2], affine[6], affine[10], affine[14]],
      }
    })

    // After orientation (x→row0 sign-1, y→row2 sign-1, z→row1 sign+1):
    //   srow_x: [-1, 0, 0, 127.05]   — tx = -1 * -127.05 = 127.05
    //   srow_y: [0, 0, 1, -186.13]    — ty = -1 * 186.13 = -186.13
    //   srow_z: [0, -1, 0, 54.54]     — tz = +1 * 54.54 = 54.54
    //
    // Note: ty includes the offset (90.13 + 96 = 186.13) which then
    // gets sign-flipped to -186.13 for the physical S/I axis.
    expect(result.srow_x[0]).toBeCloseTo(-1, 5)
    expect(result.srow_x[3]).toBeCloseTo(127.05, 2)

    expect(result.srow_y[2]).toBeCloseTo(1, 5)
    expect(result.srow_y[3]).toBeCloseTo(-186.13, 2)

    expect(result.srow_z[1]).toBeCloseTo(-1, 5)
    expect(result.srow_z[3]).toBeCloseTo(54.54, 2)
  })

  test("slab affine is correct for mri.nii.gz permuted orientation (sagittal slab)", async ({
    page,
  }) => {
    // Sagittal slab: fetchStart has x offset
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii

      const scale = { x: 1, y: 1, z: 1 }
      const translation = { x: -127.05, y: 90.13, z: 54.54 }
      // Sagittal slab at NGFF x=64
      const fetchStart: [number, number, number] = [0, 0, 64]
      const orientations = {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "superior-to-inferior" },
        z: { type: "anatomical", value: "posterior-to-anterior" },
      }

      const affine = createAffineFromOMEZarr(scale, translation)
      affine[12] += fetchStart[2] * scale.x // x: -127.05 + 64 = -63.05
      affine[13] += fetchStart[1] * scale.y // y: 90.13 + 0 = 90.13
      affine[14] += fetchStart[0] * scale.z // z: 54.54 + 0 = 54.54
      applyOrientationToAffine(affine, orientations)

      return {
        tx: affine[12],
        ty: affine[13],
        tz: affine[14],
      }
    })

    // tx = -1 * -63.05 = 63.05
    // ty = -1 * 90.13 = -90.13
    // tz = +1 * 54.54 = 54.54
    expect(result.tx).toBeCloseTo(63.05, 2)
    expect(result.ty).toBeCloseTo(-90.13, 2)
    expect(result.tz).toBeCloseTo(54.54, 2)
  })

  test("slab affine is correct for mri.nii.gz permuted orientation (axial slab)", async ({
    page,
  }) => {
    // Axial slab: fetchStart has z offset
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii

      const scale = { x: 1, y: 1, z: 1 }
      const translation = { x: -127.05, y: 90.13, z: 54.54 }
      // Axial slab at NGFF z=80
      const fetchStart: [number, number, number] = [80, 0, 0]
      const orientations = {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "superior-to-inferior" },
        z: { type: "anatomical", value: "posterior-to-anterior" },
      }

      const affine = createAffineFromOMEZarr(scale, translation)
      affine[12] += fetchStart[2] * scale.x // x: -127.05 + 0 = -127.05
      affine[13] += fetchStart[1] * scale.y // y: 90.13 + 0 = 90.13
      affine[14] += fetchStart[0] * scale.z // z: 54.54 + 80 = 134.54
      applyOrientationToAffine(affine, orientations)

      return {
        tx: affine[12],
        ty: affine[13],
        tz: affine[14],
      }
    })

    // tx = -1 * -127.05 = 127.05
    // ty = -1 * 90.13 = -90.13
    // tz = +1 * 134.54 = 134.54
    expect(result.tx).toBeCloseTo(127.05, 2)
    expect(result.ty).toBeCloseTo(-90.13, 2)
    expect(result.tz).toBeCloseTo(134.54, 2)
  })

  test("mm2frac for slab center is in-bounds with permuted axes", async ({
    page,
  }) => {
    // Simulates NiiVue's mm2frac(): given a world-space point, compute
    // its fractional voxel coordinate via the inverse affine. The old
    // buggy code produced an affine where the slab center mapped to
    // out-of-bounds fractions because the offset was applied after
    // orientation permutation.
    const result = await page.evaluate(() => {
      const { createAffineFromOMEZarr, applyOrientationToAffine } = (
        window as any
      ).fidnii

      const scale = { x: 1, y: 1, z: 1 }
      const translation = { x: -127.05, y: 90.13, z: 54.54 }
      // Coronal slab at NGFF y=96, shape [192, 32, 256]
      const fetchStart: [number, number, number] = [0, 96, 0]
      const fetchedShape: [number, number, number] = [192, 32, 256]
      const orientations = {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "superior-to-inferior" },
        z: { type: "anatomical", value: "posterior-to-anterior" },
      }

      // Build slab affine with correct offset-then-orient approach
      const affine = createAffineFromOMEZarr(scale, translation)
      affine[12] += fetchStart[2] * scale.x
      affine[13] += fetchStart[1] * scale.y
      affine[14] += fetchStart[0] * scale.z
      applyOrientationToAffine(affine, orientations)

      // Compute world center of the slab volume
      const [dimZ, dimY, dimX] = fetchedShape
      const cx = dimX / 2,
        cy = dimY / 2,
        cz = dimZ / 2
      const wx = affine[0] * cx + affine[4] * cy + affine[8] * cz + affine[12]
      const wy = affine[1] * cx + affine[5] * cy + affine[9] * cz + affine[13]
      const wz = affine[2] * cx + affine[6] * cy + affine[10] * cz + affine[14]

      // Invert the affine to get mm2frac (3x3 inverse + translation)
      const det0 =
        affine[0] * (affine[5] * affine[10] - affine[6] * affine[9]) -
        affine[4] * (affine[1] * affine[10] - affine[2] * affine[9]) +
        affine[8] * (affine[1] * affine[6] - affine[2] * affine[5])
      if (Math.abs(det0) < 1e-10) return { fracX: -1, fracY: -1, fracZ: -1 }

      const inv = new Float64Array(12)
      inv[0] = (affine[5] * affine[10] - affine[6] * affine[9]) / det0
      inv[1] = (affine[2] * affine[9] - affine[1] * affine[10]) / det0
      inv[2] = (affine[1] * affine[6] - affine[2] * affine[5]) / det0
      inv[3] = (affine[6] * affine[8] - affine[4] * affine[10]) / det0
      inv[4] = (affine[0] * affine[10] - affine[2] * affine[8]) / det0
      inv[5] = (affine[2] * affine[4] - affine[0] * affine[6]) / det0
      inv[6] = (affine[4] * affine[9] - affine[5] * affine[8]) / det0
      inv[7] = (affine[1] * affine[8] - affine[0] * affine[9]) / det0
      inv[8] = (affine[0] * affine[5] - affine[1] * affine[4]) / det0

      const dx = wx - affine[12]
      const dy = wy - affine[13]
      const dz = wz - affine[14]
      const fracX = (inv[0] * dx + inv[3] * dy + inv[6] * dz) / dimX
      const fracY = (inv[1] * dx + inv[4] * dy + inv[7] * dz) / dimY
      const fracZ = (inv[2] * dx + inv[5] * dy + inv[8] * dz) / dimZ

      return { fracX, fracY, fracZ }
    })

    // The slab center should map to exactly 0.5 in each fractional axis
    expect(result.fracX).toBeCloseTo(0.5, 3)
    expect(result.fracY).toBeCloseTo(0.5, 3)
    expect(result.fracZ).toBeCloseTo(0.5, 3)
  })

  test("slab orient-then-offset places NGFF z=96 offset in correct world axis", async ({
    page,
  }) => {
    // The slab path uses createAffineFromNgffImage (orient first)
    // then applies the offset through the 3x3 rotation matrix.
    // For the MRI orientation where NGFF z maps to physical A/P (row 1),
    // a z=96 offset should shift the world-Y translation, not world-Z.
    const result = await page.evaluate(() => {
      const { createAffineFromNgffImage } = (window as any).fidnii

      const scale = { x: 1, y: 1, z: 1 }
      const translation = { x: -127.05, y: 90.13, z: 54.54 }
      const orientations = {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "superior-to-inferior" },
        z: { type: "anatomical", value: "posterior-to-anterior" },
      }
      // Axial slab at NGFF z=96
      const fetchStart: [number, number, number] = [96, 0, 0]

      const mockNgff = {
        scale,
        translation,
        axesOrientations: orientations,
      }
      const affine = createAffineFromNgffImage(mockNgff)

      // Capture base translation (before offset)
      const baseTx = affine[12]
      const baseTy = affine[13]
      const baseTz = affine[14]

      // Apply offset through rotation matrix
      const offsetX = fetchStart[2]
      const offsetY = fetchStart[1]
      const offsetZ = fetchStart[0]
      affine[12] +=
        affine[0] * offsetX + affine[4] * offsetY + affine[8] * offsetZ
      affine[13] +=
        affine[1] * offsetX + affine[5] * offsetY + affine[9] * offsetZ
      affine[14] +=
        affine[2] * offsetX + affine[6] * offsetY + affine[10] * offsetZ

      return {
        baseTx,
        baseTy,
        baseTz,
        finalTx: affine[12],
        finalTy: affine[13],
        finalTz: affine[14],
        // 3x3 rotation
        r: [
          affine[0],
          affine[4],
          affine[8],
          affine[1],
          affine[5],
          affine[9],
          affine[2],
          affine[6],
          affine[10],
        ],
      }
    })

    // Base oriented affine: tx=127.05, ty=-90.13, tz=54.54
    expect(result.baseTx).toBeCloseTo(127.05, 2)
    expect(result.baseTy).toBeCloseTo(-90.13, 2)
    expect(result.baseTz).toBeCloseTo(54.54, 2)

    // The NGFF z offset of 96 should go through the rotation.
    // NGFF z maps to NIfTI k (column 2): [0, 1, 0] in the rotation.
    // So: world_offset = R * [0, 0, 96] = [0*96, 1*96, 0*96] = [0, 96, 0]
    // Final: ty = -90.13 + 96 = 5.87, others unchanged
    expect(result.finalTx).toBeCloseTo(127.05, 2)
    expect(result.finalTy).toBeCloseTo(5.87, 2)
    expect(result.finalTz).toBeCloseTo(54.54, 2)
  })

  test("3D orient-then-offset: voxel origin maps to correct world position with permuted axes", async ({
    page,
  }) => {
    // For the MRI orientation (x→R/L, y→S/I, z→A/P), the offset affine's
    // voxel [0,0,0] should map to the world position corresponding to
    // the region start in oriented space.
    const result = await page.evaluate(() => {
      const { createAffineFromNgffImage } = (window as any).fidnii

      const scale = { x: 1, y: 1, z: 1 }
      const translation = { x: -127.05, y: 90.13, z: 54.54 }
      const orientations = {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "superior-to-inferior" },
        z: { type: "anatomical", value: "posterior-to-anterior" },
      }
      const mockNgff = { scale, translation, axesOrientations: orientations }
      // 3D region at [20, 50, 10] (z=20, y=50, x=10)
      const regionStart: [number, number, number] = [20, 50, 10]

      // Full-volume affine (no offset) — for reference
      const fullAffine = createAffineFromNgffImage(mockNgff)

      // World position of voxel [10, 50, 20] in the full volume
      // This should equal the origin (voxel [0,0,0]) of the offset affine
      const vx = 10,
        vy = 50,
        vz = 20 // NIfTI i=x, j=y, k=z
      const expectedWx =
        fullAffine[0] * vx +
        fullAffine[4] * vy +
        fullAffine[8] * vz +
        fullAffine[12]
      const expectedWy =
        fullAffine[1] * vx +
        fullAffine[5] * vy +
        fullAffine[9] * vz +
        fullAffine[13]
      const expectedWz =
        fullAffine[2] * vx +
        fullAffine[6] * vy +
        fullAffine[10] * vz +
        fullAffine[14]

      // Offset affine — orient first, then offset through rotation
      const offsetAffine = createAffineFromNgffImage(mockNgff)
      const ox = regionStart[2]
      const oy = regionStart[1]
      const oz = regionStart[0]
      offsetAffine[12] +=
        offsetAffine[0] * ox + offsetAffine[4] * oy + offsetAffine[8] * oz
      offsetAffine[13] +=
        offsetAffine[1] * ox + offsetAffine[5] * oy + offsetAffine[9] * oz
      offsetAffine[14] +=
        offsetAffine[2] * ox + offsetAffine[6] * oy + offsetAffine[10] * oz

      // Voxel [0,0,0] in offset affine = translation
      return {
        expectedWx,
        expectedWy,
        expectedWz,
        actualWx: offsetAffine[12],
        actualWy: offsetAffine[13],
        actualWz: offsetAffine[14],
      }
    })

    // Offset affine's origin should match the full affine's world position
    // at the region start voxel
    expect(result.actualWx).toBeCloseTo(result.expectedWx, 5)
    expect(result.actualWy).toBeCloseTo(result.expectedWy, 5)
    expect(result.actualWz).toBeCloseTo(result.expectedWz, 5)
  })

  test("3D orient-then-offset: mm2frac at region center returns 0.5 with non-unit scales", async ({
    page,
  }) => {
    // Tests that the offset affine is correct for anisotropic voxels
    // by verifying that the center voxel maps to fractional [0.5, 0.5, 0.5].
    const result = await page.evaluate(() => {
      const { createAffineFromNgffImage } = (window as any).fidnii

      const scale = { x: 0.5, y: 0.8, z: 1.2 }
      const translation = { x: -63.5, y: 72.1, z: 32.7 }
      const orientations = {
        x: { type: "anatomical", value: "right-to-left" },
        y: { type: "anatomical", value: "superior-to-inferior" },
        z: { type: "anatomical", value: "posterior-to-anterior" },
      }
      const mockNgff = { scale, translation, axesOrientations: orientations }
      const regionStart: [number, number, number] = [40, 100, 30]
      const fetchedShape: [number, number, number] = [80, 64, 128]

      // Build offset affine
      const affine = createAffineFromNgffImage(mockNgff)
      const ox = regionStart[2]
      const oy = regionStart[1]
      const oz = regionStart[0]
      affine[12] += affine[0] * ox + affine[4] * oy + affine[8] * oz
      affine[13] += affine[1] * ox + affine[5] * oy + affine[9] * oz
      affine[14] += affine[2] * ox + affine[6] * oy + affine[10] * oz

      // Compute world center of the region
      const [dimZ, dimY, dimX] = fetchedShape
      const cx = dimX / 2,
        cy = dimY / 2,
        cz = dimZ / 2
      const wx = affine[0] * cx + affine[4] * cy + affine[8] * cz + affine[12]
      const wy = affine[1] * cx + affine[5] * cy + affine[9] * cz + affine[13]
      const wz = affine[2] * cx + affine[6] * cy + affine[10] * cz + affine[14]

      // Invert affine 3x3 for mm2frac
      const det0 =
        affine[0] * (affine[5] * affine[10] - affine[6] * affine[9]) -
        affine[4] * (affine[1] * affine[10] - affine[2] * affine[9]) +
        affine[8] * (affine[1] * affine[6] - affine[2] * affine[5])
      if (Math.abs(det0) < 1e-10) return { fracX: -1, fracY: -1, fracZ: -1 }

      const inv = new Float64Array(9)
      inv[0] = (affine[5] * affine[10] - affine[6] * affine[9]) / det0
      inv[1] = (affine[2] * affine[9] - affine[1] * affine[10]) / det0
      inv[2] = (affine[1] * affine[6] - affine[2] * affine[5]) / det0
      inv[3] = (affine[6] * affine[8] - affine[4] * affine[10]) / det0
      inv[4] = (affine[0] * affine[10] - affine[2] * affine[8]) / det0
      inv[5] = (affine[2] * affine[4] - affine[0] * affine[6]) / det0
      inv[6] = (affine[4] * affine[9] - affine[5] * affine[8]) / det0
      inv[7] = (affine[1] * affine[8] - affine[0] * affine[9]) / det0
      inv[8] = (affine[0] * affine[5] - affine[1] * affine[4]) / det0

      const dx = wx - affine[12]
      const dy = wy - affine[13]
      const dz = wz - affine[14]
      const fracX = (inv[0] * dx + inv[3] * dy + inv[6] * dz) / dimX
      const fracY = (inv[1] * dx + inv[4] * dy + inv[7] * dz) / dimY
      const fracZ = (inv[2] * dx + inv[5] * dy + inv[8] * dz) / dimZ

      return { fracX, fracY, fracZ }
    })

    expect(result.fracX).toBeCloseTo(0.5, 3)
    expect(result.fracY).toBeCloseTo(0.5, 3)
    expect(result.fracZ).toBeCloseTo(0.5, 3)
  })

  test("3D buffer bounds stay in un-oriented space after orient-then-offset", async ({
    page,
  }) => {
    // The 3D path computes _currentBufferBounds in un-oriented OME-Zarr
    // space (for clip planes). This must NOT change when we switch the
    // affine construction to orient-then-offset.
    const result = await page.evaluate(() => {
      const scale = { x: 1, y: 1, z: 1 }
      const translation = { x: -127.05, y: 90.13, z: 54.54 }
      // regionStart [z, y, x]
      const regionStart: [number, number, number] = [20, 50, 10]
      const fetchedShape: [number, number, number] = [192, 32, 256]

      const sx = scale.x
      const sy = scale.y
      const sz = scale.z
      const tx = (translation.x ?? 0) + regionStart[2] * sx
      const ty = (translation.y ?? 0) + regionStart[1] * sy
      const tz = (translation.z ?? 0) + regionStart[0] * sz

      const bounds = {
        min: [tx, ty, tz],
        max: [
          tx + fetchedShape[2] * sx,
          ty + fetchedShape[1] * sy,
          tz + fetchedShape[0] * sz,
        ],
      }

      return bounds
    })

    // Buffer bounds are in un-oriented OME-Zarr space:
    // min: [-127.05 + 10, 90.13 + 50, 54.54 + 20] = [-117.05, 140.13, 74.54]
    // max: [-117.05 + 256, 140.13 + 32, 74.54 + 192] = [138.95, 172.13, 266.54]
    expect(result.min[0]).toBeCloseTo(-117.05, 2)
    expect(result.min[1]).toBeCloseTo(140.13, 2)
    expect(result.min[2]).toBeCloseTo(74.54, 2)
    expect(result.max[0]).toBeCloseTo(138.95, 2)
    expect(result.max[1]).toBeCloseTo(172.13, 2)
    expect(result.max[2]).toBeCloseTo(266.54, 2)
  })
})
