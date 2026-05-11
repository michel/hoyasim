import * as pc from 'playcanvas'

export interface LookState {
  lon: number
  lat: number
  // Reused per-frame target rotation written by the gyro listener.
  gyroQuat: pc.Quat
  gyroActive: boolean
}

interface LookCameraInstance extends pc.ScriptType {
  sensitivity: number
  pitchMin: number
  pitchMax: number
  yawRange: number
}

export const LAT_MIN = -85
export const LAT_MAX = 85

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
    update(this: LookCameraInstance) {
      if (state.gyroActive) {
        this.entity.setLocalRotation(state.gyroQuat)
        return
      }
      const lat = Math.max(LAT_MIN, Math.min(LAT_MAX, state.lat))
      this.entity.setLocalEulerAngles(lat, state.lon, 0)
    },
  })
}
