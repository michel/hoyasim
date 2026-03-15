import { describe, expect, it } from 'vitest'
import { POLAR_ANGLE_MAX, POLAR_ANGLE_MIN } from './useRenderLoop'

describe('RenderLoop constants', () => {
  it('exports polar angle limits', () => {
    expect(POLAR_ANGLE_MIN).toBeCloseTo(Math.PI / 2.5)
    expect(POLAR_ANGLE_MAX).toBeCloseTo(Math.PI / 1.6)
  })
})
