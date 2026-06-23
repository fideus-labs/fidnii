// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { NVImage } from "@niivue/niivue"
import { mat3, mat4, vec3, vec4 } from "gl-matrix"

/**
 * Recompute an {@link NVImage}'s RAS orientation/geometry fields from its NIfTI
 * header — a faithful, dependency-free port of NiiVue's internal `calculateRAS`.
 *
 * ## Why fidnii needs this
 *
 * NiiVue 1.0's GL bind path (`updateGLVolume → updateBindGroups`) **requires** a
 * volume to carry precomputed RAS geometry (`mm000`/`mm100`/`mm010`/`mm001`,
 * `matRAS`, `pixDimsRAS`, `dimsRAS`, `frac2mm`, …) *before* it is added, and
 * throws `"Missing moving image mm corner coordinates"` / `"matRAS not defined"`
 * otherwise. NiiVue's own loaders run `calculateRAS` while building a volume;
 * fidnii builds {@link OMEZarrNVImage} volumes by hand (placeholder header first,
 * data streamed later), so fidnii must run the same computation itself.
 *
 * In NiiVue 0.68 this was the instance method `NVImage.calculateRAS()`, which
 * fidnii called synchronously on the detached image. NiiVue 1.0 removed that
 * method: the equivalent is now a free function declared in
 * `@niivue/niivue/dist/math/NVTransforms` that is **not** in the package's
 * `exports` map and therefore cannot be imported. This module reproduces it
 * (verified byte-for-byte against `@niivue/niivue@1.0.0-rc.9`'s bundled
 * implementation and the matching upstream source) so the geometry can be
 * computed on a detached volume, attached or not, with no GL context required.
 *
 * The math is pure {@link https://github.com/toji/gl-matrix | gl-matrix}
 * (the same version and operations NiiVue uses internally), so the derived
 * fields are numerically identical to what NiiVue would compute.
 *
 * Sets, on `nvImage`: `mm000`, `mm100`, `mm010`, `mm001`, `matRAS`, `dimsRAS`,
 * `pixDimsRAS`, `permRAS`, `toRAS`, `toRASvox`, `img2RASstep`, `img2RASstart`,
 * plus the oblique set (`obliqueRAS`, `oblique_angle`, `maxShearDeg`, `frac2mm`,
 * `frac2mmOrtho`, `extentsMinOrtho`, `extentsMaxOrtho`, `mm2ortho`).
 *
 * @param nvImage - The volume to recompute. Must have `hdr.affine`, `hdr.dims`,
 *   and `hdr.pixDims` populated.
 * @throws Error if `nvImage.hdr` is not set.
 */
