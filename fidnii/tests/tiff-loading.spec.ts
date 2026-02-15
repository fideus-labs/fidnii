// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { expect, test } from "@playwright/test"

test.describe("TIFF Loading", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    // Wait for the base page to load (ensures NiiVue is ready)
    await expect(page.locator("#gl")).toBeVisible()
    // Wait for test-page main.ts module to execute and expose fidnii on window
    await page.waitForFunction(() => (window as any).fidnii !== undefined, {
      timeout: 30000,
    })
  })

  test("fromTiff is exported and exposed on window", async ({ page }) => {
    const hasFromTiff = await page.evaluate(() => {
      return typeof (window as any).fidnii.fromTiff === "function"
    })
    expect(hasFromTiff).toBe(true)
  })

  test("TiffStore is exported and exposed on window", async ({ page }) => {
    const hasTiffStore = await page.evaluate(() => {
      return typeof (window as any).fidnii.TiffStore === "function"
    })
    expect(hasTiffStore).toBe(true)
  })

  test("fromTiff loads an in-memory TIFF ArrayBuffer", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { fromTiff, buildTiff, makeImageTags } = (window as any).fidnii

      // Create a 32x32 uint8 grayscale test image
      const width = 32
      const height = 32
      const strip = new Uint8Array(width * height)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          strip[y * width + x] = (x + y) % 256
        }
      }

      // sampleFormat=1 (uint), bitsPerSample=8
      const tags = makeImageTags(width, height, 8, 1)
      const buffer = await buildTiff([{ tags, tiles: [strip] }])

      // Load via fromTiff
      const multiscales = await fromTiff(buffer)

      return {
        numImages: multiscales.images.length,
        hasMetadata: multiscales.metadata !== undefined,
        firstImageDims: multiscales.images[0].dims,
        firstImageShape: multiscales.images[0].data.shape,
      }
    })

    expect(result.numImages).toBeGreaterThanOrEqual(1)
    expect(result.hasMetadata).toBe(true)
    expect(result.firstImageDims).toContain("y")
    expect(result.firstImageDims).toContain("x")
    // 32x32 image
    expect(result.firstImageShape).toContain(32)
  })

  test("fromTiff loads a Blob", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { fromTiff, buildTiff, makeImageTags } = (window as any).fidnii

      const width = 16
      const height = 16
      const strip = new Uint8Array(width * height)
      const tags = makeImageTags(width, height, 8, 1)
      const buffer = await buildTiff([{ tags, tiles: [strip] }])

      // Convert to Blob and load
      const blob = new Blob([buffer], { type: "image/tiff" })
      const multiscales = await fromTiff(blob)

      return {
        numImages: multiscales.images.length,
        firstImageShape: multiscales.images[0].data.shape,
      }
    })

    expect(result.numImages).toBeGreaterThanOrEqual(1)
    expect(result.firstImageShape).toContain(16)
  })

  test("fromTiff with ArrayBuffer produces correct pixel data", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const { fromTiff, buildTiff, makeImageTags } = (window as any).fidnii

      const width = 32
      const height = 32
      const strip = new Uint8Array(width * height)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          strip[y * width + x] = (x + y) % 256
        }
      }
      const tags = makeImageTags(width, height, 8, 1)
      const buffer = await buildTiff([{ tags, tiles: [strip] }])

      const multiscales = await fromTiff(buffer)
      const image = multiscales.images[0]

      // Read pixel data through the zarr array
      const chunk = await image.data.getChunk([0, 0])
      const data = chunk.data as Uint8Array

      return {
        dtype: image.data.dtype,
        firstPixel: data[0],
        secondPixel: data[1],
        dataLength: data.length,
      }
    })

    expect(result.dtype).toBe("uint8")
    // Gradient pattern: (0+0)%256=0, (1+0)%256=1
    expect(result.firstPixel).toBe(0)
    expect(result.secondPixel).toBe(1)
    expect(result.dataLength).toBeGreaterThan(0)
  })

  test("fromTiff produces valid Multiscales for OMEZarrNVImage", async ({
    page,
  }) => {
    // This is the key integration test: verify that fromTiff produces
    // a Multiscales object that OMEZarrNVImage.create() can accept.
    const result = await page.evaluate(async () => {
      const { fromTiff, buildTiff, makeImageTags } = (window as any).fidnii

      // Create a test image
      const width = 64
      const height = 64
      const strip = new Uint8Array(width * height)
      for (let i = 0; i < strip.length; i++) {
        strip[i] = i % 256
      }
      const tags = makeImageTags(width, height, 8, 1)
      const buffer = await buildTiff([{ tags, tiles: [strip] }])

      const multiscales = await fromTiff(buffer)

      // Verify the multiscales has the right structure
      const metadata = multiscales.metadata
      const axes = metadata.axes
      const datasets = metadata.datasets

      return {
        numImages: multiscales.images.length,
        axisNames: axes.map((a: { name: string }) => a.name),
        numDatasets: datasets.length,
        datasetPath: datasets[0].path,
        hasCoordTransforms: datasets[0].coordinateTransformations !== undefined,
        imageShape: multiscales.images[0].data.shape,
        imageDtype: multiscales.images[0].data.dtype,
      }
    })

    expect(result.numImages).toBeGreaterThanOrEqual(1)
    expect(result.axisNames).toContain("y")
    expect(result.axisNames).toContain("x")
    expect(result.numDatasets).toBeGreaterThanOrEqual(1)
    expect(result.datasetPath).toBe("0")
    expect(result.hasCoordTransforms).toBe(true)
    expect(result.imageShape).toContain(64)
    expect(result.imageDtype).toBe("uint8")
  })

  test("fromTiff rejects invalid source type", async ({ page }) => {
    const threw = await page.evaluate(async () => {
      const { fromTiff } = (window as any).fidnii
      try {
        await fromTiff(42)
        return false
      } catch {
        return true
      }
    })
    expect(threw).toBe(true)
  })
})
