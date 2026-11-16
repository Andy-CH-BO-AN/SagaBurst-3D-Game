import { describe, expect, it } from 'vitest'
import { InteractionFocus, type InteractionCandidate } from '../../src/world/InteractionFocus'

const origin = { x: 0, y: 0, z: 0 }
function candidate(target: string, x: number, z: number, action = 'equip'): InteractionCandidate<string> {
  return { target, position: { x, y: 0, z }, range: 2, action, prompt: target }
}

describe('Interaction focus', () => {
  it('prefers a broad facing direction, holds close scores and switches when the player looks elsewhere', () => {
    const focus = new InteractionFocus<string>()
    const left = candidate('left', -.8, 1.2), right = candidate('right', .8, 1.2)
    expect(focus.select([left, right], origin, { x: 0, z: 1 })?.target).toBe('left')
    expect(focus.select([left, right], { x: .05, y: 0, z: 0 }, { x: 0, z: 1 })?.target).toBe('left')
    expect(focus.select([left, right], origin, { x: .8, z: 1.2 })?.target).toBe('right')
    focus.clear()
    expect(focus.select([left, right], { x: .4, y: 0, z: 0 }, { x: 0, z: -1 })?.target).toBe('right')
  })

  it('cancels a press when the displayed target disappears, moves out of range, or its advertised result changes', () => {
    const focus = new InteractionFocus<string>()
    const left = candidate('left', -.8, 1.2), right = candidate('right', .8, 1.2)
    expect(focus.pressed(true, [left], origin)).toBeNull()
    focus.select([left, right], origin, { x: -.8, z: 1.2 })
    expect(focus.pressed(true, [left, right], origin)?.target).toBe('left')
    expect(focus.pressed(true, [right], origin)).toBeNull()
    expect(focus.pressed(true, [left, right], { x: 3, y: 0, z: 0 })).toBeNull()
    expect(focus.pressed(true, [{ ...left, action: 'backpack' }, right], origin)).toBeNull()
  })
})
