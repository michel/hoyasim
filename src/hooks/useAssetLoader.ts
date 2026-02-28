import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import type { SceneModel } from '@/config/scenes'
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
  sphereMaterial: THREE.MeshBasicMaterial | null,
  image: string,
  models: SceneModel[] | undefined,
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

  useEffect(() => {
    if (!scene || !camera || !renderer || !sphereMaterial) return

    setLoading(true)
    setError(null)

    const totalModels = models?.length || 0
    let textureLoaded = false
    let modelsLoaded = 0

    const checkLoadingComplete = () => {
      if (textureLoaded && modelsLoaded === totalModels) setLoading(false)
    }

    const onTextureLoaded = (texture: THREE.Texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping
      sphereMaterial.map = texture
      sphereMaterial.needsUpdate = true
      textureLoaded = true
      checkLoadingComplete()
    }

    const onTextureError = () => {
      setError('Failed to load scene texture')
      setLoading(false)
    }

    // Load texture based on file extension
    if (image.endsWith('.exr'))
      new EXRLoader().load(image, onTextureLoaded, undefined, onTextureError)
    else if (image.endsWith('.hdr'))
      new RGBELoader().load(image, onTextureLoaded, undefined, onTextureError)
    else
      new THREE.TextureLoader().load(
        image,
        onTextureLoaded,
        undefined,
        onTextureError,
      )

    // Track loaded objects for cleanup
    const loadedObjects: THREE.Object3D[] = []

    // Load scene models
    models?.forEach((model) => {
      gltfLoader.load(
        model.path,
        (gltf) => {
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
          modelsLoaded++
          checkLoadingComplete()
        },
        undefined,
        () => {
          setError(`Failed to load model: ${model.path}`)
          modelsLoaded++
          checkLoadingComplete()
        },
      )
    })

    // Load glasses
    loadGlasses(camera)
      .then((glasses) => {
        glassesRef.current = glasses
        onGlassesReady?.({
          swapLeft: glasses.swapLeft,
          swapRight: glasses.swapRight,
        })
      })
      .catch(() => {
        setError('Failed to load glasses overlay')
      })

    // Animation loop
    let animationId: number
    const animate = () => {
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

      renderer.render(scene, camera)
      animationId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
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
    }
  }, [
    scene,
    camera,
    renderer,
    sphereMaterial,
    image,
    models,
    gyroActiveRef,
    lonRef,
    latRef,
    onGlassesReady,
  ])

  return { loading, error }
}