export function calculateRAS(nvImage: NVImage): void {
  if (!nvImage.hdr) {
    throw new Error("hdr not set")
  }
  const header = nvImage.hdr
  const a = header.affine

  // Determine the closest world axis for each image column (NIfTI nifti_mat44
  // → orientation, AFNI/nifti1_io convention).
  const absR = mat3.fromValues(
    Math.abs(a[0][0]),
    Math.abs(a[0][1]),
    Math.abs(a[0][2]),
    Math.abs(a[1][0]),
    Math.abs(a[1][1]),
    Math.abs(a[1][2]),
    Math.abs(a[2][0]),
    Math.abs(a[2][1]),
    Math.abs(a[2][2]),
  )
  // 1st column = x
  const ixyz = [1, 1, 1]
  if (absR[3] > absR[0]) {
    ixyz[0] = 2
  }
  if (absR[6] > absR[0] && absR[6] > absR[3]) {
    ixyz[0] = 3
  }
  // 2nd column = y
  ixyz[1] = 1
  if (ixyz[0] === 1) {
    ixyz[1] = absR[4] > absR[7] ? 2 : 3
  } else if (ixyz[0] === 2) {
    ixyz[1] = absR[1] > absR[7] ? 1 : 3
  } else {
    ixyz[1] = absR[1] > absR[4] ? 1 : 2
  }
  // 3rd column = z: constrained as x + y + z = 1 + 2 + 3 = 6
  ixyz[2] = 6 - ixyz[1] - ixyz[0]
  const perm = [1, 2, 3]
  perm[ixyz[0] - 1] = 1
  perm[ixyz[1] - 1] = 2
  perm[ixyz[2] - 1] = 3

  let rotM = mat4.fromValues(
    a[0][0],
    a[0][1],
    a[0][2],
    a[0][3],
    a[1][0],
    a[1][1],
    a[1][2],
    a[1][3],
    a[2][0],
    a[2][1],
    a[2][2],
    a[2][3],
    0,
    0,
    0,
    1,
  )
  nvImage.mm000 = vox2mm([-0.5, -0.5, -0.5], rotM)
  nvImage.mm100 = vox2mm([header.dims[1] - 0.5, -0.5, -0.5], rotM)
  nvImage.mm010 = vox2mm([-0.5, header.dims[2] - 0.5, -0.5], rotM)
  nvImage.mm001 = vox2mm([-0.5, -0.5, header.dims[3] - 0.5], rotM)

  const R = mat4.create()
  mat4.copy(R, rotM)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i * 4 + j] = rotM[i * 4 + perm[j] - 1]
    }
  }
  const flip = [0, 0, 0]
  if (R[0] < 0) {
    flip[0] = 1
  }
  if (R[5] < 0) {
    flip[1] = 1
  }
  if (R[10] < 0) {
    flip[2] = 1
  }
  nvImage.dimsRAS = [
    header.dims[0],
    header.dims[perm[0]],
    header.dims[perm[1]],
    header.dims[perm[2]],
  ]
  nvImage.pixDimsRAS = [
    header.pixDims[0],
    header.pixDims[perm[0]],
    header.pixDims[perm[1]],
    header.pixDims[perm[2]],
  ]
  nvImage.permRAS = perm.slice()
  for (let i = 0; i < 3; i++) {
    if (flip[i] === 1) {
      nvImage.permRAS[i] = -nvImage.permRAS[i]
    }
  }

  if (arrayEquals(perm, [1, 2, 3]) && arrayEquals(flip, [0, 0, 0])) {
    // No rotation required: the image is already in RAS order.
    nvImage.toRAS = mat4.create()
    nvImage.matRAS = mat4.clone(rotM)
    calculateOblique(nvImage)
    nvImage.img2RASstep = [
      1,
      nvImage.dimsRAS[1],
      nvImage.dimsRAS[1] * nvImage.dimsRAS[2],
    ]
    nvImage.img2RASstart = [0, 0, 0]
    return
  }

  // Build the residual rotation (matRAS) and the integer reorder transforms.
  mat4.identity(rotM)
  rotM[0] = 1 - flip[0] * 2
  rotM[5] = 1 - flip[1] * 2
  rotM[10] = 1 - flip[2] * 2
  rotM[3] = (header.dims[perm[0]] - 1) * flip[0]
  rotM[7] = (header.dims[perm[1]] - 1) * flip[1]
  rotM[11] = (header.dims[perm[2]] - 1) * flip[2]
  const residualR = mat4.create()
  mat4.invert(residualR, rotM)
  mat4.multiply(residualR, residualR, R)
  nvImage.matRAS = mat4.clone(residualR)

  rotM = mat4.fromValues(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)
  // Column-major (gl-matrix) indices: row r, col c → rotM[r + c * 4].
  rotM[perm[0] - 1 + 0 * 4] = -flip[0] * 2 + 1
  rotM[perm[1] - 1 + 1 * 4] = -flip[1] * 2 + 1
  rotM[perm[2] - 1 + 2 * 4] = -flip[2] * 2 + 1
  rotM[3] = flip[0]
  rotM[7] = flip[1]
  rotM[11] = flip[2]
  nvImage.toRAS = mat4.clone(rotM)
  rotM[3] = 0
  rotM[7] = 0
  rotM[11] = 0
  rotM[12] = 0
  if (
    nvImage.permRAS[0] === -1 ||
    nvImage.permRAS[1] === -1 ||
    nvImage.permRAS[2] === -1
  ) {
    rotM[12] = header.dims[1] - 1
  }
  rotM[13] = 0
  if (
    nvImage.permRAS[0] === -2 ||
    nvImage.permRAS[1] === -2 ||
    nvImage.permRAS[2] === -2
  ) {
    rotM[13] = header.dims[2] - 1
  }
  rotM[14] = 0
  if (
    nvImage.permRAS[0] === -3 ||
    nvImage.permRAS[1] === -3 ||
    nvImage.permRAS[2] === -3
  ) {
    rotM[14] = header.dims[3] - 1
  }
  nvImage.toRASvox = mat4.clone(rotM)

  // Compute the image→RAS step/start used to walk the voxel array in RAS order.
  const signedPerm = nvImage.permRAS
  const aperm = [
    Math.abs(signedPerm[0]),
    Math.abs(signedPerm[1]),
    Math.abs(signedPerm[2]),
  ]
  const outdim = [
    header.dims[aperm[0]],
    header.dims[aperm[1]],
    header.dims[aperm[2]],
  ]
  const inStep = [1, header.dims[1], header.dims[1] * header.dims[2]]
  const outStep = [
    inStep[aperm[0] - 1],
    inStep[aperm[1] - 1],
    inStep[aperm[2] - 1],
  ]
  const outStart = [0, 0, 0]
  for (let p = 0; p < 3; p++) {
    if (signedPerm[p] < 0) {
      outStart[p] = outStep[p] * (outdim[p] - 1)
      outStep[p] = -outStep[p]
    }
  }
  nvImage.img2RASstep = outStep
  nvImage.img2RASstart = outStart
  calculateOblique(nvImage)
}

