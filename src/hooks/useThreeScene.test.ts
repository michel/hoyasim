import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_Z,
  createThreeScene,
  SPHERE_RADIUS,
  SPHERE_SEGMENTS,
} from './useThreeScene'

describe('ThreeScene constants', () => {
  it('camera defaults', () => {
    expect(CAMERA_FOV).toBe(60)
    expect(CAMERA_NEAR).toBe(0.1)
    expect(CAMERA_FAR).toBe(400)
    expect(CAMERA_Z).toBe(0.01)
  })

  it('sphere defaults', () => {
    expect(SPHERE_RADIUS).toBe(50)
    expect(SPHERE_SEGMENTS).toBe(32)
  })
})

describe('createThreeScene', () => {
  it('returns scene, camera, sphere, and material', () => {
    const result = createThreeScene(800, 600)
    expect(result.scene).toBeInstanceOf(THREE.Scene)
    expect(result.camera).toBeInstanceOf(THREE.PerspectiveCamera)
    expect(result.sphere).toBeInstanceOf(THREE.Mesh)
    expect(result.sphereMaterial).toBeInstanceOf(THREE.MeshBasicMaterial)
  })

  it('camera has correct FOV and aspect ratio', () => {
    const { camera } = createThreeScene(1600, 900)
    expect(camera.fov).toBe(CAMERA_FOV)
    expect(camera.aspect).toBeCloseTo(1600 / 900)
    expect(camera.near).toBe(CAMERA_NEAR)
    expect(camera.far).toBe(CAMERA_FAR)
  })

  it('camera is added to scene', () => {
    const { scene, camera } = createThreeScene(800, 600)
    expect(scene.children).toContain(camera)
  })

  it('sphere uses BackSide material', () => {
    const { sphereMaterial } = createThreeScene(800, 600)
    expect(sphereMaterial.side).toBe(THREE.BackSide)
  })

  it('scene includes ambient and directional lights', () => {
    const { scene } = createThreeScene(800, 600)
    const lights = scene.children.filter(
      (c) =>
        c instanceof THREE.AmbientLight || c instanceof THREE.DirectionalLight,
    )
    expect(lights.length).toBe(2)
  })
})
