import * as pc from 'playcanvas'

export const CYCLE_FORWARD_BASE_SPEED = 1
const SHIFT_MULT = 5
// Linear-in-distance deceleration only reaches zero asymptotically; snap to the
// stop line once this close so the bike comes to a clean, exact halt.
const STOP_EPSILON = 0.03

interface CycleForwardInstance extends pc.ScriptType {
  speed: number
  startZ: number
  targetZ: number
  loop: boolean
  // Traffic-light stop gate (disabled when slowDownDistance <= 0).
  stopZ: number
  slowDownDistance: number
  waitDuration: number
  _stopped: boolean
  _waited: boolean
  _waitTimer: number
}

// Piecewise-linear lateral lane path: [worldZ, worldX] samples ordered from
// high z (lap start) to low z (wrap). The captured street is not perfectly
// straight — its centerline wanders ±0.3 world units — so the rig follows this
// measured path like a real cyclist instead of riding a fixed x, which read as
// the bike slowly veering off the road.
export type LanePath = [number, number][]

function laneX(path: LanePath, z: number): number {
  if (z >= path[0][0]) return path[0][1]
  for (let i = 1; i < path.length; i++) {
    const [z1, x1] = path[i]
    if (z >= z1) {
      const [z0, x0] = path[i - 1]
      return x0 + ((x0 - x1) * (z - z0)) / (z0 - z1)
    }
  }
  return path[path.length - 1][1]
}

export function registerCycleForward(app: pc.AppBase, lanePath?: LanePath) {
  const CycleForward = pc.createScript('cycleForward', app)
  if (!CycleForward) throw new Error('Failed to create CycleForward script')

  CycleForward.attributes.add('speed', { type: 'number', default: 4 })
  CycleForward.attributes.add('startZ', { type: 'number', default: 11 })
  CycleForward.attributes.add('targetZ', { type: 'number', default: -30 })
  CycleForward.attributes.add('loop', { type: 'boolean', default: false })
  CycleForward.attributes.add('stopZ', { type: 'number', default: 0 })
  CycleForward.attributes.add('slowDownDistance', {
    type: 'number',
    default: 0,
  })
  CycleForward.attributes.add('waitDuration', { type: 'number', default: 0 })

  CycleForward.extend({
    initialize(this: CycleForwardInstance) {
      this._stopped = false
      this._waited = false
      this._waitTimer = 0
      const base = this.speed
      const keyboard = this.app.keyboard
      if (keyboard) {
        const onKey = () => {
          this.speed = keyboard.isPressed(pc.KEY_SHIFT)
            ? base * SHIFT_MULT
            : base
        }
        keyboard.on(pc.EVENT_KEYDOWN, onKey)
        keyboard.on(pc.EVENT_KEYUP, onKey)
        this.on('destroy', () => {
          keyboard.off(pc.EVENT_KEYDOWN, onKey)
          keyboard.off(pc.EVENT_KEYUP, onKey)
        })
      }
    },

    update(this: CycleForwardInstance, dt: number) {
      const pos = this.entity.getLocalPosition()
      let z = pos.z
      let effSpeed = this.speed

      // Ease off toward, then idle at, the traffic-light stop line — once per
      // lap. dist > 0 while approaching from the +Z (start) side.
      if (this.slowDownDistance > 0 && !this._waited) {
        const dist = z - this.stopZ
        if (this._stopped) {
          this._waitTimer += dt
          effSpeed = 0
          if (this._waitTimer >= this.waitDuration) {
            this._waited = true
            this._stopped = false
          }
        } else if (dist <= STOP_EPSILON) {
          this._stopped = true
          this._waitTimer = 0
          effSpeed = 0
          z = this.stopZ
        } else if (dist <= this.slowDownDistance) {
          effSpeed = this.speed * (dist / this.slowDownDistance)
        }
      }

      let nextZ = z - effSpeed * dt

      if (nextZ <= this.targetZ) {
        if (this.loop) {
          const overshoot = this.targetZ - nextZ
          nextZ = this.startZ - overshoot
          this._stopped = false
          this._waited = false
          this._waitTimer = 0
        } else {
          nextZ = this.targetZ
        }
      }

      const nextX = lanePath ? laneX(lanePath, nextZ) : pos.x
      this.entity.setLocalPosition(nextX, pos.y, nextZ)
    },
  })
}
