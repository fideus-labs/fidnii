// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { expect, test } from "@playwright/test"

test.describe("RGB Support — getChannelInfo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("detects channel dim in 2D RGBA image (dims=[y, x, c])", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 4], chunks: [480, 640, 4] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.getChannelInfo(img as any)
    })

    expect(result).toEqual({ channelAxis: 2, components: 4 })
  })

  test("detects channel dim in 2D RGB image (dims=[y, x, c])", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 3], chunks: [480, 640, 3] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.getChannelInfo(img as any)
    })

    expect(result).toEqual({ channelAxis: 2, components: 3 })
  })

  test("detects channel dim in 3D RGB image (dims=[z, y, x, c])", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["z", "y", "x", "c"],
        data: { shape: [10, 480, 640, 3], chunks: [10, 480, 640, 3] },
        scale: { z: 1, y: 1, x: 1, c: 1 },
        translation: { z: 0, y: 0, x: 0, c: 0 },
      }
      return window.fidnii.getChannelInfo(img as any)
    })

    expect(result).toEqual({ channelAxis: 3, components: 3 })
  })

  test("returns null for standard 3D image (dims=[z, y, x])", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["z", "y", "x"],
        data: { shape: [96, 96, 96], chunks: [48, 48, 48] },
        scale: { z: 1, y: 1, x: 1 },
        translation: { z: 0, y: 0, x: 0 },
      }
      return window.fidnii.getChannelInfo(img as any)
    })

    expect(result).toBeNull()
  })

  test("returns null for 2D image without channel (dims=[y, x])", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x"],
        data: { shape: [480, 640], chunks: [480, 640] },
        scale: { y: 1, x: 1 },
        translation: { y: 0, x: 0 },
      }
      return window.fidnii.getChannelInfo(img as any)
    })

    expect(result).toBeNull()
  })
})

test.describe("RGB Support — isRGBImage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("returns true for uint8 RGBA image", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 4], chunks: [480, 640, 4] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.isRGBImage(img as any)
    })

    expect(result).toBe(true)
  })

  test("returns true for uint8 RGB image", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 3], chunks: [480, 640, 3] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.isRGBImage(img as any)
    })

    expect(result).toBe(true)
  })

  test("returns true for float32 RGB image (any dtype)", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 3], chunks: [480, 640, 3] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.isRGBImage(img as any)
    })

    expect(result).toBe(true)
  })

  test("returns true for uint16 RGBA image (any dtype)", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 4], chunks: [480, 640, 4] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.isRGBImage(img as any)
    })

    expect(result).toBe(true)
  })

  test("returns false for 2 components", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 2], chunks: [480, 640, 2] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.isRGBImage(img as any)
    })

    expect(result).toBe(false)
  })

  test("returns false for image without channel dim", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["z", "y", "x"],
        data: { shape: [96, 96, 96], chunks: [48, 48, 48] },
        scale: { z: 1, y: 1, x: 1 },
        translation: { z: 0, y: 0, x: 0 },
      }
      return window.fidnii.isRGBImage(img as any)
    })

    expect(result).toBe(false)
  })
})

test.describe("RGB Support — getRGBNiftiDataType", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("returns RGB24 for 3 components", async ({ page }) => {
    const result = await page.evaluate(() => {
      const { getRGBNiftiDataType, NiftiDataType } = window.fidnii
      const code = getRGBNiftiDataType({
        channelAxis: 2,
        components: 3,
      })
      return { code, expected: NiftiDataType.RGB24 }
    })

    expect(result.code).toBe(result.expected)
    expect(result.code).toBe(128)
  })

  test("returns RGBA32 for 4 components", async ({ page }) => {
    const result = await page.evaluate(() => {
      const { getRGBNiftiDataType, NiftiDataType } = window.fidnii
      const code = getRGBNiftiDataType({
        channelAxis: 2,
        components: 4,
      })
      return { code, expected: NiftiDataType.RGBA32 }
    })

    expect(result.code).toBe(result.expected)
    expect(result.code).toBe(2304)
  })

  test("returns RGB24 for 3 components regardless of dtype", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const { getRGBNiftiDataType, NiftiDataType } = window.fidnii
      // Even for float32 source, NIfTI code is always RGB24
      const code = getRGBNiftiDataType({
        channelAxis: 2,
        components: 3,
      })
      return { code, expected: NiftiDataType.RGB24 }
    })

    expect(result.code).toBe(result.expected)
  })

  test("throws for 5 components", async ({ page }) => {
    const error = await page.evaluate(() => {
      try {
        window.fidnii.getRGBNiftiDataType({
          channelAxis: 2,
          components: 5,
        })
        return null
      } catch (e: any) {
        return e.message
      }
    })

    expect(error).toContain("Unsupported multi-component image")
  })
})

