import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import type { SceneConfig, SceneModel } from '@/config/scenes'
import { type BlocksState, createBlocks } from '@/lib/blocks'
import { type GlassesState, loadGlasses } from '@/lib/glasses'
import { gltfLoader } from '@/lib/loaders'
import { LAT_MAX, LAT_MIN } from './usePointerControls'

// ── Constants ────────────────────────────────────────────────────────

export const POLAR_ANGLE_MIN = Math.PI / 2.5
export const POLAR_ANGLE_MAX = Math.PI / 1.6

const _direction = new THREE.Vector3()

// ── Hook ─────────────────────────────────────────────────────────────

export function useAssetLoader(
  scene: THREE.Scene | null,
  camera: THREE.PerspectiveCamera | null,
  renderer: THREE.WebGLRenderer | null,
  sphere: THREE.Mesh | null,
  sphereMaterial: THREE.MeshBasicMaterial | null,
  image: string,
  models: SceneModel[] | undefined,
  effects: SceneConfig['effects'] | undefined,
  gyroActiveRef: React.RefObject<boolean>,
  lonRef: React.RefObject<number>,
  latRef: React.RefObject<number>,
  onGlassesReady?: (controls: {
    swapLeft: () => void
    swapRight: () => void
  }) => void,
) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const glassesRef = useRef<GlassesState | null>(null)
  const blocksRef = useRef<BlocksState | null>(null)
  const onGlassesReadyRef = useRef(onGlassesReady)
  onGlassesReadyRef.current = onGlassesReady

  useEffect(() => {
    if (!scene || !camera || !renderer || !sphere || !sphereMaterial) return

    setLoading(true)
    setError(null)

    let disposed = false
    const loadedObjects: THREE.Object3D[] = []

    // Load texture (skip for blocks mode — use dark night sky instead)
    const hasBlocks = !!effects?.blocks
    let texturePromise: Promise<void>

    if (hasBlocks) {
      const skyColor = 0x5da6e6
      scene.background = new THREE.Color(skyColor)
      scene.fog = new THREE.FogExp2(skyColor, 0.008)
      sphere.visible = false
      texturePromise = Promise.resolve()
    } else {
      texturePromise = new Promise<void>((resolve, reject) => {
        const onLoaded = (texture: THREE.Texture) => {
          if (disposed) {
            texture.dispose()
            return resolve()
          }
          texture.mapping = THREE.EquirectangularReflectionMapping
          sphereMaterial.map = texture
          sphereMaterial.needsUpdate = true
          resolve()
        }
        const onError = () => reject(new Error('Failed to load scene texture'))

        if (image.endsWith('.exr'))
          new EXRLoader().load(image, onLoaded, undefined, onError)
        else if (image.endsWith('.hdr'))
          new RGBELoader().load(image, onLoaded, undefined, onError)
        else new THREE.TextureLoader().load(image, onLoaded, undefined, onError)
      })
    }

    // Load models
    const modelPromises = (models ?? []).map(
      (model) =>
        new Promise<void>((resolve, reject) => {
          gltfLoader.load(
            model.path,
            (gltf) => {
              if (disposed) return resolve()
              const obj = gltf.scene
              obj.position.set(...model.position)
              if (model.rotation) obj.rotation.set(...model.rotation)
              if (model.scale) {
                const s = Array.isArray(model.scale)
                  ? model.scale
                  : [model.scale, model.scale, model.scale]
                obj.scale.set(...(s as [number, number, number]))
              }
              scene.add(obj)
              loadedObjects.push(obj)
              resolve()
            },
            undefined,
            () => reject(new Error(`Failed to load model: ${model.path}`)),
          )
        }),
    )

    // Load glasses
    const glassesPromise = loadGlasses(camera).then((glasses) => {
      if (disposed) return glasses.dispose()
      glassesRef.current = glasses
      onGlassesReadyRef.current?.({
        swapLeft: glasses.swapLeft,
        swapRight: glasses.swapRight,
      })
    })

    if (effects?.blocks) {
      blocksRef.current = createBlocks(scene)
    }

    Promise.all([texturePromise, ...modelPromises, glassesPromise])
      .catch((err) => {
        if (!disposed) setError(err.message)
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })

    // Animation loop
    let animationId: number
    let prevTime = performance.now()
    const animate = () => {
      const now = performance.now()
      const delta = (now - prevTime) / 1000
      prevTime = now
      if (!gyroActiveRef.current) {
        latRef.current = Math.max(LAT_MIN, Math.min(LAT_MAX, latRef.current))
        const phi = THREE.MathUtils.degToRad(90 - latRef.current)
        const theta = THREE.MathUtils.degToRad(lonRef.current)
        camera.lookAt(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta),
        )
      }

      if (glassesRef.current) {
        _direction.set(0, 0, -1).applyQuaternion(camera.quaternion)
        const polarAngle = Math.acos(_direction.y)
        glassesRef.current.update(polarAngle, POLAR_ANGLE_MIN, POLAR_ANGLE_MAX)
        glassesRef.current.animateSwap()
      }

      const offset = blocksRef.current?.update(delta)
      if (offset) {
        camera.position.x = offset.x
        camera.position.y = offset.y
      }

      renderer.render(scene, camera)
      animationId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(animationId)

      for (const obj of loadedObjects) {
        scene.remove(obj)
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            if (Array.isArray(child.material))
              child.material.forEach((m) => {
                m.dispose()
              })
            else child.material.dispose()
          }
        })
      }

      if (sphereMaterial.map) {
        sphereMaterial.map.dispose()
        sphereMaterial.map = null
      }

      glassesRef.current?.dispose()
      glassesRef.current = null

      blocksRef.current?.dispose()
      blocksRef.current = null

      if (hasBlocks) {
        scene.background = null
        scene.fog = null
        sphere.visible = true
      }
    }
  }, [
    scene,
    camera,
    renderer,
    sphere,
    sphereMaterial,
    image,
    models,
    effects,
    gyroActiveRef,
    lonRef,
    latRef,
  ])

  return { loading, error }
}