/**
 * Set a volume's axis-aligned mm bounding box (`extentsMin`/`extentsMax`) from
 * its RAS corner points — the eight corners of the parallelepiped spanned by
 * `mm000` and the edge vectors to `mm100` / `mm010` / `mm001`.
 *
 * NiiVue derives these inside `setVolumeAffine` (via its `Go` helper), but only
 * once a volume is attached and that async call resolves. fidnii needs them set
 * synchronously on the *detached* placeholder too: NiiVue's 3D scene pivot and
 * its crosshair-location formatter read the scene extent (the union of volume
 * extents), and a zero extent makes the formatter throw a `toFixed()` range
 * error during the initial crosshair sync. Call after {@link calculateRAS}.
 *
 * @param nvImage - The volume whose `mm*` corners are already computed.
 */
export function computeBoundingBoxExtents(nvImage: NVImage): void {
  const { mm000, mm100, mm010, mm001 } = nvImage
  if (!mm000 || !mm100 || !mm010 || !mm001) {
    return
  }
  const ex = [mm100[0] - mm000[0], mm100[1] - mm000[1], mm100[2] - mm000[2]]
  const ey = [mm010[0] - mm000[0], mm010[1] - mm000[1], mm010[2] - mm000[2]]
  const ez = [mm001[0] - mm000[0], mm001[1] - mm000[1], mm001[2] - mm000[2]]
  const min: [number, number, number] = [mm000[0], mm000[1], mm000[2]]
  const max: [number, number, number] = [mm000[0], mm000[1], mm000[2]]
  for (let a = 0; a <= 1; a++) {
    for (let b = 0; b <= 1; b++) {
      for (let c = 0; c <= 1; c++) {
        for (let k = 0; k < 3; k++) {
          const v = mm000[k] + a * ex[k] + b * ey[k] + c * ez[k]
          if (v < min[k]) {
            min[k] = v
          }
          if (v > max[k]) {
            max[k] = v
          }
        }
      }
    }
  }
  nvImage.extentsMin = min
  nvImage.extentsMax = max
}

/**
 * Compute the oblique / fractional-to-mm geometry from an image's already-set
 * `matRAS`, `pixDimsRAS`, and `dimsRAS`. Port of the rc.9 free function declared
 * as `calculateRAS` in `math/NVTransforms` (== upstream `calculateOblique`).
 *
 * Sets `oblique_angle`, `obliqueRAS`, `maxShearDeg`, `frac2mm`, `frac2mmOrtho`,
 * `extentsMinOrtho`, `extentsMaxOrtho`, and `mm2ortho`.
 */