test.describe("RGB Support — needsRGBNormalization", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("returns false for uint8 RGB (no normalization needed)", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 3], chunks: [480, 640, 3] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.needsRGBNormalization(img as any, "uint8")
    })

    expect(result).toBe(false)
  })

  test("returns true for uint16 RGB", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 3], chunks: [480, 640, 3] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.needsRGBNormalization(img as any, "uint16")
    })

    expect(result).toBe(true)
  })

  test("returns true for float32 RGBA", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 4], chunks: [480, 640, 4] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.needsRGBNormalization(img as any, "float32")
    })

    expect(result).toBe(true)
  })

  test("returns false for scalar image (no channel dim)", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["z", "y", "x"],
        data: { shape: [96, 96, 96], chunks: [48, 48, 48] },
        scale: { z: 1, y: 1, x: 1 },
        translation: { z: 0, y: 0, x: 0 },
      }
      return window.fidnii.needsRGBNormalization(img as any, "float32")
    })

    expect(result).toBe(false)
  })

  test("returns false for 2-component (not RGB/RGBA)", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 2], chunks: [480, 640, 2] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.needsRGBNormalization(img as any, "uint16")
    })

    expect(result).toBe(false)
  })
})

test.describe("RGB Support — normalizeToUint8", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("normalizes uint16 RGB to uint8 using channel windows", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const src = new Uint16Array([0, 32768, 65535, 65535, 0, 32768])
      const windows = [
        { start: 0, end: 65535 },
        { start: 0, end: 65535 },
        { start: 0, end: 65535 },
      ]
      const out = window.fidnii.normalizeToUint8(src, 3, windows)
      return Array.from(out)
    })

    // [0, 32768, 65535] → [0, ~128, 255]
    expect(result[0]).toBe(0)
    expect(result[1]).toBeGreaterThanOrEqual(127)
    expect(result[1]).toBeLessThanOrEqual(128)
    expect(result[2]).toBe(255)
    // [65535, 0, 32768] → [255, 0, ~128]
    expect(result[3]).toBe(255)
    expect(result[4]).toBe(0)
    expect(result[5]).toBeGreaterThanOrEqual(127)
    expect(result[5]).toBeLessThanOrEqual(128)
  })

  test("normalizes float32 RGBA with custom windows", async ({ page }) => {
    const result = await page.evaluate(() => {
      const src = new Float32Array([
        0.0, 0.5, 1.0, 0.75, 100.0, 200.0, 300.0, 150.0,
      ])
      const windows = [
        { start: 0, end: 1 },
        { start: 0, end: 1 },
        { start: 0, end: 1 },
        { start: 0, end: 1 },
      ]
      const out = window.fidnii.normalizeToUint8(src, 4, windows)
      return Array.from(out)
    })

    // First voxel: [0.0, 0.5, 1.0, 0.75] → [0, ~128, 255, ~191]
    expect(result[0]).toBe(0)
    expect(result[1]).toBeGreaterThanOrEqual(127)
    expect(result[1]).toBeLessThanOrEqual(128)
    expect(result[2]).toBe(255)
    expect(result[3]).toBeGreaterThanOrEqual(190)
    expect(result[3]).toBeLessThanOrEqual(192)
    // Second voxel: values > 1.0, should clamp to 255
    expect(result[4]).toBe(255)
    expect(result[5]).toBe(255)
    expect(result[6]).toBe(255)
    expect(result[7]).toBe(255)
  })

  test("clamps negative values to 0", async ({ page }) => {
    const result = await page.evaluate(() => {
      const src = new Float32Array([-1.0, -0.5, 0.0])
      const windows = [
        { start: 0, end: 1 },
        { start: 0, end: 1 },
        { start: 0, end: 1 },
      ]
      const out = window.fidnii.normalizeToUint8(src, 3, windows)
      return Array.from(out)
    })

    expect(result[0]).toBe(0)
    expect(result[1]).toBe(0)
    expect(result[2]).toBe(0)
  })

  test("handles degenerate window (start == end)", async ({ page }) => {
    const result = await page.evaluate(() => {
      const src = new Float32Array([5.0, 5.0, 5.0])
      const windows = [
        { start: 5, end: 5 },
        { start: 5, end: 5 },
        { start: 5, end: 5 },
      ]
      const out = window.fidnii.normalizeToUint8(src, 3, windows)
      return Array.from(out)
    })

    // All zeros when window is degenerate
    expect(result).toEqual([0, 0, 0])
  })

  test("handles int16 (signed) with negative window", async ({ page }) => {
    const result = await page.evaluate(() => {
      const src = new Int16Array([-1000, 0, 1000])
      const windows = [
        { start: -1000, end: 1000 },
        { start: -1000, end: 1000 },
        { start: -1000, end: 1000 },
      ]
      const out = window.fidnii.normalizeToUint8(src, 3, windows)
      return Array.from(out)
    })

    // [-1000, 0, 1000] with window [-1000, 1000] → [0, ~128, 255]
    expect(result[0]).toBe(0)
    expect(result[1]).toBeGreaterThanOrEqual(127)
    expect(result[1]).toBeLessThanOrEqual(128)
    expect(result[2]).toBe(255)
  })
})

