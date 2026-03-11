import { useEffect, useState } from 'react'
import * as THREE from 'three'

// ── Constants ────────────────────────────────────────────────────────

export const CAMERA_FOV = 60
export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 400
export const CAMERA_Z = 0.01
export const SPHERE_RADIUS = 50
export const SPHERE_SEGMENTS = 32

// ── Pure factory (testable) ──────────────────────────────────────────

export function createThreeScene(width: number, height: number) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    width / height,
    CAMERA_NEAR,
    CAMERA_FAR,
  )
  camera.position.set(0, 0, CAMERA_Z)
  scene.add(camera)

  const geometry = new THREE.SphereGeometry(
    SPHERE_RADIUS,
    SPHERE_SEGMENTS,
    SPHERE_SEGMENTS,
  )
  const sphereMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide })
  const sphere = new THREE.Mesh(geometry, sphereMaterial)
  scene.add(sphere)

  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const dirLight = new THREE.DirectionalLight(0xffffff, 1)
  dirLight.position.set(5, 10, 5)
  scene.add(dirLight)

  return { scene, camera, sphere, sphereMaterial, geometry }
}

// ── Hook ─────────────────────────────────────────────────────────────

export interface ThreeSceneRefs {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  sphere: THREE.Mesh
  sphereMaterial: THREE.MeshBasicMaterial
  geometry: THREE.SphereGeometry
}

export function useThreeScene(
  mountRef: React.RefObject<HTMLDivElement | null>,
) {
  const [sceneRefs, setSceneRefs] = useState<ThreeSceneRefs | null>(null)

  useEffect(() => {
    if (!mountRef.current) return

    const width = window.innerWidth
    const height = window.innerHeight

    const { scene, camera, sphere, sphereMaterial, geometry } =
      createThreeScene(width, height)

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.BasicShadowMap
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mountRef.current.appendChild(renderer.domElement)

    setSceneRefs({ scene, camera, renderer, sphere, sphereMaterial, geometry })

    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    const currentMount = mountRef.current

    return () => {
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      geometry.dispose()
      sphereMaterial.dispose()
      currentMount?.removeChild(renderer.domElement)
      setSceneRefs(null)
    }
  }, [mountRef])

  return sceneRefs
}
