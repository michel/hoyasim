import { useRef, useEffect, useState } from "react"
import * as THREE from "three"
import { EXRLoader } from "three/addons/loaders/EXRLoader.js"
import { Button } from "@/components/ui/button"

interface ThreeViewProps {
  image: string
  onReady?: (ref: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer }) => void
}

export default function ThreeView({ image, onReady }: ThreeViewProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const gyroActiveRef = useRef(false)
  const orientationRef = useRef<'portrait' | 'landscape'>(
    typeof window !== 'undefined' && window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
  )
  const lonRef = useRef(0)
  const latRef = useRef(0)
  const [showEnableButton, setShowEnableButton] = useState(false)
  const [gyroActive, setGyroActive] = useState(false)

  // Check if we need to show permission button (iOS)
  useEffect(() => {
    const isIOS = typeof (DeviceOrientationEvent as any).requestPermission === "function"
    setShowEnableButton(isIOS)
  }, [])

  const enableMotionControls = async () => {
    try {
      const permission = await (DeviceOrientationEvent as any).requestPermission()
      if (permission === "granted") {
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

    const width = window.innerWidth
    const height = window.innerHeight

    // Scene & Camera
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100)
    camera.position.set(0, 0, 0.01)
    cameraRef.current = camera

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

    // Load texture
    if (image.endsWith(".exr")) {
      new EXRLoader().load(image, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping
        material.map = texture
        material.needsUpdate = true
      })
    } else {
      const texture = new THREE.TextureLoader().load(image)
      material.map = texture
    }

    // Mouse/Touch drag controls (fallback)
    let isUserInteracting = false
    let onPointerDownLon = 0, onPointerDownLat = 0, startX = 0, startY = 0

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      isUserInteracting = true
      startX = "touches" in e ? e.touches[0].clientX : e.clientX
      startY = "touches" in e ? e.touches[0].clientY : e.clientY
      onPointerDownLon = lonRef.current
      onPointerDownLat = latRef.current
    }

    const onPointerMove = (e: MouseEvent | TouchEvent) => {
      if (!isUserInteracting) return
      const x = "touches" in e ? e.touches[0].clientX : e.clientX
      const y = "touches" in e ? e.touches[0].clientY : e.clientY
      lonRef.current = (startX - x) * 0.1 + onPointerDownLon
      latRef.current = (y - startY) * 0.1 + onPointerDownLat
    }

    const onPointerUp = () => (isUserInteracting = false)

    renderer.domElement.addEventListener("mousedown", onPointerDown)
    renderer.domElement.addEventListener("mousemove", onPointerMove)
    renderer.domElement.addEventListener("mouseup", onPointerUp)
    renderer.domElement.addEventListener("touchstart", onPointerDown)
    renderer.domElement.addEventListener("touchmove", onPointerMove)
    renderer.domElement.addEventListener("touchend", onPointerUp)

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
    window.addEventListener("resize", onResize)


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
          Math.sin(phi) * Math.sin(theta)
        )
      }
      renderer.render(scene, camera)
      animationId = requestAnimationFrame(animate)
    }
    animate()

    onReady?.({ scene, camera, renderer })

    const currentMount = mountRef.current

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener("resize", onResize)
      renderer.domElement.removeEventListener("mousedown", onPointerDown)
      renderer.domElement.removeEventListener("mousemove", onPointerMove)
      renderer.domElement.removeEventListener("mouseup", onPointerUp)
      renderer.domElement.removeEventListener("touchstart", onPointerDown)
      renderer.domElement.removeEventListener("touchmove", onPointerMove)
      renderer.domElement.removeEventListener("touchend", onPointerUp)
      renderer.dispose()
      geometry.dispose()
      material.dispose()
      currentMount?.removeChild(renderer.domElement)
    }
  }, [image, onReady])

  // Device orientation handler - runs when gyro is active
  useEffect(() => {
    if (!gyroActive || !cameraRef.current) return

    const camera = cameraRef.current

    // Quaternion to rotate camera to look out the back of device (not top)
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))

    const setObjectQuaternion = (quaternion: THREE.Quaternion, alpha: number, beta: number, gamma: number, orient: number) => {
      const euler = new THREE.Euler()
      const q0 = new THREE.Quaternion()

      euler.set(beta, alpha, -gamma, "YXZ")
      quaternion.setFromEuler(euler)
      quaternion.multiply(q1)
      quaternion.multiply(q0.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient))
    }

    const onDeviceOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null || event.gamma === null) return

      const screenAngle = screen.orientation?.angle || 0
      const alpha = THREE.MathUtils.degToRad(event.alpha)
      const beta = THREE.MathUtils.degToRad(event.beta)
      const gamma = THREE.MathUtils.degToRad(event.gamma)
      const orient = THREE.MathUtils.degToRad(screenAngle)

      setObjectQuaternion(camera.quaternion, alpha, beta, gamma, orient)
    }

    window.addEventListener("deviceorientation", onDeviceOrientation)

    return () => {
      window.removeEventListener("deviceorientation", onDeviceOrientation)
    }
  }, [gyroActive])

  // For non-iOS devices, try to enable gyro automatically
  useEffect(() => {
    const isIOS = typeof (DeviceOrientationEvent as any).requestPermission === "function"
    if (isIOS) return

    // Check if device orientation is available
    const testOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha !== null) {
        gyroActiveRef.current = true
        setGyroActive(true)
      }
      window.removeEventListener("deviceorientation", testOrientation)
    }
    window.addEventListener("deviceorientation", testOrientation)

    return () => window.removeEventListener("deviceorientation", testOrientation)
  }, [])

  return (
    <div ref={mountRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}>
      {showEnableButton && !gyroActive && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 10 }}>
          <Button size="lg" onClick={enableMotionControls}>
            Tap to Enable Motion Controls
          </Button>
        </div>
      )}
    </div>
  )
}
