import { useEffect } from 'react'
import * as THREE from 'three'
import type { BlocksState } from '@/lib/blocks'
import { subscribe } from '@/lib/debug'
import type { GlassesState } from '@/lib/glasses'
import { LAT_MAX, LAT_MIN } from './usePointerControls'

// ── Constants ────────────────────────────────────────────────────────

export const POLAR_ANGLE_MIN = Math.PI / 2.5
export const POLAR_ANGLE_MAX = Math.PI / 1.6

const _direction = new THREE.Vector3()

// ── Hook ─────────────────────────────────────────────────────────────

export function useRenderLoop(
  scene: THREE.Scene | null,
  camera: THREE.PerspectiveCamera | null,
  renderer: THREE.WebGLRenderer | null,
  glassesRef: React.RefObject<GlassesState | null>,
  blocksRef: React.RefObject<BlocksState | null>,
  fpsRef: React.RefObject<HTMLDivElement | null>,
  gyroActiveRef: React.RefObject<boolean>,
  lonRef: React.RefObject<number>,
  latRef: React.RefObject<number>,
) {
  useEffect(() => {
    if (!scene || !camera || !renderer) return

    const unsubDebug = subscribe((on) => {
      if (fpsRef.current) fpsRef.current.style.display = on ? 'block' : 'none'
    })

    let mounted = true
    let frames = 0
    let fpsLastTime = performance.now()
    let animationId = 0
    let prevTime = performance.now()

    const animate = () => {
      if (!mounted) return

      const now = performance.now()
      const delta = (now - prevTime) / 1000
      prevTime = now

      // Camera orientation from pointer controls
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

      // Glasses update
      const glasses = glassesRef.current
      if (glasses) {
        _direction.set(0, 0, -1).applyQuaternion(camera.quaternion)
        const polarAngle = Math.acos(THREE.MathUtils.clamp(_direction.y, -1, 1))
        glasses.update(polarAngle, POLAR_ANGLE_MIN, POLAR_ANGLE_MAX)
        glasses.animateSwap()
        glasses.resetDepthClear()
      }

      // Blocks update
      const offset = blocksRef.current?.update(delta)
      if (offset) {
        camera.position.x = offset.x
        camera.position.y = offset.y
      }

      renderer.render(scene, camera)

      // FPS tracking
      frames++
      if (now - fpsLastTime >= 500) {
        if (fpsRef.current)
          fpsRef.current.textContent = `${Math.round(frames / ((now - fpsLastTime) / 1000))} fps | ${renderer.info.render.triangles} tris | ${renderer.info.render.calls} calls`
        frames = 0
        fpsLastTime = now
      }

      animationId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      mounted = false
      cancelAnimationFrame(animationId)
      unsubDebug()
    }
  }, [
    scene,
    camera,
    renderer,
    blocksRef.current?.update,
    fpsRef.current,
    glassesRef.current,
    gyroActiveRef.current,
    latRef,
    lonRef.current,
  ])
}
