// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

/**
 * Build-time script to generate WebP colormap preview icons for every
 * NiiVue colormap plus the custom "Fast" colormap.
 *
 * Each icon is a 128x16 horizontal gradient bar rendered from the
 * colormap's 256-entry RGBA lookup table, saved as a lossless WebP.
 *
 * Run with: npx tsx generate-colormap-icons.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { cmapper } from "@niivue/niivue"
import sharp from "sharp"

import { FAST_COLORMAP } from "./fast-colormap.ts"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const OUT_DIR = join(__dirname, "icons", "colormaps")

const WIDTH = 128
const HEIGHT = 16

// Register the custom "Fast" colormap so it appears alongside the built-ins.
cmapper.addColormap("fast", FAST_COLORMAP)

// Collect all colormap names (built-in + custom).
const names = cmapper.colormaps()

if (!existsSync(OUT_DIR)) {
  mkdirSync(OUT_DIR, { recursive: true })
}

/**
 * Render a single colormap to a 128x16 raw RGBA buffer.
 *
 * Each column `x` maps to LUT index `Math.round(x / (WIDTH - 1) * 255)`.
 * Alpha is forced to 255 so the preview is always fully opaque.
 */
function renderColormapBuffer(name: string): Buffer {
  const lut = cmapper.colormap(name)
  const buf = Buffer.alloc(WIDTH * HEIGHT * 4)

  for (let x = 0; x < WIDTH; x++) {
    const idx = Math.round((x / (WIDTH - 1)) * 255)
    const r = lut[idx * 4]
    const g = lut[idx * 4 + 1]
    const b = lut[idx * 4 + 2]

    for (let y = 0; y < HEIGHT; y++) {
      const offset = (y * WIDTH + x) * 4
      buf[offset] = r
      buf[offset + 1] = g
      buf[offset + 2] = b
      buf[offset + 3] = 255
    }
  }

  return buf
}

async function main() {
  console.log(
    `Generating ${names.length} colormap icons (${WIDTH}x${HEIGHT} WebP)…`,
  )

  for (const name of names) {
    const raw = renderColormapBuffer(name)
    const webp = await sharp(raw, {
      raw: { width: WIDTH, height: HEIGHT, channels: 4 },
    })
      .webp({ lossless: true })
      .toBuffer()

    const outPath = join(OUT_DIR, `${name}.webp`)
    writeFileSync(outPath, webp)
  }

  console.log(`Done. ${names.length} icons written to ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