test.describe("RGB Support — computeChannelMinMax", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("computes per-channel min/max for RGB data", async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = new Uint16Array([10, 100, 1000, 20, 200, 500, 5, 50, 2000])
      return window.fidnii.computeChannelMinMax(data, 3)
    })

    expect(result).toEqual([
      { start: 5, end: 20 },
      { start: 50, end: 200 },
      { start: 500, end: 2000 },
    ])
  })

  test("handles single-voxel data", async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = new Float32Array([0.5, 0.75, 1.0])
      return window.fidnii.computeChannelMinMax(data, 3)
    })

    expect(result[0].start).toBeCloseTo(0.5)
    expect(result[0].end).toBeCloseTo(0.5)
    expect(result[1].start).toBeCloseTo(0.75)
    expect(result[1].end).toBeCloseTo(0.75)
    expect(result[2].start).toBeCloseTo(1.0)
    expect(result[2].end).toBeCloseTo(1.0)
  })
})

test.describe("RGB Support — BufferManager with normalized RGB", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("non-uint8 RGB uses uint8 output buffer", async ({ page }) => {
    const result = await page.evaluate(() => {
      const bm = new window.fidnii.BufferManager(1_000_000, "uint16", 3)
      const arr = bm.resize([1, 10, 10])
      return {
        isNormalizedRGB: bm.isNormalizedRGB,
        componentsPerVoxel: bm.componentsPerVoxel,
        bytesPerPixel: bm.getBytesPerPixel(),
        typedArrayLength: arr.length,
        elementCount: bm.getElementCount(),
        isUint8: arr.constructor.name === "Uint8Array",
      }
    })

    expect(result.isNormalizedRGB).toBe(true)
    expect(result.componentsPerVoxel).toBe(3)
    expect(result.bytesPerPixel).toBe(1) // uint8, not uint16
    expect(result.typedArrayLength).toBe(300) // 100 * 3
    expect(result.elementCount).toBe(300)
    expect(result.isUint8).toBe(true)
  })

  test("non-uint8 RGBA uses uint8 output buffer", async ({ page }) => {
    const result = await page.evaluate(() => {
      const bm = new window.fidnii.BufferManager(1_000_000, "float32", 4)
      const arr = bm.resize([1, 10, 10])
      return {
        isNormalizedRGB: bm.isNormalizedRGB,
        bytesPerPixel: bm.getBytesPerPixel(),
        isUint8: arr.constructor.name === "Uint8Array",
      }
    })

    expect(result.isNormalizedRGB).toBe(true)
    expect(result.bytesPerPixel).toBe(1)
    expect(result.isUint8).toBe(true)
  })

  test("uint8 RGB does NOT use normalized path", async ({ page }) => {
    const result = await page.evaluate(() => {
      const bm = new window.fidnii.BufferManager(1_000_000, "uint8", 3)
      return {
        isNormalizedRGB: bm.isNormalizedRGB,
        bytesPerPixel: bm.getBytesPerPixel(),
      }
    })

    expect(result.isNormalizedRGB).toBe(false)
    expect(result.bytesPerPixel).toBe(1) // still 1 since uint8
  })

  test("scalar uint16 does NOT use normalized path", async ({ page }) => {
    const result = await page.evaluate(() => {
      const bm = new window.fidnii.BufferManager(1_000_000, "uint16")
      return {
        isNormalizedRGB: bm.isNormalizedRGB,
        bytesPerPixel: bm.getBytesPerPixel(),
      }
    })

    expect(result.isNormalizedRGB).toBe(false)
    expect(result.bytesPerPixel).toBe(2) // uint16
  })
})

