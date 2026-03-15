import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

// ── Constants ────────────────────────────────────────────────────────

// -90 degrees around X axis to align Three.js camera with device orientation
export const WORLD_CORRECTION_QUATERNION = new THREE.Quaternion(
  -Math.sqrt(0.5),
  0,
  0,
  Math.sqrt(0.5),
)

// ── Types ────────────────────────────────────────────────────────────

interface DeviceOrientationEventiOS extends DeviceOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const DeviceOrientationEventiOS =
  DeviceOrientationEvent as unknown as DeviceOrientationEventiOS & {
    requestPermission?: () => Promise<'granted' | 'denied'>
  }

// ── Hook ─────────────────────────────────────────────────────────────

export function useDeviceOrientation(
  camera: THREE.PerspectiveCamera | null,
  gyroActive: boolean,
  onGyroActiveChange: (active: boolean) => void,
) {
  const [showEnableButton, setShowEnableButton] = useState(false)
  const onGyroActiveChangeRef = useRef(onGyroActiveChange)
  onGyroActiveChangeRef.current = onGyroActiveChange

  // Check if iOS permission prompt is needed
  useEffect(() => {
    const isIOS =
      typeof DeviceOrientationEventiOS.requestPermission === 'function'
    setShowEnableButton(isIOS)
  }, [])

  // Apply device orientation to camera when gyro is active
  useEffect(() => {
    if (!gyroActive || !camera) return

    const zee = new THREE.Vector3(0, 0, 1)
    const euler = new THREE.Euler()
    const q0 = new THREE.Quaternion()

    let alphaOffset = 0
    let hasInitialized = false

    const setObjectQuaternion = (
      quaternion: THREE.Quaternion,
      alpha: number,
      beta: number,
      gamma: number,
      orient: number,
    ) => {
      euler.set(beta, alpha, -gamma, 'YXZ')
      quaternion.setFromEuler(euler)
      quaternion.multiply(WORLD_CORRECTION_QUATERNION)
      quaternion.multiply(q0.setFromAxisAngle(zee, -orient))
    }

    const onDeviceOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null || event.gamma === null)
        return

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
  }, [gyroActive, camera])

  // For non-iOS devices, auto-detect gyro availability
  useEffect(() => {
    const isIOS =
      typeof DeviceOrientationEventiOS.requestPermission === 'function'
    if (isIOS) return

    const testOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha !== null) onGyroActiveChangeRef.current(true)
      window.removeEventListener('deviceorientation', testOrientation)
    }
    window.addEventListener('deviceorientation', testOrientation)

    return () =>
      window.removeEventListener('deviceorientation', testOrientation)
  }, [])

  const enableMotionControls = async () => {
    try {
      const permission = await DeviceOrientationEventiOS.requestPermission?.()
      if (permission === 'granted') {
        onGyroActiveChangeRef.current(true)
        setShowEnableButton(false)
      }
    } catch {
      // Permission denied
    }
  }

  return { showEnableButton, enableMotionControls }
}
