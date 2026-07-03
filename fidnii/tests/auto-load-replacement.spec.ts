// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import { expect, test } from "@playwright/test"

test.describe("autoLoad volume replacement", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    // Wait for initial image to be ready before each test
    await expect(page.locator("#status")).toHaveText("Ready", {
      timeout: 120000,
    })
  })

  test("replaces previous fidnii volume without accumulation", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const nv = (window as any).nv
      const firstImage = (window as any).image
      const OMEZarrNVImage = (window as any).fidnii.OMEZarrNVImage

      // Verify initial state: exactly 1 volume loaded
      const initialCount = nv.volumes.length

      // Create a second image on the same NiiVue instance with autoLoad: true
      // (the default). The previous fidnii volume should be replaced.
      const secondImage = await OMEZarrNVImage.create({
        multiscales: firstImage.multiscales,
        niivue: nv,
      })

      return {
        initialCount,
        volumeCountAfter: nv.volumes.length,
        isNewImageInVolumes: nv.volumes.includes(secondImage),
        isOldImageInVolumes: nv.volumes.includes(firstImage),
      }
    })

    // Initial state should be exactly 1 volume
    expect(result.initialCount).toBe(1)
    // After creating a second image with autoLoad, still exactly 1 volume
    expect(result.volumeCountAfter).toBe(1)
    // The new image is in NiiVue
    expect(result.isNewImageInVolumes).toBe(true)
    // The old image was removed
    expect(result.isOldImageInVolumes).toBe(false)
  })

  test("detaches listeners from replaced fidnii volume", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const nv = (window as any).nv
      const firstImage = (window as any).image
      const OMEZarrNVImage = (window as any).fidnii.OMEZarrNVImage

      // Create a second image — this should detach the first image from nv
      await OMEZarrNVImage.create({
        multiscales: firstImage.multiscales,
        niivue: nv,
      })

      // After replacement, the first image should no longer be attached to nv
      return {
        firstImageStillAttached: firstImage._attachedNiivues.has(nv),
        firstClipPlaneControllerActive:
          firstImage._clipPlaneAbortController !== undefined &&
          !firstImage._clipPlaneAbortController.signal.aborted,
      }
    })

    // The old image must be detached from the NiiVue instance
    expect(result.firstImageStillAttached).toBe(false)
    // The clip-plane listener on the old image must be torn down
    expect(result.firstClipPlaneControllerActive).toBe(false)
  })

  test("create() with autoLoad registers the volume synchronously, before progressive load", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const nv = (window as any).nv
      const firstImage = (window as any).image
      const OMEZarrNVImage = (window as any).fidnii.OMEZarrNVImage

      // Start from an empty host so this exercises the first-create path (the
      // tests above always replace an existing fidnii volume; here nothing is
      // replaced). removeAllVolumes is async in niivue 1.0.
      await nv.removeAllVolumes()
      const countBefore = nv.volumes.length

      // Default autoLoad: true. create() awaits addToNiivue, so the image must
      // be present in nv.volumes the instant the promise resolves — before the
      // fire-and-forget progressive load (populateVolume) runs. Assert
      // immediately, with no waitForIdle()/populateComplete wait, to pin that
      // synchronous registration contract (the 0.68 by-reference behaviour).
      const image = await OMEZarrNVImage.create({
        multiscales: firstImage.multiscales,
        niivue: nv,
      })

      return {
        countBefore,
        includedImmediately: nv.volumes.includes(image),
        countAfter: nv.volumes.length,
      }
    })

    // Host was empty before the create
    expect(result.countBefore).toBe(0)
    // The freshly created image is registered the moment `await create()` resolves
    expect(result.includedImmediately).toBe(true)
    // Exactly one volume — the new image, added without waiting for the load
    expect(result.countAfter).toBe(1)
  })
})