test.describe("RGB Support — getVolumeShape", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("returns [1, y, x] for 2D image (dims=[y, x, c])", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 4], chunks: [480, 640, 4] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.getVolumeShape(img as any)
    })

    expect(result).toEqual([1, 480, 640])
  })

  test("returns [z, y, x] for standard 3D image", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["z", "y", "x"],
        data: { shape: [96, 128, 256], chunks: [48, 64, 128] },
        scale: { z: 1, y: 1, x: 1 },
        translation: { z: 0, y: 0, x: 0 },
      }
      return window.fidnii.getVolumeShape(img as any)
    })

    expect(result).toEqual([96, 128, 256])
  })

  test("returns [z, y, x] for 3D image with channel (dims=[z, y, x, c])", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["z", "y", "x", "c"],
        data: { shape: [10, 480, 640, 3], chunks: [10, 480, 640, 3] },
        scale: { z: 1, y: 1, x: 1, c: 1 },
        translation: { z: 0, y: 0, x: 0, c: 0 },
      }
      return window.fidnii.getVolumeShape(img as any)
    })

    expect(result).toEqual([10, 480, 640])
  })

  test("returns [1, y, x] for 2D image without channel (dims=[y, x])", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x"],
        data: { shape: [480, 640], chunks: [480, 640] },
        scale: { y: 1, x: 1 },
        translation: { y: 0, x: 0 },
      }
      return window.fidnii.getVolumeShape(img as any)
    })

    expect(result).toEqual([1, 480, 640])
  })

  test("handles time dimension (dims=[t, z, y, x])", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["t", "z", "y", "x"],
        data: { shape: [5, 96, 128, 256], chunks: [1, 48, 64, 128] },
        scale: { t: 1, z: 1, y: 1, x: 1 },
        translation: { t: 0, z: 0, y: 0, x: 0 },
      }
      return window.fidnii.getVolumeShape(img as any)
    })

    expect(result).toEqual([96, 128, 256])
  })

  test("throws if y dimension is missing", async ({ page }) => {
    const error = await page.evaluate(() => {
      try {
        const img = {
          dims: ["z", "x"],
          data: { shape: [96, 256], chunks: [48, 128] },
          scale: { z: 1, x: 1 },
          translation: { z: 0, x: 0 },
        }
        window.fidnii.getVolumeShape(img as any)
        return null
      } catch (e: any) {
        return e.message
      }
    })

    expect(error).toContain('missing required "y" and/or "x"')
  })
})

