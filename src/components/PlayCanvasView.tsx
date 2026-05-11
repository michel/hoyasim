import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useDeviceOrientation } from '@/hooks/useDeviceOrientation'
import { usePointerControls } from '@/hooks/usePointerControls'
import { type BootedApp, bootApp } from '@/lib/playcanvasApp'
import { createLookState } from '@/lib/scripts/lookCamera'

interface PlayCanvasViewProps {
  gyroActive: boolean
  onGyroActiveChange: (active: boolean) => void
}

export default function PlayCanvasView({
  gyroActive,
  onGyroActiveChange,
}: PlayCanvasViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const lookState = useMemo(createLookState, [])

  useEffect(() => {
    if (!canvasRef.current) return
    let alive = true
    let bootedApp: BootedApp | null = null

    bootApp(canvasRef.current, lookState)
      .then((app) => {
        if (!alive) {
          app.dispose()
          return
        }
        bootedApp = app
        setLoading(false)
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })

    return () => {
      alive = false
      bootedApp?.dispose()
    }
  }, [lookState])

  usePointerControls(canvasRef.current, lookState, gyroActive)
  const { showEnableButton, enableMotionControls } = useDeviceOrientation(
    lookState,
    gyroActive,
    onGyroActiveChange,
  )

  return (
    <>
      <canvas
        ref={canvasRef}
        id="application-canvas"
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
      {loading && !error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-950 via-slate-900 to-zinc-900">
          <div className="glass rounded-3xl p-8 flex flex-col items-center gap-4 shadow-2xl">
            <Loader2 className="h-10 w-10 animate-spin text-white/80" />
            <div className="text-white/90 text-lg font-light">
              Loading scene...
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-950 via-slate-900 to-zinc-900">
          <div className="glass rounded-3xl p-8 flex flex-col items-center gap-4 shadow-2xl">
            <div className="text-red-400 text-lg font-light">{error}</div>
          </div>
        </div>
      )}
      {showEnableButton && !gyroActive && !loading && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <Button variant="glass" size="lg" onClick={enableMotionControls}>
            Tap to Enable Motion Controls
          </Button>
        </div>
      )}
    </>
  )
}
