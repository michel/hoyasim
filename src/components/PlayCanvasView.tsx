import {
  ChevronRight,
  Glasses,
  Loader2,
  Pointer,
  Smartphone,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import hoyaLogo from '@/assets/hoya-logo.svg'
import { Button } from '@/components/ui/button'
import { useDeviceOrientation } from '@/hooks/useDeviceOrientation'
import { usePointerControls } from '@/hooks/usePointerControls'
import {
  DEFAULT_LENS_PRODUCT,
  LENS_PRODUCT_ORDER,
  type LensProduct,
} from '@/lib/glasses-pc'
import { type BootedApp, bootApp } from '@/lib/playcanvasApp'
import { createLookState } from '@/lib/scripts/lookCamera'

function nextProduct(current: LensProduct): LensProduct {
  const idx = LENS_PRODUCT_ORDER.indexOf(current)
  return LENS_PRODUCT_ORDER[(idx + 1) % LENS_PRODUCT_ORDER.length]
}

const LENS_TAGLINES: Record<LensProduct, string> = {
  Balansis: 'Essential progressive',
  'MySelf Profile': 'Personalised progressive',
  MySense: 'Premium progressive',
}

// Animated tapping-hand cue, anchored to the bottom-right of its relative parent.
function TapHint() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-8 right-6"
    >
      <span className="cta-tap-contact absolute left-[11px] top-0 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/50" />
      <Pointer
        className="cta-tap relative h-8 w-8 text-white"
        strokeWidth={2}
        style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.55))' }}
      />
    </div>
  )
}

function LensSelector({
  active,
  onCycle,
  showHint = false,
}: {
  active: LensProduct
  onCycle: () => void
  showHint?: boolean
}) {
  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
      <button
        type="button"
        aria-label={`Swap lenses (currently ${active}). Tap to cycle.`}
        onClick={onCycle}
        className="group relative flex items-stretch overflow-hidden rounded-xl bg-hoya-blue text-white shadow-md shadow-black/30 active:scale-[0.98] transition-transform duration-150"
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
      {showHint && <TapHint />}
    </div>
  )
}

export default function PlayCanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bootedAppRef = useRef<BootedApp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [glassesOn, setGlassesOn] = useState(false)
  const [puttingOnGlasses, setPuttingOnGlasses] = useState(false)
  const [product, setProduct] = useState<LensProduct>(DEFAULT_LENS_PRODUCT)
  const [hasCycledLens, setHasCycledLens] = useState(false)

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
    // A rebuilt controller starts both eyes at the default; restore the user's
    // current selection.
    bootedAppRef.current.setLensProduct('left', product)
    bootedAppRef.current.setLensProduct('right', product)
    setGlassesOn(true)
    setPuttingOnGlasses(false)
  }

  const takeOffGlasses = () => {
    bootedAppRef.current?.takeOffGlasses()
    setGlassesOn(false)
  }

  const cycleLenses = () => {
    setHasCycledLens(true)
    const next = nextProduct(product)
    setProduct(next)
    bootedAppRef.current?.setLensProduct('left', next)
    bootedAppRef.current?.setLensProduct('right', next)
  }

  const { gyroActive, showEnableButton, enableMotionControls } =
    useDeviceOrientation(lookState)
  usePointerControls(canvasRef.current, lookState, gyroActive)

  return (
    <>
      <canvas
        ref={canvasRef}
        id="application-canvas"
        aria-label="Interactive 3D vision simulator"
        style={{ display: 'block', width: '100%', height: '100%' }}
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
          <div className="relative inline-flex">
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
            {!puttingOnGlasses && <TapHint />}
          </div>
        </div>
      )}
      {!loading && !error && glassesOn && (
        <>
          <LensSelector
            active={product}
            onCycle={cycleLenses}
            showHint={!hasCycledLens}
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
