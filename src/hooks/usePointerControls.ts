import { useEffect } from 'react'

// ── Constants ────────────────────────────────────────────────────────

export const DRAG_SENSITIVITY = 0.1
export const LAT_MIN = -85
export const LAT_MAX = 85

// ── Hook ─────────────────────────────────────────────────────────────

export function usePointerControls(
  rendererElement: HTMLCanvasElement | null,
  lonRef: React.RefObject<number>,
  latRef: React.RefObject<number>,
  gyroActive: boolean,
) {
  useEffect(() => {
    if (!rendererElement || gyroActive) return

    let isUserInteracting = false
    let onPointerDownLon = 0
    let onPointerDownLat = 0
    let startX = 0
    let startY = 0

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
      lonRef.current = (startX - x) * DRAG_SENSITIVITY + onPointerDownLon
      latRef.current = (y - startY) * DRAG_SENSITIVITY + onPointerDownLat
    }

    const onPointerUp = () => {
      isUserInteracting = false
    }

    rendererElement.addEventListener('mousedown', onPointerDown)
    rendererElement.addEventListener('mousemove', onPointerMove)
    rendererElement.addEventListener('mouseup', onPointerUp)
    rendererElement.addEventListener('touchstart', onPointerDown)
    rendererElement.addEventListener('touchmove', onPointerMove)
    rendererElement.addEventListener('touchend', onPointerUp)

    return () => {
      rendererElement.removeEventListener('mousedown', onPointerDown)
      rendererElement.removeEventListener('mousemove', onPointerMove)
      rendererElement.removeEventListener('mouseup', onPointerUp)
      rendererElement.removeEventListener('touchstart', onPointerDown)
      rendererElement.removeEventListener('touchmove', onPointerMove)
      rendererElement.removeEventListener('touchend', onPointerUp)
    }
  }, [rendererElement, lonRef, latRef, gyroActive])
}
