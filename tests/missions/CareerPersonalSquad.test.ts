import { describe, expect, it, vi } from 'vitest'
import { canRecruitPersonalSquad, recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { cloneCareerProfile, createCareerProfile, type CareerRank } from '../../src/career/CareerProfile'
import { MemoryStorage } from '../helpers/memoryStorage'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
function profile(rank: CareerRank = 'captain') { return { ...createCareerProfile('roman'), rank, totalMerit: 60000, availableMerit: 60000 } }
describe('Personal Squad recruitment and durable identity', () => {
  it.each(['captain'] as const)('requires formal Commander rank to hire T5 even with 60,000 merit at %s', rank => {
    const current = profile(rank), before = cloneCareerProfile(current), save = vi.fn(() => true)
    expect(canRecruitPersonalSquad(current, 'commander')).toBe(false)
    expect(recruitPersonalSquadMember(current, 'commander', save)).toMatchObject({ recruited: false, reason: 'rank-locked' })
    expect(current).toEqual(before); expect(save).not.toHaveBeenCalled()
  })
  it('shares the thirty-member cap across Soldier, Captain, Maki and Commander without spending on member 31', () => {
    let current = profile('commander')
    const types = ['soldier', 'captain', 'ranger', 'commander'] as const
    current.personalSquad = { members: Array.from({ length: 30 }, (_, index) => ({
      id: 'personal:' + index, type: types[index % types.length],
    })) }
    const save = vi.fn(() => true), old = cloneCareerProfile(current)
    expect(recruitPersonalSquadMember(current, 'commander', save)).toMatchObject({ recruited: false, reason: 'squad-full' })
    expect(current).toEqual(old); expect(save).not.toHaveBeenCalled()
  })
  it.each([['commander', 58000]] as const)('stages %s roster, inventory and deduction atomically and preserves all on storage failure', (type, merit) => {
    const current = profile('commander'), before = cloneCareerProfile(current), snapshots: unknown[] = []
    class FailedStorage extends MemoryStorage {
      override setItem(_key: string, value: string): void { snapshots.push(JSON.parse(value)); throw new Error('quota') }
    }
    const storage = new FailedStorage()
    const store = new CareerProfileStore(storage)
    const result = recruitPersonalSquadMember(current, type, next => store.save(next))
    expect(result).toMatchObject({ recruited: false, reason: 'save-failed' })
    expect(current).toEqual(before)
    expect(snapshots[0]).toMatchObject({ availableMerit: merit, personalSquad: { members: [{ type }] }, inventory: { quantities: { gladius_standard: 1, scutum_t3: 1, horse: 1 } } })
    expect(recruitPersonalSquadMember(current, type, () => { throw Error('quota') }).recruited).toBe(false)
    expect(current).toEqual(before)
  })
})
