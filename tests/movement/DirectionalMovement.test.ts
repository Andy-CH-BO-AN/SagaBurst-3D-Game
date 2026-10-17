import { describe, expect, it } from 'vitest'
import { getDirectionalMovementFromKeyboard } from '../../src/movement/DirectionalMovement'

describe('Directional movement policy', () => {
  it.each([
    ['forward and backward', true, true, false, false],
  ] as const)('cancels opposing %s keys', (_name, forward, back, left, right) => {
    expect(getDirectionalMovementFromKeyboard(forward, back, left, right)).toBeNull()
  })

  it.each([
    ['forward', true, false, 8],
    ['backward', false, true, 2.4],
  ] as const)('keeps diagonal %s speed equal to cardinal movement', (_name, forward, back, expected) => {
    const straight = getDirectionalMovementFromKeyboard(forward, back, false, false)!
    const diagonal = getDirectionalMovementFromKeyboard(forward, back, true, false)!
    expect(8 * straight.multiplier).toBeCloseTo(expected, 5)
    expect(8 * diagonal.multiplier).toBeCloseTo(expected, 5)
  })
})
