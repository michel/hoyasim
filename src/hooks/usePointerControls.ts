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

    let startX = 0
    let startY = 0
    let startLon = 0
    let startLat = 0

    const getXY = (
      e: MouseEvent | TouchEvent,
    ): { x: number; y: number } | null => {
      if ('touches' in e) {
        if (e.touches.length === 0) return null
        return { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
      return { x: e.clientX, y: e.clientY }
    }

    const onMove = (e: MouseEvent | TouchEvent) => {
      const pos = getXY(e)
      if (!pos) return
      lookState.lon = (startX - pos.x) * DRAG_SENSITIVITY + startLon
      lookState.lat = (pos.y - startY) * DRAG_SENSITIVITY + startLat
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }

    const onDown = (e: MouseEvent | TouchEvent) => {
      const pos = getXY(e)
      if (!pos) return
      startX = pos.x
      startY = pos.y
      startLon = lookState.lon
      startLat = lookState.lat
      if ('touches' in e) {
        window.addEventListener('touchmove', onMove, { passive: false })
        window.addEventListener('touchend', onUp)
      } else {
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }
    }

    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('touchstart', onDown, { passive: false })

    return () => {
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('touchstart', onDown)
      onUp()
    }
  }, [canvas, lookState, gyroActive])
}
