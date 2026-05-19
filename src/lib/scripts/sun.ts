import * as pc from 'playcanvas'

// World-space direction of the sun baked into the skybox cubemap, after
// the scene's 180° Y rotation. Sun appears in the upper-right of the
// camera's default forward view, so the direction lies in the
// (+X, +Y, -Z) octant. Verified empirically by overlaying the projected
// ray-centre on the visible skybox sun.
//
// Used by:
//   - the impaired overlay to wash the screen toward white when the
//     camera looks toward the sun (the "blind" effect)
//   - the Sensity lens to darken when the same camera direction lines up
//
// No mesh / no render cost — this is a pure data export.
export const SUN_DIRECTION: pc.Vec3 = new pc.Vec3(0.6, 0.6, -1).normalize()

const _tmpForward = new pc.Vec3()

// Returns a value in [0..1] indicating how directly the camera is looking
// at the skybox sun. 1 = sun is centred in view, 0 = sun is behind.
export function sunInView(cameraEntity: pc.Entity): number {
  // cameraEntity.forward returns a cached Vec3; copy so callers can't mutate
  // it. Single dot product, no allocations.
  _tmpForward.copy(cameraEntity.forward)
  return Math.max(0, _tmpForward.dot(SUN_DIRECTION))
}
