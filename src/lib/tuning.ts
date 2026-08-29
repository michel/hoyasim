// Live-tunable effect values. DEFAULT_TUNING is the shipped look; the tuning
// panel (open with ?tune in the URL, or press T) mutates `tuning` at runtime
// and every material re-applies on change. Units: distances in world units
// (the handlebar phones sit at ~0.18, the road starts around 1, the far street
// reads as the far plane), zone positions in lens height (0 = top,
// 1 = bottom), blur radii in CSS pixels (the shaders scale by uPxScale).
export interface EffectTuning {
  // Top (distance) lens: whatever is NEARER than topNearLimit blurs, ramping
  // over ±topTransition around it.
  topStrengthPx: number
  topNearLimit: number
  topTransition: number
  // Bottom (reading) lens: whatever is FARTHER than bottomFarLimit blurs,
  // ramping over ±bottomTransition around it.
  bottomStrengthPx: number
  bottomFarLimit: number
  bottomTransition: number
  // Corridor: lens heights where the top lens ends and the bottom lens starts.
  corridorTop: number
  corridorBottom: number
  // Per-product wings (peripheral astigmatism) and the uncorrected surround.
  softZoneBlurMaxPx: number
  impairedBlurRadiusPx: number
  impairedDim: number
}

export const DEFAULT_TUNING: EffectTuning = {
  topStrengthPx: 3.5,
  topNearLimit: 0.4,
  topTransition: 0.15,
  bottomStrengthPx: 3.5,
  bottomFarLimit: 0.6,
  bottomTransition: 0.2,
  corridorTop: 0.4,
  corridorBottom: 0.6,
  softZoneBlurMaxPx: 6.5,
  impairedBlurRadiusPx: 2,
  impairedDim: 0.88,
}

export interface TuningRange {
  label: string
  min: number
  max: number
  step: number
}

export const TUNING_RANGES: Record<keyof EffectTuning, TuningRange> = {
  topStrengthPx: {
    label: 'Blur of close things (px)',
    min: 0,
    max: 30,
    step: 0.5,
  },
  topNearLimit: { label: 'Close = nearer than', min: 0.1, max: 3, step: 0.01 },
  topTransition: { label: 'Edge softness', min: 0.01, max: 1, step: 0.01 },
  bottomStrengthPx: {
    label: 'Blur of far things (px)',
    min: 0,
    max: 30,
    step: 0.5,
  },
  bottomFarLimit: { label: 'Far = farther than', min: 0.1, max: 5, step: 0.01 },
  bottomTransition: { label: 'Edge softness', min: 0.01, max: 2, step: 0.01 },
  corridorTop: { label: 'Top lens ends at', min: 0, max: 1, step: 0.01 },
  corridorBottom: {
    label: 'Bottom lens starts at',
    min: 0,
    max: 1,
    step: 0.01,
  },
  softZoneBlurMaxPx: { label: 'Wing blur (px)', min: 0, max: 30, step: 0.5 },
  impairedBlurRadiusPx: {
    label: 'Uncorrected blur (px)',
    min: 0,
    max: 40,
    step: 0.5,
  },
  impairedDim: { label: 'Surround brightness', min: 0.3, max: 1, step: 0.01 },
}

// Panel layout; the per-product wing sliders form their own section.
export const TUNING_GROUPS: { title: string; keys: (keyof EffectTuning)[] }[] =
  [
    {
      title: 'Top lens (distance)',
      keys: ['topStrengthPx', 'topNearLimit', 'topTransition'],
    },
    {
      title: 'Bottom lens (reading)',
      keys: ['bottomStrengthPx', 'bottomFarLimit', 'bottomTransition'],
    },
    {
      title: 'Corridor (lens height, 0 = top)',
      keys: ['corridorTop', 'corridorBottom'],
    },
    {
      title: 'Uncorrected surround',
      keys: ['impairedBlurRadiusPx', 'impairedDim'],
    },
  ]

export const tuning: EffectTuning = { ...DEFAULT_TUNING }

const listeners = new Set<() => void>()

// Registers a material refresh; returns the unsubscribe.
export function onTuningChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const notifyTuning = () => {
  for (const listener of listeners) listener()
}

export function setTuning(patch: Partial<EffectTuning>) {
  Object.assign(tuning, patch)
  notifyTuning()
}
