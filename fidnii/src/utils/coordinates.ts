// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

import type { NgffImage } from "@fideus-labs/ngff-zarr"
import { mat4, vec4 } from "gl-matrix"

/**
 * Convert a world coordinate to pixel indices.
 *
 * @param worldCoord - World coordinate [x, y, z]
 * @param ngffImage - The NgffImage containing scale and translation
 * @returns Pixel indices [z, y, x]
 */
export function worldToPixel(
  worldCoord: [number, number, number],
  ngffImage: NgffImage,
): [number, number, number] {
  const scale = ngffImage.scale
  const translation = ngffImage.translation

  // world = scale * pixel + translation
  // pixel = (world - translation) / scale

  const sx = scale.x ?? scale.X ?? 1
  const sy = scale.y ?? scale.Y ?? 1
  const sz = scale.z ?? scale.Z ?? 1

  const tx = translation.x ?? translation.X ?? 0
  const ty = translation.y ?? translation.Y ?? 0
  const tz = translation.z ?? translation.Z ?? 0

  const px = (worldCoord[0] - tx) / sx
  const py = (worldCoord[1] - ty) / sy
  const pz = (worldCoord[2] - tz) / sz

  // Return in [z, y, x] order to match OME-Zarr array indexing
  return [pz, py, px]
}

/**
 * Convert pixel indices to world coordinates.
 *
 * @param pixelCoord - Pixel indices [z, y, x]
 * @param ngffImage - The NgffImage containing scale and translation
 * @returns World coordinate [x, y, z]
 */
export function pixelToWorld(
  pixelCoord: [number, number, number],
  ngffImage: NgffImage,
): [number, number, number] {
  const scale = ngffImage.scale
  const translation = ngffImage.translation

  // world = scale * pixel + translation

  const sx = scale.x ?? scale.X ?? 1
  const sy = scale.y ?? scale.Y ?? 1
  const sz = scale.z ?? scale.Z ?? 1

  const tx = translation.x ?? translation.X ?? 0
  const ty = translation.y ?? translation.Y ?? 0
  const tz = translation.z ?? translation.Z ?? 0

  // pixelCoord is [z, y, x]
  const wx = sx * pixelCoord[2] + tx
  const wy = sy * pixelCoord[1] + ty
  const wz = sz * pixelCoord[0] + tz

  return [wx, wy, wz]
}

/**
 * Convert world coordinate to pixel using an affine matrix.
 *
 * @param worldCoord - World coordinate [x, y, z]
 * @param affine - 4x4 affine matrix (pixel to world)
 * @returns Pixel indices [z, y, x]
 */
export function worldToPixelAffine(
  worldCoord: [number, number, number],
  affine: mat4,
): [number, number, number] {
  // Invert the affine to go from world to pixel
  const inverseAffine = mat4.create()
  mat4.invert(inverseAffine, affine)

  const worldVec = vec4.fromValues(
    worldCoord[0],
    worldCoord[1],
    worldCoord[2],
    1,
  )
  const pixelVec = vec4.create()
  vec4.transformMat4(pixelVec, worldVec, inverseAffine)

  // Return in [z, y, x] order
  return [pixelVec[2], pixelVec[1], pixelVec[0]]
}

/**
 * Convert pixel indices to world using an affine matrix.
 *
 * @param pixelCoord - Pixel indices [z, y, x]
 * @param affine - 4x4 affine matrix (pixel to world)
 * @returns World coordinate [x, y, z]
 */
export function pixelToWorldAffine(
  pixelCoord: [number, number, number],
  affine: mat4,
): [number, number, number] {
  // pixelCoord is [z, y, x], affine expects [x, y, z]
  const pixelVec = vec4.fromValues(
    pixelCoord[2], // x
    pixelCoord[1], // y
    pixelCoord[0], // z
    1,
  )
  const worldVec = vec4.create()
  vec4.transformMat4(worldVec, pixelVec, affine)

  return [worldVec[0], worldVec[1], worldVec[2]]
}

/**
 * Convert normalized volume coordinates (0-1) to world coordinates.
 *
 * @param normalizedCoord - Normalized coordinate [x, y, z] in range 0-1
 * @param ngffImage - The NgffImage
 * @returns World coordinate [x, y, z]
 */
