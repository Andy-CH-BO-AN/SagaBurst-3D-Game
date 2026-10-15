import { describe, expect, it } from 'vitest'
import { followLocalOffset, returnFollowLocalOffset } from '../../src/battle/FollowOrder'

describe('FOLLOW tactical geometry', () => {

  it('fits all eighteen large-mission followers within the Town return muster', () => {
    const returning = Array.from({ length: 18 }, (_, index) => returnFollowLocalOffset(index, 18))
    expect(new Set(returning.map(slot => `${slot.x}:${slot.z}`)).size).toBe(18)
    expect(Math.max(...returning.map(slot => slot.length()))).toBeLessThan(18)
    expect(followLocalOffset(17).length()).toBeGreaterThan(18)
  })
})
