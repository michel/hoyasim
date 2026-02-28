import { describe, expect, it } from 'vitest'
import { DRAG_SENSITIVITY, LAT_MAX, LAT_MIN } from './usePointerControls'

describe('PointerControls constants', () => {
  it('exports drag sensitivity', () => {
    expect(DRAG_SENSITIVITY).toBe(0.1)
  })

  it('exports lat clamp bounds', () => {
    expect(LAT_MIN).toBe(-85)
    expect(LAT_MAX).toBe(85)
  })
})
