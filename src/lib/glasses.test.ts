import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createFrameMaterial,
  createGradientCanvas,
  createLeftLensMaterial,
  createMaskMaterial,
  createRightLensMaterial,
  GRADIENT_SIZE,
  LENS_POSITION,
  LENS_SCALE,
  PROGRESSIVE_POWER,
  SWAP_HIDDEN_Y,
  SWAP_LERP_SPEED,
  SWAP_SHOWN_Y,
  SWAP_SNAP_THRESHOLD,
  SWAP_VISIBLE_Y,
} from './glasses'

describe('glasses constants', () => {
  it('LENS_SCALE has expected shape', () => {
    expect(LENS_SCALE).toEqual({ x: 0.1125, y: 0.1125, z: 0.1875 })
  })

  it('LENS_POSITION has left/right/z values', () => {
    expect(LENS_POSITION.leftX).toBe(-0.2625)
    expect(LENS_POSITION.rightX).toBe(0.2625)
    expect(LENS_POSITION.z).toBe(-0.4875)
  })

  it('SWAP constants are defined', () => {
    expect(SWAP_LERP_SPEED).toBe(0.08)
    expect(SWAP_SNAP_THRESHOLD).toBe(0.001)
    expect(SWAP_HIDDEN_Y).toBe(-0.6)
    expect(SWAP_VISIBLE_Y).toBe(0.6)
    expect(SWAP_SHOWN_Y).toBe(0)
  })

  it('GRADIENT_SIZE is 256', () => {
    expect(GRADIENT_SIZE).toBe(256)
  })
})

describe('createFrameMaterial', () => {
  it('returns a black glossy transparent MeshStandardMaterial', () => {
    const mat = createFrameMaterial()
    expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(mat.color.getHex()).toBe(0x000000)
    expect(mat.roughness).toBe(0.1)
    expect(mat.metalness).toBe(0.0)
    expect(mat.transparent).toBe(true)
    expect(mat.opacity).toBe(1)
    expect(mat.depthWrite).toBe(true)
  })
})

describe('createMaskMaterial', () => {
  it('returns semi-transparent gray material', () => {
    const mat = createMaskMaterial()
    expect(mat).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect(mat.transmission).toBe(0.95)
    expect(mat.onBeforeCompile).toBeTypeOf('function')
    expect(mat.customProgramCacheKey()).toBe('mask-opaque-transmission')
  })
})

describe('createLeftLensMaterial', () => {
  it('returns transmissive material with the given texture as thicknessMap', () => {
    const tex = new THREE.Texture()
    const mat = createLeftLensMaterial(tex)
    expect(mat.transmission).toBe(1)
    expect(mat.thicknessMap).toBe(tex)
    expect(mat.roughnessMap).toBe(tex)
  })
})

describe('createGradientCanvas', () => {
  it('returns canvas of GRADIENT_SIZE and a CanvasTexture', () => {
    const { canvas, texture } = createGradientCanvas()
    expect(canvas.width).toBe(GRADIENT_SIZE)
    expect(canvas.height).toBe(GRADIENT_SIZE)
    expect(texture).toBeInstanceOf(THREE.CanvasTexture)
  })
})

describe('createRightLensMaterial', () => {
  it('returns material with gradient texture as thicknessMap and roughnessMap', () => {
    const { texture } = createGradientCanvas()
    const roughness = new THREE.Texture()
    const mat = createRightLensMaterial(texture, [], roughness)
    expect(mat.transmission).toBe(1)
    expect(mat.thicknessMap).toBe(texture)
    expect(mat.roughnessMap).toBe(roughness)
  })

  it('has onBeforeCompile for progressive lens effect', () => {
    const { texture } = createGradientCanvas()
    const mat = createRightLensMaterial(texture, [], new THREE.Texture())
    expect(mat.onBeforeCompile).toBeTypeOf('function')
    expect(mat.customProgramCacheKey()).toBe('progressive-lens')
  })
})

describe('PROGRESSIVE_POWER', () => {
  it('is exported with expected value', () => {
    expect(PROGRESSIVE_POWER).toBe(0.35)
  })
})