test.describe("RGB Support — getChunkShape", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("returns [1, cy, cx] for 2D image (dims=[y, x, c])", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 4], chunks: [240, 320, 4] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.getChunkShape(img as any)
    })

    expect(result).toEqual([1, 240, 320])
  })

  test("returns [cz, cy, cx] for standard 3D image", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["z", "y", "x"],
        data: { shape: [96, 128, 256], chunks: [48, 64, 128] },
        scale: { z: 1, y: 1, x: 1 },
        translation: { z: 0, y: 0, x: 0 },
      }
      return window.fidnii.getChunkShape(img as any)
    })

    expect(result).toEqual([48, 64, 128])
  })
})

test.describe("RGB Support — buildSelection", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("maps 2D RGBA dims [y, x, c] to correct selection", async ({ page }) => {
    const result = await page.evaluate(() => {
      const region = {
        start: [0, 10, 20] as [number, number, number], // [z, y, x]
        end: [1, 50, 60] as [number, number, number],
      }
      const selection = window.fidnii.buildSelection(["y", "x", "c"], region)
      // selection should be: [slice(10,50), slice(20,60), null]
      return selection.map((s: any) =>
        s === null
          ? "null"
          : typeof s === "number"
            ? s
            : { start: s.start, stop: s.stop },
      )
    })

    expect(result).toEqual([
      { start: 10, stop: 50 }, // y → region[1]
      { start: 20, stop: 60 }, // x → region[2]
      "null", // c → null (select all)
    ])
  })

  test("maps 3D dims [z, y, x] to correct selection", async ({ page }) => {
    const result = await page.evaluate(() => {
      const region = {
        start: [5, 10, 20] as [number, number, number],
        end: [15, 50, 60] as [number, number, number],
      }
      const selection = window.fidnii.buildSelection(["z", "y", "x"], region)
      return selection.map((s: any) =>
        s === null
          ? "null"
          : typeof s === "number"
            ? s
            : { start: s.start, stop: s.stop },
      )
    })

    expect(result).toEqual([
      { start: 5, stop: 15 }, // z → region[0]
      { start: 10, stop: 50 }, // y → region[1]
      { start: 20, stop: 60 }, // x → region[2]
    ])
  })

  test("maps dims with time [t, z, y, x] correctly", async ({ page }) => {
    const result = await page.evaluate(() => {
      const region = {
        start: [5, 10, 20] as [number, number, number],
        end: [15, 50, 60] as [number, number, number],
      }
      const selection = window.fidnii.buildSelection(
        ["t", "z", "y", "x"],
        region,
      )
      return selection.map((s: any) =>
        s === null
          ? "null"
          : typeof s === "number"
            ? s
            : { start: s.start, stop: s.stop },
      )
    })

    expect(result).toEqual([
      0, // t → first timepoint
      { start: 5, stop: 15 }, // z → region[0]
      { start: 10, stop: 50 }, // y → region[1]
      { start: 20, stop: 60 }, // x → region[2]
    ])
  })

  test("maps dims with time and channel [t, y, x, c] correctly", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const region = {
        start: [0, 10, 20] as [number, number, number],
        end: [1, 50, 60] as [number, number, number],
      }
      const selection = window.fidnii.buildSelection(
        ["t", "y", "x", "c"],
        region,
      )
      return selection.map((s: any) =>
        s === null
          ? "null"
          : typeof s === "number"
            ? s
            : { start: s.start, stop: s.stop },
      )
    })

    expect(result).toEqual([
      0, // t → first timepoint
      { start: 10, stop: 50 }, // y → region[1]
      { start: 20, stop: 60 }, // x → region[2]
      "null", // c → null (select all)
    ])
  })

  test("unknown dims get null selection", async ({ page }) => {
    const result = await page.evaluate(() => {
      const region = {
        start: [0, 10, 20] as [number, number, number],
        end: [1, 50, 60] as [number, number, number],
      }
      const selection = window.fidnii.buildSelection(["y", "x", "foo"], region)
      return selection.map((s: any) =>
        s === null
          ? "null"
          : typeof s === "number"
            ? s
            : { start: s.start, stop: s.stop },
      )
    })

    expect(result).toEqual([
      { start: 10, stop: 50 }, // y → region[1]
      { start: 20, stop: 60 }, // x → region[2]
      "null", // unknown → null
    ])
  })
})