export function normalizedToWorld(
  normalizedCoord: [number, number, number],
  ngffImage: NgffImage,
): [number, number, number] {
  const shape = ngffImage.data.shape
  const dims = ngffImage.dims

  // Find z, y, x indices in dims
  const zIdx = dims.indexOf("z")
  const yIdx = dims.indexOf("y")
  const xIdx = dims.indexOf("x")

  let dimX: number, dimY: number, dimZ: number
  if (zIdx === -1 || yIdx === -1 || xIdx === -1) {
    const n = shape.length
    dimZ = shape[n - 3] || 1
    dimY = shape[n - 2] || 1
    dimX = shape[n - 1] || 1
  } else {
    dimZ = shape[zIdx]
    dimY = shape[yIdx]
    dimX = shape[xIdx]
  }

  // Convert normalized to pixel
  const pixelCoord: [number, number, number] = [
    normalizedCoord[2] * dimZ, // z
    normalizedCoord[1] * dimY, // y
    normalizedCoord[0] * dimX, // x
  ]

  return pixelToWorld(pixelCoord, ngffImage)
}

/**
 * Convert world coordinates to normalized volume coordinates (0-1).
 *
 * @param worldCoord - World coordinate [x, y, z]
 * @param ngffImage - The NgffImage
 * @returns Normalized coordinate [x, y, z] in range 0-1
 */
export function worldToNormalized(
  worldCoord: [number, number, number],
  ngffImage: NgffImage,
): [number, number, number] {
  const shape = ngffImage.data.shape
  const dims = ngffImage.dims

  // Find z, y, x indices in dims
  const zIdx = dims.indexOf("z")
  const yIdx = dims.indexOf("y")
  const xIdx = dims.indexOf("x")

  let dimX: number, dimY: number, dimZ: number
  if (zIdx === -1 || yIdx === -1 || xIdx === -1) {
    const n = shape.length
    dimZ = shape[n - 3] || 1
    dimY = shape[n - 2] || 1
    dimX = shape[n - 1] || 1
  } else {
    dimZ = shape[zIdx]
    dimY = shape[yIdx]
    dimX = shape[xIdx]
  }

  // Convert world to pixel
  const pixelCoord = worldToPixel(worldCoord, ngffImage)

  // Convert pixel to normalized
  return [
    pixelCoord[2] / dimX, // x normalized
    pixelCoord[1] / dimY, // y normalized
    pixelCoord[0] / dimZ, // z normalized
  ]
}

/**
 * Clamp pixel coordinates to valid range for a volume.
 *
 * @param pixelCoord - Pixel indices [z, y, x]
 * @param shape - Volume shape [z, y, x]
 * @returns Clamped pixel indices [z, y, x]
 */
export function clampPixelCoord(
  pixelCoord: [number, number, number],
  shape: [number, number, number],
): [number, number, number] {
  return [
    Math.max(0, Math.min(pixelCoord[0], shape[0] - 1)),
    Math.max(0, Math.min(pixelCoord[1], shape[1] - 1)),
    Math.max(0, Math.min(pixelCoord[2], shape[2] - 1)),
  ]
}

/**
 * Round pixel coordinates to integers.
 *
 * @param pixelCoord - Pixel indices [z, y, x] (may be fractional)
 * @returns Rounded pixel indices [z, y, x]
 */
export function roundPixelCoord(
  pixelCoord: [number, number, number],
): [number, number, number] {
  return [
    Math.round(pixelCoord[0]),
    Math.round(pixelCoord[1]),
    Math.round(pixelCoord[2]),
  ]
}

/**
 * Floor pixel coordinates to integers (for region start).
 *
 * @param pixelCoord - Pixel indices [z, y, x] (may be fractional)
 * @returns Floored pixel indices [z, y, x]
 */
export function floorPixelCoord(
  pixelCoord: [number, number, number],
): [number, number, number] {
  return [
    Math.floor(pixelCoord[0]),
    Math.floor(pixelCoord[1]),
    Math.floor(pixelCoord[2]),
  ]
}

/**
 * Ceil pixel coordinates to integers (for region end).
 *
 * @param pixelCoord - Pixel indices [z, y, x] (may be fractional)
 * @returns Ceiled pixel indices [z, y, x]
 */
export function ceilPixelCoord(
  pixelCoord: [number, number, number],
): [number, number, number] {
  return [
    Math.ceil(pixelCoord[0]),
    Math.ceil(pixelCoord[1]),
    Math.ceil(pixelCoord[2]),
  ]
}
