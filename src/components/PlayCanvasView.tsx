import { Glasses, Loader2, RefreshCw, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import hoyaLogo from '@/assets/hoya-logo.svg'
import { Button } from '@/components/ui/button'
import { useDeviceOrientation } from '@/hooks/useDeviceOrientation'
import { usePointerControls } from '@/hooks/usePointerControls'
import {
  LENS_PRODUCT_ORDER,
  type LensProduct,
  type LensSide,
} from '@/lib/glasses-pc'
import { type BootedApp, bootApp } from '@/lib/playcanvasApp'
import { createLookState } from '@/lib/scripts/lookCamera'

function nextProduct(current: LensProduct): LensProduct {
  const idx = LENS_PRODUCT_ORDER.indexOf(current)
  return LENS_PRODUCT_ORDER[(idx + 1) % LENS_PRODUCT_ORDER.length]
}

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
  const [leftProduct, setLeftProduct] = useState<LensProduct>('iD MyStyle 3')
  const [rightProduct, setRightProduct] = useState<LensProduct>('iD MyStyle 3')

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
    bootedAppRef.current.setLensProduct('left', leftProduct)
    bootedAppRef.current.setLensProduct('right', rightProduct)
    setGlassesOn(true)
    setPuttingOnGlasses(false)
  }

  const takeOffGlasses = () => {
    bootedAppRef.current?.takeOffGlasses()
    setGlassesOn(false)
  }

  const cycleSide = (side: LensSide) => {
    if (side === 'left') {
      const next = nextProduct(leftProduct)
      setLeftProduct(next)
      bootedAppRef.current?.setLensProduct('left', next)
    } else {
      const next = nextProduct(rightProduct)
      setRightProduct(next)
      bootedAppRef.current?.setLensProduct('right', next)
    }
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
            <Smartphone className="h-5 w-5" />
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
            {puttingOnGlasses && (
              <Loader2 className="h-5 w-5 animate-spin" />
            )}
            <span>{puttingOnGlasses ? 'Experiencing' : 'Experience'}</span>
            <img
              src={hoyaLogo}
              alt="HOYA"
              className="h-4 w-auto brightness-0 invert"
            />
            <span>{puttingOnGlasses ? 'vision…' : 'vision'}</span>
          </Button>
        </div>
      )}
      {!loading && !error && glassesOn && (
        <>
          <div className="pointer-events-none absolute bottom-12 left-[28%] -translate-x-1/2 z-10 flex flex-col items-center gap-2">
            <Button
              variant="glass"
              size="icon"
              aria-label={`Swap left lens (currently ${leftProduct})`}
              onClick={() => cycleSide('left')}
              className="pointer-events-auto"
            >
              <RefreshCw className="h-5 w-5" />
            </Button>
            <span className="text-white text-xs font-light tracking-wide drop-shadow">
              {leftProduct}
            </span>
          </div>
          <div className="pointer-events-none absolute bottom-12 right-[28%] translate-x-1/2 z-10 flex flex-col items-center gap-2">
            <Button
              variant="glass"
              size="icon"
              aria-label={`Swap right lens (currently ${rightProduct})`}
              onClick={() => cycleSide('right')}
              className="pointer-events-auto"
            >
              <RefreshCw className="h-5 w-5" />
            </Button>
            <span className="text-white text-xs font-light tracking-wide drop-shadow">
              {rightProduct}
            </span>
          </div>
          <div className="absolute bottom-6 right-6 z-10">
            <Button
              variant="glass"
              size="icon"
              aria-label="Take off glasses"
              onClick={takeOffGlasses}
            >
              <Glasses className="h-5 w-5" />
            </Button>
          </div>
        </>
      )}
    </>
  )
}
