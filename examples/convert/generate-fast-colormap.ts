/**
 * Build-time script to generate the ParaView "Fast" colormap as a 256-entry
 * lookup table suitable for NiiVue's addColormap() API.
 *
 * ParaView interpolates its colormap control points in CIELAB color space.
 * NiiVue interpolates linearly in sRGB between control points. To get an
 * exact match we pre-sample the CIELAB interpolation at 256 points and store
 * the result as a static array.
 *
 * Run with: npx tsx generate-fast-colormap.ts
 *
 * Source: ParaView/Remoting/Views/ColorMaps.json — "Fast" preset
 * Creator: Francesca Samsel, and Alan W. Scott
 */

// ---------------------------------------------------------------------------
// ParaView "Fast" control points  [scalar, R, G, B]  (sRGB, 0–1)
// ---------------------------------------------------------------------------
const CONTROL_POINTS: [number, number, number, number][] = [
  [0.0, 0.05639999999999999, 0.05639999999999999, 0.47],
  [0.17159223942480895, 0.24300000000000013, 0.4603500000000004, 0.81],
  [
    0.2984914818394138, 0.3568143826543521, 0.7450246485363142,
    0.954367702893722,
  ],
  [0.4321287371255907, 0.6882, 0.93, 0.9179099999999999],
  [0.5, 0.8994959551205902, 0.944646394975174, 0.7686567142818399],
  [
    0.5882260353170073, 0.957107977357604, 0.8338185108985666,
    0.5089156299842102,
  ],
  [
    0.7061412605695164, 0.9275207599610714, 0.6214389091739178,
    0.31535705838676426,
  ],
  [0.8476395308725272, 0.8, 0.3520000000000001, 0.15999999999999998],
  [1.0, 0.59, 0.07670000000000013, 0.11947499999999994],
]

// ---------------------------------------------------------------------------
// Color-space conversions
// ---------------------------------------------------------------------------

/** sRGB component (0–1) → linear RGB */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** linear RGB → sRGB component (0–1) */
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1.0 / 2.4) - 0.055
}

/** sRGB (0–1) → CIE XYZ (D65) */
function srgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r)
  const gl = srgbToLinear(g)
  const bl = srgbToLinear(b)
  return [
    0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl,
    0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl,
    0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl,
  ]
}

/** CIE XYZ (D65) → sRGB (0–1), clamped */
function xyzToSrgb(x: number, y: number, z: number): [number, number, number] {
  const rl = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const gl = -0.969266 * x + 1.8760108 * y + 0.041556 * z
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
  return [
    Math.max(0, Math.min(1, linearToSrgb(rl))),
    Math.max(0, Math.min(1, linearToSrgb(gl))),
    Math.max(0, Math.min(1, linearToSrgb(bl))),
  ]
}

// D65 reference white
const XN = 0.95047
const YN = 1.0
const ZN = 1.08883

const EPSILON = 216 / 24389
const KAPPA = 24389 / 27

function labF(t: number): number {
  return t > EPSILON ? t ** (1 / 3) : (KAPPA * t + 16) / 116
}

function labFInv(t: number): number {
  const t3 = t * t * t
  return t3 > EPSILON ? t3 : (116 * t - 16) / KAPPA
}

/** CIE XYZ → CIELAB */
function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const fx = labF(x / XN)
  const fy = labF(y / YN)
  const fz = labF(z / ZN)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIELAB → CIE XYZ */
function labToXyz(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200
  return [labFInv(fx) * XN, labFInv(fy) * YN, labFInv(fz) * ZN]
}

/** sRGB (0–1) → CIELAB */
function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  return xyzToLab(...srgbToXyz(r, g, b))
}

/** CIELAB → sRGB (0–1), clamped */
function labToSrgb(L: number, a: number, b: number): [number, number, number] {
  return xyzToSrgb(...labToXyz(L, a, b))
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Sample the Fast colormap at a scalar position `s` in [0, 1].
 * Interpolation is linear in CIELAB space between the control points.
 */
function sampleFast(s: number): [number, number, number] {
  // Clamp
  if (s <= CONTROL_POINTS[0][0]) {
    return [CONTROL_POINTS[0][1], CONTROL_POINTS[0][2], CONTROL_POINTS[0][3]]
  }
  if (s >= CONTROL_POINTS[CONTROL_POINTS.length - 1][0]) {
    const last = CONTROL_POINTS[CONTROL_POINTS.length - 1]
    return [last[1], last[2], last[3]]
  }

  // Find the segment
  for (let i = 0; i < CONTROL_POINTS.length - 1; i++) {
    const [s0, r0, g0, b0] = CONTROL_POINTS[i]
    const [s1, r1, g1, b1] = CONTROL_POINTS[i + 1]
    if (s >= s0 && s <= s1) {
      const t = (s - s0) / (s1 - s0)
      const lab0 = srgbToLab(r0, g0, b0)
      const lab1 = srgbToLab(r1, g1, b1)
      const L = lerp(lab0[0], lab1[0], t)
      const a = lerp(lab0[1], lab1[1], t)
      const b = lerp(lab0[2], lab1[2], t)
      return labToSrgb(L, a, b)
    }
  }

  // Fallback (should not reach)
  const last = CONTROL_POINTS[CONTROL_POINTS.length - 1]
  return [last[1], last[2], last[3]]
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const N = 256
const R: number[] = []
const G: number[] = []
const B: number[] = []
const A: number[] = []
const I: number[] = []

for (let i = 0; i < N; i++) {
  const s = i / (N - 1)
  const [r, g, b] = sampleFast(s)
  R.push(Math.round(r * 255))
  G.push(Math.round(g * 255))
  B.push(Math.round(b * 255))
  A.push(255)
  I.push(i)
}

function formatArray(arr: number[], indent: string): string {
  const lines: string[] = []
  const perLine = 16
  for (let i = 0; i < arr.length; i += perLine) {
    lines.push(`${indent}${arr.slice(i, i + perLine).join(", ")},`)
  }
  return lines.join("\n")
}

const output = `\
// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

/**
 * ParaView "Fast" colormap — 256-entry lookup table for NiiVue.
 *
 * Generated by interpolating the 9 ParaView control points in CIELAB color
 * space and sampling at 256 evenly-spaced positions. This matches ParaView's
 * native Lab-space interpolation exactly.
 *
 * Source: ParaView/Remoting/Views/ColorMaps.json — "Fast" preset
 * Creator: Francesca Samsel, and Alan W. Scott
 *
 * @see {@link https://www.kitware.com/new-default-colormap-and-background-in-next-paraview-release/}
 */
export const FAST_COLORMAP = {
  R: [
${formatArray(R, "    ")}
  ],
  G: [
${formatArray(G, "    ")}
  ],
  B: [
${formatArray(B, "    ")}
  ],
  A: [
${formatArray(A, "    ")}
  ],
  I: [
${formatArray(I, "    ")}
  ],
}
`

process.stdout.write(output)
