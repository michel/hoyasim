import { useReducer, useState } from 'react'
import {
  LENS_PRODUCTS,
  type LensProduct,
  type LensProductProfile,
  resetProductProfiles,
  setProductProfile,
} from '@/lib/glasses-pc'
import {
  DEFAULT_TUNING,
  type EffectTuning,
  setTuning,
  TUNING_GROUPS,
  TUNING_RANGES,
  type TuningRange,
  tuning,
} from '@/lib/tuning'

const PROFILE_RANGES: Record<keyof LensProductProfile, TuningRange> = {
  cornerWidth: { label: 'Wing width', min: 0, max: 0.5, step: 0.01 },
  cornerHeight: { label: 'Wing height', min: 0, max: 1, step: 0.01 },
  feather: { label: 'Wing feather', min: 0, max: 0.4, step: 0.01 },
}

function Slider({
  range,
  value,
  onChange,
}: {
  range: TuningRange
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="mb-1.5 block" aria-label={range.label}>
      <span className="flex justify-between">
        <span>{range.label}</span>
        <span className="tabular-nums text-white/70">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        className="w-full accent-white"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function TuningSlider({
  tuningKey,
  rerender,
}: {
  tuningKey: keyof EffectTuning
  rerender: () => void
}) {
  return (
    <Slider
      range={TUNING_RANGES[tuningKey]}
      value={tuning[tuningKey]}
      onChange={(value) => {
        setTuning({ [tuningKey]: value })
        rerender()
      }}
    />
  )
}

// Developer tuning panel: live sliders over the effect values and the active
// product's wing geometry. Copy puts the current values on the clipboard as
// JSON, ready to be baked into tuning.ts / LENS_PRODUCTS.
export default function TuningPanel({ product }: { product: LensProduct }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const [showJson, setShowJson] = useState(false)
  const profile = LENS_PRODUCTS[product]
  const json = JSON.stringify({ tuning, products: LENS_PRODUCTS }, null, 2)
  const copy = () => navigator.clipboard.writeText(json)
  const reset = () => {
    setTuning(DEFAULT_TUNING)
    resetProductProfiles()
    rerender()
  }
  return (
    <div className="absolute top-4 left-4 z-20 w-64 rounded-xl bg-black/70 p-3 text-xs text-white backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">Tuning</span>
        <span className="flex gap-3 text-white/80">
          <button type="button" onClick={copy}>
            Copy
          </button>
          <button type="button" onClick={() => setShowJson((v) => !v)}>
            {showJson ? 'Hide' : 'Show'} values
          </button>
          <button type="button" onClick={reset}>
            Reset
          </button>
        </span>
      </div>
      {showJson && (
        <pre className="mb-2 max-h-48 select-all overflow-auto rounded bg-black/50 p-2 text-[10px] leading-tight">
          {json}
        </pre>
      )}
      {TUNING_GROUPS.map((group) => (
        <div key={group.title}>
          <div className="mt-2 mb-1 font-semibold">{group.title}</div>
          {group.keys.map((key) => (
            <TuningSlider key={key} tuningKey={key} rerender={rerender} />
          ))}
        </div>
      ))}
      <div className="mt-2 mb-1 font-semibold">{product} wings</div>
      <TuningSlider tuningKey="softZoneBlurMaxPx" rerender={rerender} />
      {(Object.keys(PROFILE_RANGES) as (keyof LensProductProfile)[]).map(
        (key) => (
          <Slider
            key={key}
            range={PROFILE_RANGES[key]}
            value={profile[key]}
            onChange={(value) => {
              setProductProfile(product, { [key]: value })
              rerender()
            }}
          />
        ),
      )}
    </div>
  )
}
