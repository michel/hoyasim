import { describe, expect, it } from 'vitest'
import { WORLD_CORRECTION_QUATERNION } from './useDeviceOrientation'

describe('DeviceOrientation constants', () => {
  it('exports world correction quaternion (-90 deg X rotation)', () => {
    const q = WORLD_CORRECTION_QUATERNION
    // -sqrt(0.5), 0, 0, sqrt(0.5) = -90 degrees around X
    expect(q.x).toBeCloseTo(-Math.sqrt(0.5))
    expect(q.y).toBe(0)
    expect(q.z).toBe(0)
    expect(q.w).toBeCloseTo(Math.sqrt(0.5))
  })
})
