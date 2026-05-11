import * as pc from 'playcanvas'

export const CYCLE_FORWARD_BASE_SPEED = 1
const SHIFT_MULT = 5

interface CycleForwardInstance extends pc.ScriptType {
  speed: number
  startZ: number
  targetZ: number
  loop: boolean
  fadeDistance: number
  _overlay?: HTMLDivElement
  _lastOpacity?: number
}

export function registerCycleForward(app: pc.AppBase) {
  const CycleForward = pc.createScript('cycleForward', app)
  if (!CycleForward) throw new Error('Failed to create CycleForward script')

  CycleForward.attributes.add('speed', { type: 'number', default: 4 })
  CycleForward.attributes.add('startZ', { type: 'number', default: 11 })
  CycleForward.attributes.add('targetZ', { type: 'number', default: -30 })
  CycleForward.attributes.add('loop', { type: 'boolean', default: false })
  CycleForward.attributes.add('fadeDistance', { type: 'number', default: 3 })

  CycleForward.extend({
    initialize(this: CycleForwardInstance) {
      const base = this.speed
      const keyboard = this.app.keyboard
      if (keyboard) {
        const onKey = () => {
          this.speed = keyboard.isPressed(pc.KEY_SHIFT) ? base * SHIFT_MULT : base
        }
        keyboard.on(pc.EVENT_KEYDOWN, onKey)
        keyboard.on(pc.EVENT_KEYUP, onKey)
        this.on('destroy', () => {
          keyboard.off(pc.EVENT_KEYDOWN, onKey)
          keyboard.off(pc.EVENT_KEYUP, onKey)
        })
      }

      if (!this.loop) return
      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:#000',
        'opacity:0',
        'pointer-events:none',
        'z-index:9999',
      ].join(';')
      document.body.appendChild(overlay)
      this._overlay = overlay
      this._lastOpacity = 0
      this.on('destroy', () => overlay.remove())
    },

    update(this: CycleForwardInstance, dt: number) {
      const pos = this.entity.getLocalPosition()
      let nextZ = pos.z - this.speed * dt

      if (nextZ <= this.targetZ) {
        if (this.loop) {
          const overshoot = this.targetZ - nextZ
          nextZ = this.startZ - overshoot
        } else {
          nextZ = this.targetZ
        }
      }

      this.entity.setLocalPosition(pos.x, pos.y, nextZ)

      if (this._overlay && this.fadeDistance > 0) {
        const distFromStart = this.startZ - nextZ
        const distFromTarget = nextZ - this.targetZ
        const a1 =
          distFromTarget < this.fadeDistance
            ? 1 - Math.max(0, distFromTarget) / this.fadeDistance
            : 0
        const a2 =
          distFromStart < this.fadeDistance
            ? 1 - Math.max(0, distFromStart) / this.fadeDistance
            : 0
        const next = Math.max(a1, a2)
        if (next !== this._lastOpacity) {
          this._overlay.style.opacity = String(next)
          this._lastOpacity = next
        }
      }
    },
  })
}
