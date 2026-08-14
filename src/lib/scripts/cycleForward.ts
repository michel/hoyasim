import * as pc from 'playcanvas'

export const CYCLE_FORWARD_BASE_SPEED = 1
// Linear-in-distance deceleration only reaches zero asymptotically; snap to the
// stop line once this close so the bike comes to a clean, exact halt.
const STOP_EPSILON = 0.03

interface CycleForwardInstance extends pc.ScriptType {
  speed: number
  startZ: number
  targetZ: number
  // Traffic-light stop gate (disabled when slowDownDistance <= 0).
  stopZ: number
  slowDownDistance: number
  waitDuration: number
  _stopped: boolean
  _waited: boolean
  _waitTimer: number
}

export function registerCycleForward(app: pc.AppBase) {
  const CycleForward = pc.createScript('cycleForward', app)
  if (!CycleForward) throw new Error('Failed to create CycleForward script')

  CycleForward.attributes.add('speed', { type: 'number', default: 4 })
  CycleForward.attributes.add('startZ', { type: 'number', default: 11 })
  CycleForward.attributes.add('targetZ', { type: 'number', default: -30 })
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

      // Loop: wrap back to the start, carrying the overshoot for a seamless snap.
      if (nextZ <= this.targetZ) {
        nextZ = this.startZ - (this.targetZ - nextZ)
        this._stopped = false
        this._waited = false
        this._waitTimer = 0
      }

      this.entity.setLocalPosition(pos.x, pos.y, nextZ)
    },
  })
}
