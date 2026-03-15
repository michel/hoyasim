import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

// ── Constants ────────────────────────────────────────────────────────

export const CAMERA_FOV = 60
export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 400
export const CAMERA_Z = 0.01

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

  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const dirLight = new THREE.DirectionalLight(0xffffff, 1)
  dirLight.position.set(5, 10, 5)
  scene.add(dirLight)

  return { scene, camera }
}

// ── Hook ─────────────────────────────────────────────────────────────

export interface ThreeSceneRefs {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
}

export function useThreeScene(
  mountRef: React.RefObject<HTMLDivElement | null>,
) {
  const refs = useRef<ThreeSceneRefs | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!mountRef.current) return

    const width = window.innerWidth
    const height = window.innerHeight

    const { scene, camera } = createThreeScene(width, height)

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.BasicShadowMap
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mountRef.current.appendChild(renderer.domElement)

    refs.current = { scene, camera, renderer }
    setReady(true)

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
      currentMount?.removeChild(renderer.domElement)
      refs.current = null
      setReady(false)
    }
  }, [mountRef])

  return ready ? refs.current : null
}