test.describe("RGB Support — BufferManager with componentsPerVoxel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("scalar buffer (componentsPerVoxel=1) works as before", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const bm = new window.fidnii.BufferManager(1_000_000, "uint8")
      const arr = bm.resize([1, 100, 100])
      return {
        componentsPerVoxel: bm.componentsPerVoxel,
        pixelCount: bm.getPixelCount(),
        elementCount: bm.getElementCount(),
        typedArrayLength: arr.length,
        capacity: bm.getCapacity(),
      }
    })

    expect(result.componentsPerVoxel).toBe(1)
    expect(result.pixelCount).toBe(10_000)
    expect(result.elementCount).toBe(10_000)
    expect(result.typedArrayLength).toBe(10_000)
  })

  test("RGBA buffer (componentsPerVoxel=4) allocates 4x elements", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const bm = new window.fidnii.BufferManager(1_000_000, "uint8", 4)
      const arr = bm.resize([1, 100, 200])
      return {
        componentsPerVoxel: bm.componentsPerVoxel,
        pixelCount: bm.getPixelCount(),
        elementCount: bm.getElementCount(),
        typedArrayLength: arr.length,
        capacity: bm.getCapacity(),
      }
    })

    expect(result.componentsPerVoxel).toBe(4)
    expect(result.pixelCount).toBe(20_000)
    expect(result.elementCount).toBe(80_000) // 20k * 4
    expect(result.typedArrayLength).toBe(80_000)
    expect(result.capacity).toBe(80_000)
  })

  test("RGB buffer (componentsPerVoxel=3) allocates 3x elements", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const bm = new window.fidnii.BufferManager(1_000_000, "uint8", 3)
      const arr = bm.resize([1, 50, 100])
      return {
        componentsPerVoxel: bm.componentsPerVoxel,
        pixelCount: bm.getPixelCount(),
        elementCount: bm.getElementCount(),
        typedArrayLength: arr.length,
      }
    })

    expect(result.componentsPerVoxel).toBe(3)
    expect(result.pixelCount).toBe(5_000)
    expect(result.elementCount).toBe(15_000) // 5k * 3
    expect(result.typedArrayLength).toBe(15_000)
  })

  test("canAccommodate accounts for componentsPerVoxel", async ({ page }) => {
    const result = await page.evaluate(() => {
      const bm = new window.fidnii.BufferManager(1_000_000, "uint8", 4)
      bm.resize([1, 100, 100]) // 10k spatial, 40k elements
      return {
        canFitSame: bm.canAccommodate([1, 100, 100]),
        canFitSmaller: bm.canAccommodate([1, 50, 50]),
        canFitLarger: bm.canAccommodate([1, 200, 200]),
      }
    })

    expect(result.canFitSame).toBe(true)
    expect(result.canFitSmaller).toBe(true)
    expect(result.canFitLarger).toBe(false)
  })

  test("clear zeroes the full multi-component region", async ({ page }) => {
    const result = await page.evaluate(() => {
      const bm = new window.fidnii.BufferManager(1_000_000, "uint8", 4)
      const arr = bm.resize([1, 10, 10]) // 100 spatial, 400 elements
      // Fill with non-zero
      for (let i = 0; i < arr.length; i++) arr[i] = 255
      bm.clear()
      const view = bm.getTypedArray()
      // Check all elements are zero
      let allZero = true
      for (let i = 0; i < view.length; i++) {
        if (view[i] !== 0) {
          allZero = false
          break
        }
      }
      return { length: view.length, allZero }
    })

    expect(result.length).toBe(400)
    expect(result.allZero).toBe(true)
  })

  test("getDimensions returns spatial-only dimensions", async ({ page }) => {
    const result = await page.evaluate(() => {
      const bm = new window.fidnii.BufferManager(1_000_000, "uint8", 4)
      bm.resize([1, 480, 640])
      return bm.getDimensions()
    })

    expect(result).toEqual([1, 480, 640])
  })
})

