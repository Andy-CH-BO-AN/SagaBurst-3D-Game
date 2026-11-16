import { describe, expect, it } from 'vitest'
import { getDirectionalMovementFromKeyboard } from '../../src/movement/DirectionalMovement'

describe('Directional movement policy', () => {
  it.each([
    ['forward and backward', true, true, false, false],
  ] as const)('cancels opposing %s keys', (_name, forward, back, left, right) => {
    expect(getDirectionalMovementFromKeyboard(forward, back, left, right)).toBeNull()
  })

  it('keeps diagonal speed equal to cardinal movement for forward and backward directions', () => {
    for (const [forward, back] of [[true, false], [false, true]] as const) {
      const straight = getDirectionalMovementFromKeyboard(forward, back, false, false)!
      const diagonal = getDirectionalMovementFromKeyboard(forward, back, true, false)!
      expect(diagonal.multiplier).toBeCloseTo(straight.multiplier, 5)
    }
  })
})
