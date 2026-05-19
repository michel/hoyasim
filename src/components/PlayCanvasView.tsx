import { Glasses, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import hoyaLogo from '@/assets/hoya-logo.svg'
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
  const fpsRef = useRef<HTMLDivElement>(null)
  const bootedAppRef = useRef<BootedApp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [glassesOn, setGlassesOn] = useState(false)
  const [puttingOnGlasses, setPuttingOnGlasses] = useState(false)

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let ema = 0
    const tick = (now: number) => {
      const dt = now - last
      last = now
      if (dt > 0) {
        const fps = 1000 / dt
        ema = ema === 0 ? fps : ema * 0.9 + fps * 0.1
        if (fpsRef.current) fpsRef.current.textContent = `${ema.toFixed(0)} fps`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const lookState = useMemo(createLookState, [])

  useEffect(() => {
    if (!canvasRef.current) return
    let alive = true

    bootApp(canvasRef.current, lookState)
      .then((app) => {
        if (!alive) {
          app.dispose()
          return
        }
        bootedAppRef.current = app
        setLoading(false)
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })

    return () => {
      alive = false
      bootedAppRef.current?.dispose()
      bootedAppRef.current = null
    }
  }, [lookState])

  const putOnGlasses = async () => {
    if (glassesOn || puttingOnGlasses || !bootedAppRef.current) return
    setPuttingOnGlasses(true)
    await bootedAppRef.current.putOnGlasses()
    setGlassesOn(true)
    setPuttingOnGlasses(false)
  }

  const takeOffGlasses = () => {
    bootedAppRef.current?.takeOffGlasses()
    setGlassesOn(false)
  }

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
      <div
        ref={fpsRef}
        className="pointer-events-none absolute top-2 left-2 z-30 rounded bg-hoya-dark/70 px-2 py-1 font-mono text-xs text-white tabular-nums"
      />
      {loading && !error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-white">
          <img src={hoyaLogo} alt="HOYA" className="h-8 w-auto opacity-80" />
          <Loader2 className="h-8 w-8 animate-spin text-hoya-blue" />
          <div className="text-hoya-muted text-sm font-light tracking-wide">
            Loading scene...
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-white px-6">
          <img src={hoyaLogo} alt="HOYA" className="h-8 w-auto" />
          <div className="text-destructive text-base font-light text-center max-w-md">
            {error}
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
      {!loading && !error && !glassesOn && !showEnableButton && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
          <Button
            variant="glass"
            size="lg"
            onClick={putOnGlasses}
            disabled={puttingOnGlasses}
          >
            {puttingOnGlasses ? 'Putting on glasses…' : 'Put on glasses'}
          </Button>
        </div>
      )}
      {!loading && !error && glassesOn && (
        <div className="absolute bottom-8 right-8 z-10">
          <Button
            variant="glass"
            size="icon"
            aria-label="Take off glasses"
            onClick={takeOffGlasses}
          >
            <Glasses className="h-5 w-5" />
          </Button>
        </div>
      )}
    </>
  )
}