test.describe("RGB Support — normalizedToWorld with 2D images", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("2D image with scale=1, translation=0 maps correctly", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 4], chunks: [480, 640, 4] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      // normalizedToWorld([x, y, z], img) → world [x, y, z]
      // Center of image: normalized [0.5, 0.5, 0.5]
      return window.fidnii.normalizedToWorld([0.5, 0.5, 0.5], img as any)
    })

    // For 2D (no z dim): dimZ=1, dimY=480, dimX=640
    // pixel = [z=0.5*1, y=0.5*480, x=0.5*640] = [0.5, 240, 320]
    // world = pixelToWorld([0.5, 240, 320]) = [x=320*1+0, y=240*1+0, z=0.5*1+0]
    expect(result[0]).toBeCloseTo(320) // x
    expect(result[1]).toBeCloseTo(240) // y
    expect(result[2]).toBeCloseTo(0.5) // z
  })

  test("2D image origin maps to (0,0,0) world", async ({ page }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 4], chunks: [480, 640, 4] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      return window.fidnii.normalizedToWorld([0, 0, 0], img as any)
    })

    expect(result[0]).toBeCloseTo(0) // x
    expect(result[1]).toBeCloseTo(0) // y
    expect(result[2]).toBeCloseTo(0) // z
  })
})

test.describe("RGB Support — worldToNormalized with 2D images", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("2D image center world coords map to ~0.5 normalized", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 4], chunks: [480, 640, 4] },
        scale: { y: 1, x: 1, c: 1 },
        translation: { y: 0, x: 0, c: 0 },
      }
      // worldToNormalized([x, y, z], img) → normalized [x, y, z]
      return window.fidnii.worldToNormalized([320, 240, 0.5], img as any)
    })

    expect(result[0]).toBeCloseTo(0.5) // x normalized
    expect(result[1]).toBeCloseTo(0.5) // y normalized
    expect(result[2]).toBeCloseTo(0.5) // z normalized
  })

  test("roundtrip: normalizedToWorld then worldToNormalized", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const img = {
        dims: ["y", "x", "c"],
        data: { shape: [480, 640, 4], chunks: [480, 640, 4] },
        scale: { y: 0.5, x: 0.25, c: 1 },
        translation: { y: 10, x: 20, c: 0 },
      }
      const normalized: [number, number, number] = [0.3, 0.7, 0.5]
      const world = window.fidnii.normalizedToWorld(normalized, img as any)
      const back = window.fidnii.worldToNormalized(world, img as any)
      return { original: normalized, roundtrip: back }
    })

    expect(result.roundtrip[0]).toBeCloseTo(result.original[0], 5)
    expect(result.roundtrip[1]).toBeCloseTo(result.original[1], 5)
    expect(result.roundtrip[2]).toBeCloseTo(result.original[2], 5)
  })
})

test.describe("RGB Support — 2D y-flip does not affect 3D volumes", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    // Wait for the 3D beechnut to finish loading
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })
  })

  test("3D image affine has positive y-scale", async ({ page }) => {
    const affineY = await page.evaluate(() => {
      const image = (window as any).image
      // hdr.affine is [[srow_x], [srow_y], [srow_z], [0,0,0,1]]
      // srow_y[1] is the y diagonal (y-scale in affine)
      return image.hdr.affine[1][1]
    })

    // 3D beechnut should have positive y-scale (no flip)
    expect(affineY).toBeGreaterThan(0)
  })

  test("3D image affine has positive x-scale", async ({ page }) => {
    const affineX = await page.evaluate(() => {
      const image = (window as any).image
      return image.hdr.affine[0][0]
    })

    // 3D beechnut should have positive x-scale
    expect(affineX).toBeGreaterThan(0)
  })
})
