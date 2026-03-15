import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import type { SceneConfig, SceneModel } from '@/config/scenes'
import { type BlocksState, createBlocks } from '@/lib/blocks'
import { type GlassesState, loadGlasses } from '@/lib/glasses'
import { gltfLoader } from '@/lib/loaders'

const LOAD_TIMEOUT_MS = 30_000

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Timed out loading ${label}`)),
      LOAD_TIMEOUT_MS,
    ),
  )
  return Promise.race([promise, timeout])
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useAssetLoader(
  scene: THREE.Scene | null,
  camera: THREE.PerspectiveCamera | null,
  image: string,
  models: SceneModel[] | undefined,
  effects: SceneConfig['effects'] | undefined,
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
    if (!scene || !camera) return

    setLoading(true)
    setError(null)

    const controller = new AbortController()
    const { signal } = controller
    const loadedObjects: THREE.Object3D[] = []

    const hasBlocks = !!effects?.blocks
    let texturePromise: Promise<void>

    if (hasBlocks) {
      const skyColor = 0x5da6e6
      scene.background = new THREE.Color(skyColor)
      scene.fog = new THREE.Fog(skyColor, 20, 80)
      texturePromise = Promise.resolve()
    } else {
      texturePromise = new Promise<void>((resolve, reject) => {
        const onLoaded = (texture: THREE.Texture) => {
          if (signal.aborted) {
            texture.dispose()
            return resolve()
          }
          texture.mapping = THREE.EquirectangularReflectionMapping
          scene.background = texture
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
              if (signal.aborted) return resolve()
              const obj = gltf.scene
              obj.position.set(...model.position)
              if (model.rotation) obj.rotation.set(...model.rotation)
              if (model.scale) {
                const s = Array.isArray(model.scale)
                  ? model.scale
                  : [model.scale, model.scale, model.scale]
                obj.scale.set(...(s as [number, number, number]))
              }
              obj.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  const mats = Array.isArray(child.material)
                    ? child.material
                    : [child.material]
                  for (const m of mats) m.transparent = false
                }
              })
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
      if (signal.aborted) return glasses.dispose()
      glassesRef.current = glasses
      onGlassesReadyRef.current?.({
        swapLeft: glasses.swapLeft,
        swapRight: glasses.swapRight,
      })
    })

    if (effects?.blocks) blocksRef.current = createBlocks(scene)

    withTimeout(
      Promise.all([texturePromise, ...modelPromises, glassesPromise]),
      'scene assets',
    )
      .catch((err) => {
        if (!signal.aborted) setError(err.message)
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false)
      })

    return () => {
      controller.abort()

      for (const obj of loadedObjects) {
        scene.remove(obj)
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            if (Array.isArray(child.material))
              for (const m of child.material) m.dispose()
            else child.material.dispose()
          }
        })
      }

      if (scene.background instanceof THREE.Texture) {
        scene.background.dispose()
        scene.background = null
      }

      glassesRef.current?.dispose()
      glassesRef.current = null

      blocksRef.current?.dispose()
      blocksRef.current = null

      if (hasBlocks) {
        scene.background = null
        scene.fog = null
      }
    }
  }, [scene, camera, image, models, effects])

  return { loading, error, glassesRef, blocksRef }
}
