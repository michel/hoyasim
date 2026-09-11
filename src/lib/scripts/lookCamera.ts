import * as pc from 'playcanvas'

export interface LookState {
  lon: number
  lat: number
  // Reused per-frame target rotation written by the gyro listener.
  gyroQuat: pc.Quat
  gyroActive: boolean
}

const LAT_MIN = -85
const LAT_MAX = 85

// On touch, start pitched down so the handlebar phones — the reading target —
// sit centred in the first view a customer gets (the eye also moves in toward
// the bar there, playcanvasApp TOUCH_CAMERA_POS). Gyro or a drag takes over
// from here; desktop keeps the level start.
const START_LAT = pc.platform.touch ? -25 : 0

export function createLookState(): LookState {
  return { lon: 0, lat: START_LAT, gyroQuat: new pc.Quat(), gyroActive: false }
}

export function registerLookCamera(app: pc.AppBase, state: LookState) {
  const LookCamera = pc.createScript('lookCamera', app)
  if (!LookCamera) throw new Error('Failed to create LookCamera script')

  // Attributes match the values baked into the scene JSON's attached component
  // so PlayCanvas can populate them; this script reads its inputs from `state`.
  LookCamera.attributes.add('sensitivity', { type: 'number', default: 0.2 })
  LookCamera.attributes.add('pitchMin', { type: 'number', default: -45 })
  LookCamera.attributes.add('pitchMax', { type: 'number', default: 45 })
  LookCamera.attributes.add('yawRange', { type: 'number', default: 180 })

  LookCamera.extend({
    update(this: pc.ScriptType) {
      if (state.gyroActive) {
        this.entity.setLocalRotation(state.gyroQuat)
        return
      }
      const lat = pc.math.clamp(state.lat, LAT_MIN, LAT_MAX)
      this.entity.setLocalEulerAngles(lat, state.lon, 0)
    },
  })
}
