import type * as pc from 'playcanvas'
import type { LensSide, SideState } from './glasses-pc'

// Motion for the glasses: the put-on entrance drop and the boundary-line trace
// that sweeps each product's clear-field contour. Split from glasses-pc so the
// lens construction stays readable.

// Boundary-line trace timing: sweep the dotted line on, hold, then fade out.
// Triggered on put-on (both eyes) and on every product switch (that eye).
const TRACE_IN_SEC = 0.55
const TRACE_HOLD_SEC = 0.7
const TRACE_OUT_SEC = 0.6

// "Putting on glasses" entrance. The glasses start this far above their rest
// position (in camera-local Y units, i.e. screen-vertical) and slide down into
// the eye line. ENTRANCE_OVERSHOOT controls the easeOutBack tension — the
// glasses dip slightly past rest and settle back, reading as a physical drop.
export const ENTRANCE_DROP = 1.2
const ENTRANCE_DURATION = 0.6
const ENTRANCE_OVERSHOOT = 1.1

// easeOutBack: accelerates down, overshoots the target, then settles back to it
// exactly at t = 1 — the little bounce that sells the "drop into place" feel.
function easeOutBack(t: number): number {
  const c1 = ENTRANCE_OVERSHOOT
  const c3 = c1 + 1
  const p = t - 1
  return 1 + c3 * p * p * p + c1 * p * p
}

// Kick the boundary-line trace for a side (idempotent restart).
export const startTrace = (s: SideState | null) => {
  if (s) s.traceElapsed = 0
}

// Per-frame trace ramp: sweep the dotted line on, hold, fade out. Costs nothing
// while idle (no trace pending on either eye).
export function createTraceUpdate(sides: Record<LensSide, SideState | null>) {
  return (dt: number) => {
    if (sides.left?.traceElapsed == null && sides.right?.traceElapsed == null)
      return
    for (const s of [sides.left, sides.right]) {
      if (!s || s.traceElapsed == null) continue
      s.traceElapsed += dt
      const e = s.traceElapsed
      const trace = Math.min(1, e / TRACE_IN_SEC)
      let fade: number
      if (e < TRACE_IN_SEC + TRACE_HOLD_SEC) fade = 1
      else if (e < TRACE_IN_SEC + TRACE_HOLD_SEC + TRACE_OUT_SEC)
        fade = 1 - (e - TRACE_IN_SEC - TRACE_HOLD_SEC) / TRACE_OUT_SEC
      else {
        fade = 0
        s.traceElapsed = null
      }
      s.material.setParameter('uLineTrace', trace)
      s.material.setParameter('uLineFade', fade)
    }
  }
}

// Drop-into-place tween for the glasses groups. play() resolves once settled;
// cancel() detaches a mid-flight animation so teardown stays clean.
export function createEntrance(
  app: pc.AppBase,
  groups: pc.Entity[],
  finalPositions: pc.Vec3[],
  onSettled: () => void,
) {
  let tick: ((dt: number) => void) | null = null
  const cancel = () => {
    if (tick) app.off('update', tick)
    tick = null
  }
  const play = () =>
    new Promise<void>((resolve) => {
      let elapsed = 0
      tick = (dt: number) => {
        elapsed += dt
        const t = Math.min(1, elapsed / ENTRANCE_DURATION)
        const offset = ENTRANCE_DROP * (1 - easeOutBack(t))
        for (let i = 0; i < groups.length; i++) {
          const f = finalPositions[i]
          groups[i].setLocalPosition(f.x, f.y + offset, f.z)
        }
        if (t < 1) return
        cancel()
        onSettled()
        resolve()
      }
      app.on('update', tick)
    })
  return { play, cancel }
}