function calculateOblique(nvImage: NVImage): void {
  if (!nvImage.matRAS) {
    throw new Error("matRAS not defined")
  }
  if (nvImage.pixDimsRAS === undefined) {
    throw new Error("pixDimsRAS not defined")
  }
  if (!nvImage.dimsRAS) {
    throw new Error("dimsRAS not defined")
  }
  const matRAS = nvImage.matRAS
  const pixDimsRAS = nvImage.pixDimsRAS
  const dimsRAS = nvImage.dimsRAS

  nvImage.oblique_angle = computeObliqueAngle(matRAS)
  const lpi = vox2mm([0, 0, 0], matRAS)
  const x1mm = vox2mm([1 / pixDimsRAS[1], 0, 0], matRAS)
  const y1mm = vox2mm([0, 1 / pixDimsRAS[2], 0], matRAS)
  const z1mm = vox2mm([0, 0, 1 / pixDimsRAS[3]], matRAS)
  vec3.subtract(x1mm, x1mm, lpi)
  vec3.subtract(y1mm, y1mm, lpi)
  vec3.subtract(z1mm, z1mm, lpi)
  const oblique = mat4.fromValues(
    x1mm[0],
    x1mm[1],
    x1mm[2],
    0,
    y1mm[0],
    y1mm[1],
    y1mm[2],
    0,
    z1mm[0],
    z1mm[1],
    z1mm[2],
    0,
    0,
    0,
    0,
    1,
  )
  nvImage.obliqueRAS = mat4.clone(oblique)
  const xy = Math.abs(90 - (vec3.angle(x1mm, y1mm) * 180) / Math.PI)
  const xz = Math.abs(90 - (vec3.angle(x1mm, z1mm) * 180) / Math.PI)
  const yz = Math.abs(90 - (vec3.angle(y1mm, z1mm) * 180) / Math.PI)
  nvImage.maxShearDeg = Math.max(xy, xz, yz)
  if (nvImage.maxShearDeg > 0.1) {
    console.warn(
      `[fidnii] Voxels are rhomboidal, maximum shear is ${nvImage.maxShearDeg} degrees`,
    )
  }

  // Matrix mapping fractional volume coordinates → mm (shear-aware).
  const dim = vec4.fromValues(dimsRAS[1], dimsRAS[2], dimsRAS[3], 1)
  const sform = mat4.clone(matRAS)
  mat4.transpose(sform, sform)
  mat4.translate(sform, sform, vec3.fromValues(-0.5, -0.5, -0.5))
  sform[0] *= dim[0]
  sform[1] *= dim[0]
  sform[2] *= dim[0]
  sform[4] *= dim[1]
  sform[5] *= dim[1]
  sform[6] *= dim[1]
  sform[8] *= dim[2]
  sform[9] *= dim[2]
  sform[10] *= dim[2]
  nvImage.frac2mm = mat4.clone(sform)

  // Orthographic (axis-aligned) fractional → mm transform.
  const pixdimX = pixDimsRAS[1]
  const pixdimY = pixDimsRAS[2]
  const pixdimZ = pixDimsRAS[3]
  const oform = mat4.clone(sform)
  oform[0] = pixdimX * dim[0]
  oform[1] = 0
  oform[2] = 0
  oform[4] = 0
  oform[5] = pixdimY * dim[1]
  oform[6] = 0
  oform[8] = 0
  oform[9] = 0
  oform[10] = pixdimZ * dim[2]
  const originVoxel = mm2voxFrac(nvImage, [0, 0, 0])
  oform[12] = (-originVoxel[0] - 0.5) * pixdimX
  oform[13] = (-originVoxel[1] - 0.5) * pixdimY
  oform[14] = (-originVoxel[2] - 0.5) * pixdimZ
  nvImage.frac2mmOrtho = mat4.clone(oform)
  nvImage.extentsMinOrtho = [oform[12], oform[13], oform[14]]
  nvImage.extentsMaxOrtho = [
    oform[0] + oform[12],
    oform[5] + oform[13],
    oform[10] + oform[14],
  ]
  nvImage.mm2ortho = mat4.create()
  mat4.invert(nvImage.mm2ortho, oblique)
}

/** Transform a voxel coordinate to mm using `mtx` (port of NiiVue `vox2mm`). */
function vox2mm(xyz: readonly [number, number, number], mtx: mat4): vec3 {
  const sform = mat4.clone(mtx)
  mat4.transpose(sform, sform)
  const pos = vec4.fromValues(xyz[0], xyz[1], xyz[2], 1)
  vec4.transformMat4(pos, pos, sform)
  return vec3.fromValues(pos[0], pos[1], pos[2])
}

/**
 * Transform an mm coordinate to a fractional voxel coordinate using the image's
 * `matRAS` (port of NiiVue `mm2vox` with `frac=true`). Requires `matRAS`.
 */
function mm2voxFrac(
  nvImage: NVImage,
  mm: readonly [number, number, number],
): vec3 {
  if (!nvImage.matRAS) {
    throw new Error("matRAS undefined")
  }
  const out = mat4.clone(nvImage.matRAS)
  mat4.transpose(out, out)
  mat4.invert(out, out)
  const pos = vec4.fromValues(mm[0], mm[1], mm[2], 1)
  vec4.transformMat4(pos, pos, out)
  return vec3.fromValues(pos[0], pos[1], pos[2])
}

/**
 * Estimate how far (degrees) the image axes deviate from the world axes
 * (port of NiiVue `computeObliqueAngle`, AFNI THD-style). Returns 0 below ~0.01°.
 */
function computeObliqueAngle(mtx44: mat4): number {
  const m = mat4.clone(mtx44)
  mat4.transpose(m, mtx44)
  const dxtmp = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2])
  const xmax = Math.max(Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2])) / dxtmp
  const dytmp = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6])
  const ymax = Math.max(Math.abs(m[4]), Math.abs(m[5]), Math.abs(m[6])) / dytmp
  const dztmp = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10])
  const zmax = Math.max(Math.abs(m[8]), Math.abs(m[9]), Math.abs(m[10])) / dztmp
  const figMerit = Math.min(xmax, ymax, zmax)
  const obliqueAngle = Math.abs((Math.acos(figMerit) * 180) / Math.PI)
  if (obliqueAngle > 0.01) {
    console.warn(
      `[fidnii] Voxels not aligned with world space: ${obliqueAngle} degrees from plumb`,
    )
    return obliqueAngle
  }
  return 0
}

/** Element-wise equality for two equal-length numeric arrays. */
function arrayEquals(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((val, index) => val === b[index])
}
