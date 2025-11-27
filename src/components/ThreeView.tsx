import { useRef, useEffect } from "react"
import * as THREE from "three"
import { EXRLoader } from "three/addons/loaders/EXRLoader.js"

interface ThreeViewProps {
  image: string
  onReady?: (ref: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer }) => void
}

export default function ThreeView({ image, onReady }: ThreeViewProps) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mountRef.current) return

    const width = window.innerWidth
    const height = window.innerHeight

    // Scene & Camera
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100)
    camera.position.set(0, 0, 0.01)

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

    // Load texture (EXR or standard image)
    if (image.endsWith('.exr')) {
      new EXRLoader().load(image, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping
        material.map = texture
        material.needsUpdate = true
      })
    } else {
      const texture = new THREE.TextureLoader().load(image)
      material.map = texture
    }

    // Mouse / Touch controls
    let isUserInteracting = false
    let lon = 0, lat = 0, onPointerDownLon = 0, onPointerDownLat = 0, startX = 0, startY = 0

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      isUserInteracting = true
      startX = "touches" in e ? e.touches[0].clientX : e.clientX
      startY = "touches" in e ? e.touches[0].clientY : e.clientY
      onPointerDownLon = lon
      onPointerDownLat = lat
    }

    const onPointerMove = (e: MouseEvent | TouchEvent) => {
      if (isUserInteracting) {
        const x = "touches" in e ? e.touches[0].clientX : e.clientX
        const y = "touches" in e ? e.touches[0].clientY : e.clientY
        lon = (startX - x) * 0.1 + onPointerDownLon
        lat = (y - startY) * 0.1 + onPointerDownLat
      }
    }

    const onPointerUp = () => (isUserInteracting = false)

    mountRef.current.addEventListener("mousedown", onPointerDown)
    mountRef.current.addEventListener("mousemove", onPointerMove)
    mountRef.current.addEventListener("mouseup", onPointerUp)
    mountRef.current.addEventListener("touchstart", onPointerDown)
    mountRef.current.addEventListener("touchmove", onPointerMove)
    mountRef.current.addEventListener("touchend", onPointerUp)

    // Gyroscope
    let hasGyro = false
    const onDeviceOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha !== null && event.beta !== null && event.gamma !== null) {
        hasGyro = true
        const degToRad = THREE.MathUtils.degToRad
        camera.rotation.order = "YXZ"
        camera.rotation.y = degToRad(event.alpha)
        camera.rotation.x = degToRad(event.beta - 90)
        camera.rotation.z = degToRad(event.gamma)
      }
    }
    window.addEventListener("deviceorientation", onDeviceOrientation)

    // Resize handler
    const onResize = () => {
      setTimeout(() => {
        if (!mountRef.current) return
        const w = window.innerWidth
        const h = window.innerHeight
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }, 100)
    }
    window.addEventListener("resize", onResize)
    window.addEventListener("orientationchange", onResize)
    screen.orientation?.addEventListener("change", onResize)

    // Animate
    let animationId: number
    const animate = () => {
      if (!hasGyro) {
        lat = Math.max(-85, Math.min(85, lat))
        const phi = THREE.MathUtils.degToRad(90 - lat)
        const theta = THREE.MathUtils.degToRad(lon)
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
      window.removeEventListener("orientationchange", onResize)
      screen.orientation?.removeEventListener("change", onResize)
      window.removeEventListener("deviceorientation", onDeviceOrientation)
      renderer.dispose()
      geometry.dispose()
      material.dispose()
      currentMount?.removeChild(renderer.domElement)
    }
  }, [image, onReady])

  return <div ref={mountRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />
}
