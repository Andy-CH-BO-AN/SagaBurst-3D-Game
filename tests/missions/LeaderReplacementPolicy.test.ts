import { describe, expect, it } from 'vitest'
import { selectLivingMissionLeader } from '../../src/career/BanditMissionController'

describe('Mission living leader replacement', () => {
  it('chooses the first living friendly once when the current leader dies', () => {
    const deadLeader = { id: 'captain', dead: true }
    const deadFirst = { id: 'friendly-0', dead: true }
    const livingFirst = { id: 'friendly-1', dead: false }
    const livingSecond = { id: 'friendly-2', dead: false }
    expect(selectLivingMissionLeader(deadLeader, [deadLeader, deadFirst, livingFirst, livingSecond])).toBe(livingFirst)
    expect(selectLivingMissionLeader(livingFirst, [livingFirst, livingSecond])).toBe(livingFirst)
  })
})
