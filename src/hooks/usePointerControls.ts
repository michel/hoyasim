import { useEffect, useRef } from 'react'

// ── Constants ────────────────────────────────────────────────────────

export const DRAG_SENSITIVITY = 0.1
export const LAT_MIN = -85
export const LAT_MAX = 85

// ── Hook ─────────────────────────────────────────────────────────────

interface PointerState {
  active: boolean
  startX: number
  startY: number
  startLon: number
  startLat: number
}

export function usePointerControls(
  rendererElement: HTMLCanvasElement | null,
  lonRef: React.RefObject<number>,
  latRef: React.RefObject<number>,
  gyroActive: boolean,
) {
  const stateRef = useRef<PointerState>({
    active: false,
    startX: 0,
    startY: 0,
    startLon: 0,
    startLat: 0,
  })

  useEffect(() => {
    if (!rendererElement || gyroActive) return

    function getXY(
      e: MouseEvent | TouchEvent,
    ): { x: number; y: number } | null {
      if ('touches' in e) {
        if (e.touches.length === 0) return null
        return { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
      return { x: e.clientX, y: e.clientY }
    }

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const pos = getXY(e)
      if (!pos) return
      const s = stateRef.current
      s.active = true
      s.startX = pos.x
      s.startY = pos.y
      s.startLon = lonRef.current
      s.startLat = latRef.current
    }

    const onPointerMove = (e: MouseEvent | TouchEvent) => {
      const s = stateRef.current
      if (!s.active) return
      const pos = getXY(e)
      if (!pos) return
      const { x, y } = pos
      lonRef.current = (s.startX - x) * DRAG_SENSITIVITY + s.startLon
      latRef.current = (y - s.startY) * DRAG_SENSITIVITY + s.startLat
    }

    const onPointerUp = () => {
      stateRef.current.active = false
    }

    rendererElement.addEventListener('mousedown', onPointerDown)
    rendererElement.addEventListener('mousemove', onPointerMove)
    rendererElement.addEventListener('mouseup', onPointerUp)
    rendererElement.addEventListener('touchstart', onPointerDown, {
      passive: false,
    })
    rendererElement.addEventListener('touchmove', onPointerMove, {
      passive: false,
    })
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
