import {
  ChevronRight,
  Glasses,
  Loader2,
  Pause,
  Play,
  Pointer,
  Settings,
  Smartphone,
} from 'lucide-react'
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import hoyaLogo from '@/assets/hoya-logo.svg'
import TuningPanel from '@/components/TuningPanel'
import { Button } from '@/components/ui/button'
import { useDeviceOrientation } from '@/hooks/useDeviceOrientation'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePointerControls } from '@/hooks/usePointerControls'
import { lineState } from '@/lib/glasses-anim'
import type { LensProduct } from '@/lib/glasses-pc'
import { type BootedApp, bootApp } from '@/lib/playcanvasApp'
import { createLookState } from '@/lib/scripts/lookCamera'

// The left eye always wears the reference lens; the right eye switches between
// the others so the two can be compared side by side.
const FIXED_PRODUCT: LensProduct = 'MySense'
const SWITCH_PRODUCTS: LensProduct[] = ['MySelf Profile', 'Balansis']

const nextProduct = (current: LensProduct) =>
  SWITCH_PRODUCTS[
    (SWITCH_PRODUCTS.indexOf(current) + 1) % SWITCH_PRODUCTS.length
  ]

// Onboarding tour, played once when the glasses first go on: one tooltip per
// control, pointing at it. Product hints follow each later lens switch.
// ponytail: placeholder copy, swap in HOYA's wording when it arrives.
type TourTarget = 'fixed' | 'switch' | 'pause' | 'settings'
const TOUR: { target: TourTarget; text: string }[] = [
  {
    target: 'fixed',
    text: `Your left eye wears ${FIXED_PRODUCT}, our premium lens. It stays the same so you can compare.`,
  },
  {
    target: 'switch',
    text: 'Tap here to switch the lens on your right eye, then compare the blurred lower corners.',
  },
  {
    target: 'pause',
    text: 'Pause the ride to look at the difference at your own pace.',
  },
  {
    target: 'settings',
    text: 'Show or hide the mushroom line that marks where each lens is sharp.',
  },
]
const LENS_EXPLAINERS: Record<LensProduct, string> = {
  MySense: 'MySense: the widest clear view, with smooth transitions.',
  'MySelf Profile':
    'MySelf Profile: compare the blurred lower corners with the left lens.',
  Balansis:
    'Balansis: notice the larger blurred corners and the abrupt switch between far and near.',
}
const HINT_MS = 5000
// Same breakpoint as the `short` CSS variant (index.css): phone in landscape.
const COMPACT_QUERY = '(max-height: 500px)'

const TIP_RADIUS = 16
const TAIL_W = 22
const TAIL_H = 10
// Tail centre from the bubble edge for start/end alignment: past the corner
// radius so the tail leaves a straight edge, close to a 44px button centre.
const TAIL_INSET = 27

// Outline of bubble + tail as ONE path, so the glass, its edge and the pointer
// are a single shape. Tail on the bottom edge when the bubble sits above its
// anchor, on the top edge when below; y is offset to leave room for it.
function bubblePath(w: number, h: number, tailX: number, tailDown: boolean) {
  const r = TIP_RADIUS
  const y0 = tailDown ? 0 : TAIL_H
  const y1 = y0 + h
  const a = tailX - TAIL_W / 2
  const b = tailX + TAIL_W / 2
  const top = tailDown
    ? `H ${w - r}`
    : `H ${a} Q ${tailX - 3} ${y0} ${tailX} 0 Q ${tailX + 3} ${y0} ${b} ${y0} H ${w - r}`
  const bottom = tailDown
    ? `H ${b} Q ${tailX + 3} ${y1} ${tailX} ${y1 + TAIL_H} Q ${tailX - 3} ${y1} ${a} ${y1} H ${r}`
    : `H ${r}`
  return `M ${r} ${y0} ${top} Q ${w} ${y0} ${w} ${y0 + r} V ${y1 - r} Q ${w} ${y1} ${w - r} ${y1} ${bottom} Q 0 ${y1} 0 ${y1 - r} V ${y0 + r} Q 0 ${y0} ${r} ${y0} Z`
}

