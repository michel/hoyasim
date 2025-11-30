import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { Button } from '@/components/ui/button'
import { type GlassesState, loadGlasses } from '@/lib/glasses'
import type { SceneModel } from '@/pages/Scene'

interface ThreeViewProps {
  image: string
  models?: SceneModel[]
  onReady?: (ref: {
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
  }) => void
  onGlassesReady?: (controls: {
    swapLeft: () => void
    swapRight: () => void
  }) => void
}

export default function ThreeView({
  image,
  models,
  onReady,
  onGlassesReady,
}: ThreeViewProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const glassesRef = useRef<GlassesState | null>(null)
  const gyroActiveRef = useRef(false)
  const orientationRef = useRef<'portrait' | 'landscape'>(
    typeof window !== 'undefined' && window.innerWidth > window.innerHeight
      ? 'landscape'
      : 'portrait',
  )
  const lonRef = useRef(0)
  const latRef = useRef(0)
  const [showEnableButton, setShowEnableButton] = useState(false)
  const [gyroActive, setGyroActive] = useState(false)
  const [loading, setLoading] = useState(true)

  // Check if we need to show permission button (iOS)
  useEffect(() => {
    const isIOS =
      typeof (
        DeviceOrientationEvent as unknown as {
          requestPermission?: () => Promise<string>
        }
      ).requestPermission === 'function'
    setShowEnableButton(isIOS)
  }, [])

  const enableMotionControls = async () => {
    try {
      const permission = await (
        DeviceOrientationEvent as unknown as {
          requestPermission: () => Promise<string>
        }
      ).requestPermission()
      if (permission === 'granted') {
        gyroActiveRef.current = true
        setGyroActive(true)
        setShowEnableButton(false)
      }
    } catch {
      // Permission denied
    }
  }

  useEffect(() => {
    if (!mountRef.current) return
    setLoading(true)

    const width = window.innerWidth
    const height = window.innerHeight

    // Scene & Camera
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100)
    camera.position.set(0, 0, 0.01)
    cameraRef.current = camera
    scene.add(camera)

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    mountRef.current.appendChild(renderer.domElement)

    // 360 Sphere
    const geometry = new THREE.SphereGeometry(50, 64, 64)
    const material = new THREE.MeshBasicMaterial({ side: THREE.BackSide })
    const sphere = new THREE.Mesh(geometry, material)
    scene.add(sphere)

    // Track loading state
    const totalModels = models?.length || 0
    let textureLoaded = false
    let modelsLoaded = 0

    const checkLoadingComplete = () => {
      if (textureLoaded && modelsLoaded === totalModels) setLoading(false)
    }

    const onTextureLoaded = (texture: THREE.Texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping
      material.map = texture
      material.needsUpdate = true
      textureLoaded = true
      checkLoadingComplete()
    }

    // Load texture
    if (image.endsWith('.exr')) {
      new EXRLoader().load(image, onTextureLoaded)
    } else if (image.endsWith('.hdr')) {
      new RGBELoader().load(image, onTextureLoaded)
    } else {
      new THREE.TextureLoader().load(image, onTextureLoaded)
    }

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const dirLight = new THREE.DirectionalLight(0xffffff, 1)
    dirLight.position.set(5, 10, 5)
    scene.add(dirLight)

    // Load models
    models?.forEach((model) => {
      new GLTFLoader().load(model.path, (gltf) => {
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
        modelsLoaded++
        checkLoadingComplete()
      })
    })

    // Mouse/Touch drag controls (fallback)
    let isUserInteracting = false
    let onPointerDownLon = 0,
      onPointerDownLat = 0,
      startX = 0,
      startY = 0

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      isUserInteracting = true
      startX = 'touches' in e ? e.touches[0].clientX : e.clientX
      startY = 'touches' in e ? e.touches[0].clientY : e.clientY
      onPointerDownLon = lonRef.current
      onPointerDownLat = latRef.current
    }

    const onPointerMove = (e: MouseEvent | TouchEvent) => {
      if (!isUserInteracting) return
      const x = 'touches' in e ? e.touches[0].clientX : e.clientX
      const y = 'touches' in e ? e.touches[0].clientY : e.clientY
      lonRef.current = (startX - x) * 0.1 + onPointerDownLon
      latRef.current = (y - startY) * 0.1 + onPointerDownLat
    }

    const onPointerUp = () => {
      isUserInteracting = false
    }

    renderer.domElement.addEventListener('mousedown', onPointerDown)
    renderer.domElement.addEventListener('mousemove', onPointerMove)
    renderer.domElement.addEventListener('mouseup', onPointerUp)
    renderer.domElement.addEventListener('touchstart', onPointerDown)
    renderer.domElement.addEventListener('touchmove', onPointerMove)
    renderer.domElement.addEventListener('touchend', onPointerUp)

    // Resize handler with orientation change detection
    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)

      // Detect orientation change
      const newOrientation = w > h ? 'landscape' : 'portrait'
      if (newOrientation !== orientationRef.current) {
        orientationRef.current = newOrientation
        // Reset to initial view
        lonRef.current = 0
        latRef.current = 0
        camera.position.set(0, 0, 0.01)
        camera.quaternion.set(0, 0, 0, 1)
        camera.lookAt(0, 0, 0)
      }
    }
    window.addEventListener('resize', onResize)

    // Load glasses
    loadGlasses(camera).then((glasses) => {
      glassesRef.current = glasses
      onGlassesReady?.({
        swapLeft: glasses.swapLeft,
        swapRight: glasses.swapRight,
      })
    })

    // Polar angle limits for glasses effects
    const minPolarAngle = Math.PI / 2.5
    const maxPolarAngle = Math.PI / 1.6

    // Animate
    let animationId: number
    const animate = () => {
      // Only use drag controls when gyro not active
      if (!gyroActiveRef.current) {
        latRef.current = Math.max(-85, Math.min(85, latRef.current))
        const phi = THREE.MathUtils.degToRad(90 - latRef.current)
        const theta = THREE.MathUtils.degToRad(lonRef.current)
        camera.lookAt(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta),
        )
      }

      // Update glasses effects based on camera polar angle
      if (glassesRef.current) {
        // Calculate polar angle from camera direction
        const direction = new THREE.Vector3(0, 0, -1)
        direction.applyQuaternion(camera.quaternion)
        const polarAngle = Math.acos(direction.y)
        glassesRef.current.update(polarAngle, minPolarAngle, maxPolarAngle)
        glassesRef.current.animateSwap()
      }

      renderer.render(scene, camera)
      animationId = requestAnimationFrame(animate)
    }
    animate()

    onReady?.({ scene, camera, renderer })

    const currentMount = mountRef.current

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('mousedown', onPointerDown)
      renderer.domElement.removeEventListener('mousemove', onPointerMove)
      renderer.domElement.removeEventListener('mouseup', onPointerUp)
      renderer.domElement.removeEventListener('touchstart', onPointerDown)
      renderer.domElement.removeEventListener('touchmove', onPointerMove)
      renderer.domElement.removeEventListener('touchend', onPointerUp)
      glassesRef.current?.dispose()
      glassesRef.current = null
      renderer.dispose()
      geometry.dispose()
      material.dispose()
      currentMount?.removeChild(renderer.domElement)
    }
  }, [image, models, onReady, onGlassesReady])

  // Device orientation handler - runs when gyro is active
  useEffect(() => {
    if (!gyroActive || !cameraRef.current) return

    const camera = cameraRef.current
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))

    // Capture initial device orientation to calculate offset
    let initialOrientation: {
      alpha: number
      beta: number
      gamma: number
    } | null = null

    const setObjectQuaternion = (
      quaternion: THREE.Quaternion,
      alpha: number,
      beta: number,
      gamma: number,
      orient: number,
    ) => {
      const euler = new THREE.Euler()
      const q0 = new THREE.Quaternion()

      euler.set(beta, alpha, -gamma, 'YXZ')
      quaternion.setFromEuler(euler)
      quaternion.multiply(q1)
      quaternion.multiply(
        q0.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient),
      )
    }

    const onDeviceOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null || event.gamma === null)
        return

      // Capture initial orientation on first reading
      if (initialOrientation === null) {
        initialOrientation = {
          alpha: event.alpha,
          beta: event.beta,
          gamma: event.gamma,
        }
      }

      const screenAngle = screen.orientation?.angle || 0

      // Apply offset so view starts at scene's starting position
      // Starting position = looking at +X = alpha -90°, beta 90° (upright), gamma 0°
      const adjustedAlpha = event.alpha - initialOrientation.alpha - 90
      const adjustedBeta = event.beta - initialOrientation.beta + 90
      const adjustedGamma = event.gamma - initialOrientation.gamma

      const alpha = THREE.MathUtils.degToRad(adjustedAlpha)
      const beta = THREE.MathUtils.degToRad(adjustedBeta)
      const gamma = THREE.MathUtils.degToRad(adjustedGamma)
      const orient = THREE.MathUtils.degToRad(screenAngle)

      setObjectQuaternion(camera.quaternion, alpha, beta, gamma, orient)
    }

    window.addEventListener('deviceorientation', onDeviceOrientation)

    return () => {
      window.removeEventListener('deviceorientation', onDeviceOrientation)
    }
  }, [gyroActive])

  // For non-iOS devices, try to enable gyro automatically
  useEffect(() => {
    const isIOS =
      typeof (
        DeviceOrientationEvent as unknown as {
          requestPermission?: () => Promise<string>
        }
      ).requestPermission === 'function'
    if (isIOS) return

    // Check if device orientation is available
    const testOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha !== null) {
        gyroActiveRef.current = true
        setGyroActive(true)
      }
      window.removeEventListener('deviceorientation', testOrientation)
    }
    window.addEventListener('deviceorientation', testOrientation)

    return () =>
      window.removeEventListener('deviceorientation', testOrientation)
  }, [])

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
      }}
    >
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black">
          <div className="text-white text-lg">Loading scene...</div>
        </div>
      )}
      {showEnableButton && !gyroActive && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
          }}
        >
          <Button size="lg" onClick={enableMotionControls}>
            Tap to Enable Motion Controls
          </Button>
        </div>
      )}
    </div>
  )
}
