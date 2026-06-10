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

export function createLookState(): LookState {
  return { lon: 0, lat: 0, gyroQuat: new pc.Quat(), gyroActive: false }
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
