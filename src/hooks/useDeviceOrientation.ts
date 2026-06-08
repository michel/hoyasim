import * as pc from 'playcanvas'
import { useEffect, useRef, useState } from 'react'
import type { LookState } from '@/lib/scripts/lookCamera'

// iOS gates the motion sensors behind a static requestPermission() on the
// DeviceOrientationEvent constructor that the standard lib types omit.
type DeviceOrientationEventStatic = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const DeviceOrientationEventiOS =
  DeviceOrientationEvent as DeviceOrientationEventStatic

const isIOS = typeof DeviceOrientationEventiOS.requestPermission === 'function'

// -90 degrees around X axis, aligns the camera frame with the device frame.
const WORLD_CORRECTION = new pc.Quat(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))

const DEG_TO_RAD = Math.PI / 180

// Three.js' Euler(beta, alpha, -gamma, 'YXZ') as a raw quaternion.
function eulerYXZToQuat(
  out: pc.Quat,
  betaRad: number,
  alphaRad: number,
  gammaRad: number,
) {
  const c1 = Math.cos(betaRad / 2)
  const s1 = Math.sin(betaRad / 2)
  const c2 = Math.cos(alphaRad / 2)
  const s2 = Math.sin(alphaRad / 2)
  const c3 = Math.cos(-gammaRad / 2)
  const s3 = Math.sin(-gammaRad / 2)
  out.x = s1 * c2 * c3 + c1 * s2 * s3
  out.y = c1 * s2 * c3 - s1 * c2 * s3
  out.z = c1 * c2 * s3 - s1 * s2 * c3
  out.w = c1 * c2 * c3 + s1 * s2 * s3
}

export function useDeviceOrientation(
  lookState: LookState,
  gyroActive: boolean,
  onGyroActiveChange: (active: boolean) => void,
) {
  const [showEnableButton, setShowEnableButton] = useState(false)
  const onGyroActiveChangeRef = useRef(onGyroActiveChange)
  onGyroActiveChangeRef.current = onGyroActiveChange

  useEffect(() => {
    setShowEnableButton(isIOS)
  }, [])

  useEffect(() => {
    if (!gyroActive) {
      lookState.gyroActive = false
      return
    }

    const screen = new pc.Quat()
    const current = new pc.Quat()
    const initialYawInv = new pc.Quat()
    let hasInitialized = false

    const onDeviceOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null || event.gamma === null)
        return

      const alpha = event.alpha * DEG_TO_RAD
      const beta = event.beta * DEG_TO_RAD
      const gamma = event.gamma * DEG_TO_RAD
      const orient = (window.screen?.orientation?.angle || 0) * DEG_TO_RAD

      eulerYXZToQuat(current, beta, alpha, gamma)
      current.mul(WORLD_CORRECTION)
      screen.set(0, 0, Math.sin(-orient / 2), Math.cos(-orient / 2))
      current.mul(screen)

      // Snap yaw to "forward" on activation while keeping pitch/roll absolute.
      // Swing-twist around Y: q = q_twist * q_swing, so q_twist = (0, y, 0, w)
      // normalized. Pre-multiplying by inv(q_twist_0) cancels initial yaw and
      // leaves the swing (pitch/roll) free to track the phone naturally.
      if (!hasInitialized) {
        const len = Math.hypot(current.y, current.w)
        if (len > 0) {
          initialYawInv.set(0, -current.y / len, 0, current.w / len)
        } else {
          initialYawInv.set(0, 0, 0, 1)
        }
        hasInitialized = true
      }
      lookState.gyroQuat.mul2(initialYawInv, current)
      lookState.gyroActive = true
    }

    window.addEventListener('deviceorientation', onDeviceOrientation)
    return () => {
      window.removeEventListener('deviceorientation', onDeviceOrientation)
      lookState.gyroActive = false
    }
  }, [gyroActive, lookState])

  useEffect(() => {
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
