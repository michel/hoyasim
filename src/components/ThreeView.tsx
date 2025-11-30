import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { Button } from '@/components/ui/button'
import { type GlassesState, loadGlasses } from '@/lib/glasses'
import type { SceneModel } from '@/pages/Scene'

interface DeviceOrientationEventiOS extends DeviceOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const DeviceOrientationEventiOS =
  DeviceOrientationEvent as unknown as DeviceOrientationEventiOS & {
    requestPermission?: () => Promise<'granted' | 'denied'>
  }

interface ThreeViewProps {
  image: string
  models?: SceneModel[]
  gyroActive: boolean
  onGyroActiveChange: (active: boolean) => void
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
  gyroActive,
  onGyroActiveChange,
  onReady,
  onGlassesReady,
}: ThreeViewProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const glassesRef = useRef<GlassesState | null>(null)
  const gyroActiveRef = useRef(gyroActive)
  const lonRef = useRef(0)
  const latRef = useRef(0)
  const [showEnableButton, setShowEnableButton] = useState(false)
  const [loading, setLoading] = useState(true)

  // Keep ref in sync with prop
  gyroActiveRef.current = gyroActive

  // Check if we need to show permission button (iOS)
  useEffect(() => {
    const isIOS =
      typeof DeviceOrientationEventiOS.requestPermission === 'function'
    setShowEnableButton(isIOS)
  }, [])

  const enableMotionControls = async () => {
    try {
      const permission = await DeviceOrientationEventiOS.requestPermission?.()
      if (permission === 'granted') {
        onGyroActiveChange(true)
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
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100)
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

    // Configure Draco loader for compressed GLB files
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath(
      'https://www.gstatic.com/draco/versioned/decoders/1.5.7/',
    )
    const gltfLoader = new GLTFLoader()
    gltfLoader.setDRACOLoader(dracoLoader)

    // Load models
    models?.forEach((model) => {
      gltfLoader.load(model.path, (gltf) => {
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

    // Resize handler
    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
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
      dracoLoader.dispose()
      renderer.dispose()
      geometry.dispose()
      material.dispose()
      currentMount?.removeChild(renderer.domElement)
    }
  }, [image, models, onReady, onGlassesReady])

  // Device orientation handler - runs when gyro is active
  // Based on three.js DeviceOrientationControls reference implementation
  // Re-runs when image changes (new camera created) or gyroActive changes
  useEffect(() => {
    if (!gyroActive || !cameraRef.current) return

    const camera = cameraRef.current

    // Pre-allocated quaternions for performance
    const zee = new THREE.Vector3(0, 0, 1)
    const euler = new THREE.Euler()
    const q0 = new THREE.Quaternion()
    // World correction: -90° rotation around X to align Three.js camera with device
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))

    // Alpha offset to align initial view direction
    let alphaOffset = 0
    let hasInitialized = false

    // Standard three.js device orientation quaternion algorithm
    const setObjectQuaternion = (
      quaternion: THREE.Quaternion,
      alpha: number,
      beta: number,
      gamma: number,
      orient: number,
    ) => {
      // Device orientation -> Euler angles (Tait-Bryan ZXY -> YXZ order)
      euler.set(beta, alpha, -gamma, 'YXZ')
      quaternion.setFromEuler(euler)
      // Camera looks out the back of the device
      quaternion.multiply(q1)
      // Adjust for screen orientation (rotation around Z-axis)
      quaternion.multiply(q0.setFromAxisAngle(zee, -orient))
    }

    const onDeviceOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null || event.gamma === null)
        return

      // Capture initial alpha to start looking forward in the scene
      if (!hasInitialized) {
        alphaOffset = -event.alpha 
        hasInitialized = true
      }

      const alpha = THREE.MathUtils.degToRad(event.alpha + alphaOffset)
      const beta = THREE.MathUtils.degToRad(event.beta)
      const gamma = THREE.MathUtils.degToRad(event.gamma)
      const orient = THREE.MathUtils.degToRad(screen.orientation?.angle || 0)

      setObjectQuaternion(camera.quaternion, alpha, beta, gamma, orient)
    }

    window.addEventListener('deviceorientation', onDeviceOrientation)

    return () => {
      window.removeEventListener('deviceorientation', onDeviceOrientation)
    }
  }, [gyroActive, image])

  // For non-iOS devices, try to enable gyro automatically
  useEffect(() => {
    const isIOS =
      typeof DeviceOrientationEventiOS.requestPermission === 'function'
    if (isIOS) return

    // Check if device orientation is available
    const testOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha !== null) onGyroActiveChange(true)
      window.removeEventListener('deviceorientation', testOrientation)
    }
    window.addEventListener('deviceorientation', testOrientation)

    return () =>
      window.removeEventListener('deviceorientation', testOrientation)
  }, [onGyroActiveChange])

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
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-950 via-slate-900 to-zinc-900">
          <div className="glass rounded-3xl p-8 flex flex-col items-center gap-4 shadow-2xl">
            <Loader2 className="h-10 w-10 animate-spin text-white/80" />
            <div className="text-white/90 text-lg font-light">Loading scene...</div>
          </div>
        </div>
      )}
      {showEnableButton && !gyroActive && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <Button variant="glass" size="lg" onClick={enableMotionControls}>
            Tap to Enable Motion Controls
          </Button>
        </div>
      )}
    </div>
  )
}
