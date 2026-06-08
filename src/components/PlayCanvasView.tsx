import { ChevronRight, Glasses, Loader2, Smartphone } from 'lucide-react'
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

const LENS_TAGLINES: Record<LensProduct, string> = {
  'iD MyStyle 3': 'Premium progressive',
  'iD WorkStyle 3': 'Desk + screens',
  'iD LifeStyle 3': 'Everyday progressive',
  Sensity: 'Photochromic',
}

function LensSelector({
  side,
  active,
  onCycle,
  position,
}: {
  side: LensSide
  active: LensProduct
  onCycle: () => void
  position: 'left' | 'right'
}) {
  const anchor =
    position === 'left'
      ? 'left-[28%] -translate-x-1/2'
      : 'right-[28%] translate-x-1/2'
  return (
    <button
      type="button"
      aria-label={`Swap ${side} lens (currently ${active}). Tap to cycle.`}
      onClick={onCycle}
      className={`group absolute bottom-8 ${anchor} z-10 flex items-stretch overflow-hidden rounded-xl bg-hoya-blue text-white shadow-md shadow-black/30 active:scale-[0.98] transition-transform duration-150`}
    >
      <span className="flex flex-col items-start gap-1 py-2.5 pl-4 pr-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80 leading-none">
          {LENS_TAGLINES[active]}
        </span>
        <span className="text-sm font-semibold tracking-tight leading-none">
          {active}
        </span>
        <span className="mt-1 flex items-center gap-1">
          {LENS_PRODUCT_ORDER.map((p) => {
            const isActive = p === active
            return (
              <span
                key={p}
                className={`h-1 rounded-full transition-all duration-200 ${
                  isActive ? 'w-5 bg-white' : 'w-2 bg-white/35'
                }`}
              />
            )
          })}
        </span>
      </span>
      <span className="flex items-center justify-center px-3.5 bg-hoya-blue-active text-white group-hover:bg-black/20 transition-colors">
        <ChevronRight
          className="h-5 w-5 transition-transform group-active:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </button>
  )
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
    const next =
      side === 'left' ? nextProduct(leftProduct) : nextProduct(rightProduct)
    if (side === 'left') setLeftProduct(next)
    else setRightProduct(next)
    bootedAppRef.current?.setLensProduct(side, next)
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
        className="pointer-events-none absolute top-2 left-2 z-30 rounded bg-hoya-dark/70 px-2 py-1 font-mono text-xs text-white tabular-nums shadow-md shadow-black/30"
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
        <div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 transition-all duration-300 ${
            puttingOnGlasses
              ? 'pointer-events-none scale-95 opacity-0'
              : 'scale-100 opacity-100'
          }`}
        >
          <Button
            variant="glass"
            size="lg"
            onClick={putOnGlasses}
            disabled={puttingOnGlasses}
          >
            <span>Experience</span>
            <img
              src={hoyaLogo}
              alt="HOYA"
              className="h-4 w-auto brightness-0 invert"
            />
            <span>vision</span>
          </Button>
        </div>
      )}
      {!loading && !error && glassesOn && (
        <>
          <LensSelector
            side="left"
            active={leftProduct}
            onCycle={() => cycleSide('left')}
            position="left"
          />
          <LensSelector
            side="right"
            active={rightProduct}
            onCycle={() => cycleSide('right')}
            position="right"
          />
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
