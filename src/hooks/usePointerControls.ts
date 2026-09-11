import { useEffect } from 'react'
import type { LookState } from '@/lib/scripts/lookCamera'

const DRAG_SENSITIVITY = 0.1

export function usePointerControls(
  canvas: HTMLCanvasElement | null,
  lookState: LookState,
  gyroActive: boolean,
) {
  useEffect(() => {
    if (!canvas || gyroActive) return

    let activeId: number | null = null
    let startX = 0
    let startY = 0
    let startLon = 0
    let startLat = 0

    // A second finger must not re-anchor the drag: the first pointer keeps it.
    const onDown = (e: PointerEvent) => {
      if (activeId !== null) return
      activeId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      startLon = lookState.lon
      startLat = lookState.lat
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return
      lookState.lon = (startX - e.clientX) * DRAG_SENSITIVITY + startLon
      lookState.lat = (e.clientY - startY) * DRAG_SENSITIVITY + startLat
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId === activeId) activeId = null
    }

    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [canvas, lookState, gyroActive])
}