// Speech-bubble hint with a tail pointing at its anchor. Render it inside the
// anchor's `relative` wrapper: `side` is where the bubble sits, `align` lines
// the bubble and tail up with the anchor's left edge, centre or right edge.
function Tooltip({
  side,
  align,
  children,
}: {
  side: 'top' | 'bottom'
  align: 'start' | 'center' | 'end'
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() =>
      setSize({ w: el.offsetWidth, h: el.offsetHeight }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const box = {
    start: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    end: 'right-0',
  }[align]
  const tailDown = side === 'top'
  let shape: ReactNode = null
  if (size) {
    const tailX = {
      start: TAIL_INSET,
      center: size.w / 2,
      end: size.w - TAIL_INSET,
    }[align]
    const d = bubblePath(size.w, size.h, tailX, tailDown)
    const layer = {
      left: 0,
      top: tailDown ? 0 : -TAIL_H,
      width: size.w,
      height: size.h + TAIL_H,
    }
    shape = (
      <>
        <span
          aria-hidden="true"
          className="glass-fill absolute"
          style={{ ...layer, clipPath: `path('${d}')` }}
        />
        <svg
          aria-hidden="true"
          className="absolute overflow-visible"
          style={layer}
          viewBox={`0 0 ${layer.width} ${layer.height}`}
        >
          <path
            d={d}
            fill="none"
            stroke="rgb(255 255 255 / 0.4)"
            strokeWidth="1"
          />
        </svg>
      </>
    )
  }
  return (
    <div
      ref={ref}
      role="status"
      className={`absolute z-30 w-64 short:w-56 p-3.5 short:p-3 text-left text-sm short:text-[13px] font-medium leading-snug text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.35)] animate-in fade-in zoom-in-95 ${box} ${
        side === 'top' ? 'bottom-full mb-3' : 'top-full mt-3'
      }`}
    >
      {shape}
      <div className="relative">{children}</div>
    </div>
  )
}

function TourStep({
  step,
  onNext,
  onSkip,
}: {
  step: number
  onNext: () => void
  onSkip: () => void
}) {
  const last = step === TOUR.length - 1
  return (
    <>
      <p>{TOUR[step].text}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs tabular-nums text-white/70">
          {step + 1} / {TOUR.length}
        </span>
        <span className="flex gap-1">
          {!last && (
            <button
              type="button"
              onClick={onSkip}
              className="rounded-full px-3 py-2 text-xs text-white/80 active:bg-white/10"
            >
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-hoya-dark [text-shadow:none] active:scale-95 transition-transform"
          >
            {last ? 'Got it' : 'Next'}
          </button>
        </span>
      </div>
    </>
  )
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
  fixedTip,
  switchTip,
  compact = false,
}: {
  active: LensProduct
  // Phone layout: a small blue card (like the left one) that grows into the
  // full selector while the lens hint shows.
  compact?: boolean
  onCycle: () => void
  showHint?: boolean
  fixedTip?: ReactNode
  switchTip?: ReactNode
}) {
  // The content sits absolutely (anchored bottom-right) so the button can
  // transition between its measured sizes instead of jumping.
  const contentRef = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-observe the remounted content when the layout flips
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [compact])
  // Left lens card in the bottom-left corner, switcher in the bottom-right:
  // the outer corners stay clear of the lenses, the centre does not.
  return (
    <>
      <div className="absolute ui-bottom ui-left z-10 flex flex-col items-start gap-1 rounded-xl bg-black/45 py-2.5 short:py-2 px-4 short:px-3 text-white shadow-md shadow-black/30 backdrop-blur-sm">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80 leading-none">
          Left lens
        </span>
        <span className="text-sm font-semibold tracking-tight leading-none">
          {FIXED_PRODUCT}
        </span>
        {fixedTip && (
          <Tooltip side="top" align="start">
            {fixedTip}
          </Tooltip>
        )}
      </div>
      <div className="absolute ui-bottom ui-right z-10">
        <button
          type="button"
          aria-label={`Switch right lens (currently ${active}). Tap to cycle.`}
          onClick={onCycle}
          // Explicit size, measured from the content, so the switch between
          // the compact card and the full selector animates.
          style={size ? { width: size.w, height: size.h } : undefined}
          className="group relative block overflow-hidden rounded-xl bg-hoya-blue text-white shadow-md shadow-black/30 active:scale-[0.98] transition-[width,height,transform] duration-300 ease-out"
        >
          <span
            ref={contentRef}
            key={compact ? 'compact' : 'full'}
            className="absolute right-0 bottom-0 flex w-max items-stretch animate-in fade-in duration-300"
          >
            {compact ? (
              <span className="flex flex-col items-start gap-1 py-2.5 short:py-2 px-4 short:px-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80 leading-none">
                  Right lens
                </span>
                <span className="text-sm font-semibold tracking-tight leading-none">
                  {active}
                </span>
              </span>
            ) : (
              <>
                <span className="flex flex-col items-start gap-1 py-2.5 short:py-2 pl-4 short:pl-3 pr-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80 leading-none">
                    {LENS_TAGLINES[active]}
                  </span>
                  <span className="text-sm font-semibold tracking-tight leading-none">
                    {active}
                  </span>
                  <span className="mt-1 flex items-center gap-1">
                    {SWITCH_PRODUCTS.map((p) => {
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
              </>
            )}
          </span>
        </button>
        {showHint && <TapHint />}
        {switchTip && (
          <Tooltip side="top" align="end">
            {switchTip}
          </Tooltip>
        )}
      </div>
    </>
  )
}

function SettingsPanel({
  lineVisible,
  onLineVisible,
}: {
  lineVisible: boolean
  onLineVisible: (v: boolean) => void
}) {
  return (
    <div className="absolute top-full right-0 mt-2 z-10 whitespace-nowrap rounded-xl bg-black/60 p-1 text-sm text-white shadow-md backdrop-blur-sm">
      <label className="flex min-h-11 items-center gap-3 px-3">
        <input
          className="h-5 w-5 accent-hoya-blue"
          type="checkbox"
          checked={lineVisible}
          onChange={(e) => onLineVisible(e.target.checked)}
        />
        Show mushroom line
      </label>
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
  const [product, setProduct] = useState<LensProduct>(SWITCH_PRODUCTS[0])
  const [hasCycledLens, setHasCycledLens] = useState(false)
  const [paused, setPaused] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lineVisible, setLineVisible] = useState(lineState.visible)
  // Index into TOUR while the onboarding runs; null before and after.
  const [tourStep, setTourStep] = useState<number | null>(null)
  const [tourDone, setTourDone] = useState(false)
  const [lensHint, setLensHint] = useState<string | null>(null)
  useEffect(() => {
    if (!lensHint) return
    const id = setTimeout(() => setLensHint(null), HINT_MS)
    return () => clearTimeout(id)
  }, [lensHint])
  const endTour = () => {
    setTourStep(null)
    setTourDone(true)
  }
  const nextTourStep = () => {
    if (tourStep === null || tourStep === TOUR.length - 1) return endTour()
    setTourStep(tourStep + 1)
  }
  const tip = (target: TourTarget) =>
    tourStep !== null && TOUR[tourStep].target === target ? (
      <TourStep step={tourStep} onNext={nextTourStep} onSkip={endTour} />
    ) : undefined
  // Developer tuning panel: ?tune in the URL opens it, T toggles it.
  const [tuningOpen, setTuningOpen] = useState(() =>
    new URLSearchParams(window.location.search).has('tune'),
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 't' && !(e.target instanceof HTMLInputElement))
        setTuningOpen((open) => !open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
    // A rebuilt controller starts both eyes at the default; restore the user's
    // current selection.
    bootedAppRef.current.setLensProduct('left', FIXED_PRODUCT)
    bootedAppRef.current.setLensProduct('right', product)
    setGlassesOn(true)
    if (!tourDone) setTourStep(0)
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
    bootedAppRef.current?.setLensProduct('right', next)
    if (tourStep === null) setLensHint(LENS_EXPLAINERS[next])
  }

  const togglePause = () => {
    bootedAppRef.current?.setPaused(!paused)
    setPaused(!paused)
  }

  const changeLineVisible = (visible: boolean) => {
    lineState.visible = visible
    setLineVisible(visible)
    const url = new URL(window.location.href)
    if (visible) url.searchParams.delete('line')
    else url.searchParams.set('line', '0')
    window.history.replaceState(null, '', url)
  }

  // On phones the switcher stays a compact card, expanding to the full
  // selector only while the hint for a freshly picked lens is showing.
  const isPhone = useMediaQuery(COMPACT_QUERY)

  const { gyroActive, showEnableButton, enableMotionControls } =
    useDeviceOrientation(lookState)
  usePointerControls(canvasRef.current, lookState, gyroActive)

  return (
    <>
      <canvas
        ref={canvasRef}
        id="application-canvas"
        aria-label="Interactive 3D vision simulator"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'none',
        }}
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
      {!loading && !error && tuningOpen && <TuningPanel product={product} />}
      {!loading && !error && (
        <>
          <div className="absolute ui-top ui-left z-10">
            <Button
              variant="glass"
              size="icon"
              className="size-11"
              aria-label={paused ? 'Resume' : 'Pause'}
              onClick={togglePause}
            >
              {paused ? (
                <Play className="h-5 w-5" />
              ) : (
                <Pause className="h-5 w-5" />
              )}
            </Button>
            {glassesOn && tip('pause') && (
              <Tooltip side="bottom" align="start">
                {tip('pause')}
              </Tooltip>
            )}
          </div>
          <div className="absolute ui-top ui-right z-10 flex gap-2">
            {glassesOn && (
              <Button
                variant="glass"
                size="icon"
                className="size-11"
                aria-label="Take off glasses"
                onClick={takeOffGlasses}
              >
                <Glasses className="h-5 w-5" />
              </Button>
            )}
            <div className="relative">
              <Button
                variant="glass"
                size="icon"
                className="size-11"
                aria-label="Settings"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <Settings className="h-5 w-5" />
              </Button>
              {settingsOpen && (
                <SettingsPanel
                  lineVisible={lineVisible}
                  onLineVisible={changeLineVisible}
                />
              )}
              {glassesOn && tip('settings') && (
                <Tooltip side="bottom" align="end">
                  {tip('settings')}
                </Tooltip>
              )}
            </div>
          </div>
        </>
      )}
      {!loading && !error && glassesOn && (
        <LensSelector
          active={product}
          onCycle={cycleLenses}
          showHint={tourDone && !hasCycledLens}
          fixedTip={tip('fixed')}
          switchTip={tip('switch') ?? lensHint}
          compact={isPhone && !lensHint}
        />
      )}
    </>
  )
}
