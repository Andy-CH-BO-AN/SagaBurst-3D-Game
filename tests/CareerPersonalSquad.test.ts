import { describe, expect, it, vi } from 'vitest'
import { createCareerProfile, cloneCareerProfile, type CareerRank } from '../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../src/career/CareerProfileStore'
import { canRecruitPersonalSquad, personalSquadGreeting, recruitPersonalSquadMember } from '../src/career/CareerPersonalSquad'
function profile(rank: CareerRank = 'captain') { return { ...createCareerProfile('roman'), rank, totalMerit: 60000, availableMerit: 60000 } }
describe('Personal Squad recruitment and durable identity', () => {
  it.each(['recruit', 'soldier', 'veteran'] as const)('refuses %s in domain even with 60,000 merit', rank => {
    const current = profile(rank), save = vi.fn(() => true)
    expect(canRecruitPersonalSquad(current)).toBe(false)
    expect(personalSquadGreeting(current)).not.toContain('五百')
    expect(recruitPersonalSquadMember(current, 'soldier', save)).toMatchObject({ recruited: false, reason: 'rank-locked', profile: current })
    expect(save).not.toHaveBeenCalled(); expect(current.availableMerit).toBe(60000)
  })
  it.each(['captain', 'commander'] as const)('recruits repeated heroes and soldiers at canonical prices for %s', rank => {
    let current = profile(rank)
    for (const type of ['soldier', 'captain', 'captain', 'ranger', 'ranger'] as const) {
      const old = cloneCareerProfile(current)
      const result = recruitPersonalSquadMember(current, type, () => true)
      expect(result.recruited).toBe(true); expect(current).toEqual(old); current = result.profile
    }
    expect(current.availableMerit).toBe(57950); expect(current.totalMerit).toBe(60000)
    expect(current.personalSquad?.members).toHaveLength(5)
    expect(new Set(current.personalSquad!.members.map(member => member.id)).size).toBe(5)
    const roundtrip = parseCareerProfile(JSON.parse(JSON.stringify(current)))!
    expect(roundtrip.personalSquad).toEqual(current.personalSquad)
    expect(roundtrip.townDialogueSeen).toContain('roman:hr-recruit-ranger')
    const clone = cloneCareerProfile(roundtrip); clone.personalSquad!.members[0].type = 'captain'
    expect(roundtrip.personalSquad!.members[0].type).toBe('soldier')
  })
  it('allows player plus thirty heroes and rejects member 31 without spending', () => {
    let current = profile()
    for (let i = 0; i < 30; i++) current = recruitPersonalSquadMember(current, 'captain', () => true).profile
    const save = vi.fn(() => true), old = cloneCareerProfile(current)
    expect(recruitPersonalSquadMember(current, 'ranger', save)).toMatchObject({ recruited: false, reason: 'squad-full' })
    expect(current).toEqual(old); expect(save).not.toHaveBeenCalled()
  })
  it('stages roster and deduction atomically and preserves both on storage failure', () => {
    const current = profile(), snapshots: unknown[] = []
    const storage = { setItem: (_key: string, value: string) => { snapshots.push(JSON.parse(value)); throw new Error('quota') } } as Storage
    const store = new CareerProfileStore(storage)
    const result = recruitPersonalSquadMember(current, 'captain', next => store.save(next))
    expect(result).toMatchObject({ recruited: false, reason: 'save-failed' })
    expect(current.availableMerit).toBe(60000); expect(current.personalSquad).toBeUndefined()
    expect(snapshots[0]).toMatchObject({ availableMerit: 59500, personalSquad: { members: [{ type: 'captain' }] } })
    expect(recruitPersonalSquadMember(current, 'ranger', () => { throw Error('quota') }).recruited).toBe(false)
  })
  it('checks insufficient funds and rejects invalid products and duplicate generated IDs', () => {
    const current = { ...profile(), availableMerit: 499 }, save = vi.fn(() => true)
    expect(recruitPersonalSquadMember(current, 'captain', save).reason).toBe('insufficient-merit')
    expect(save).not.toHaveBeenCalled()
    expect(recruitPersonalSquadMember(profile(), 'invalid' as never, save).reason).toBe('invalid-product')
    const first = recruitPersonalSquadMember(profile(), 'ranger', save, () => 'personal:fixed').profile
    expect(recruitPersonalSquadMember(first, 'ranger', save, () => 'personal:fixed').reason).toBe('invalid-id')
  })
  it('loads legacy saves without inventing members and fails closed on corrupt ownership', () => {
    expect(parseCareerProfile(profile())?.personalSquad).toBeUndefined()
    for (const members of [[{ id: 'personal:x', type: 'invalid' }], [{ id: 'soldier-0', type: 'soldier' }],
      [{ id: 'personal:x', type: 'soldier' }, { id: 'personal:x', type: 'captain' }], Array.from({ length: 31 }, (_, i) => ({ id: `personal:${i}`, type: 'soldier' }))]) {
      expect(parseCareerProfile({ ...profile(), personalSquad: { members } })).toBeNull()
    }
  })
  it('remembers the Captain unlock independently of earlier low-rank meetings', () => {
    const current = profile(); expect(personalSquadGreeting(current)).toContain('現在你有資格')
    current.townDialogueSeen = ['roman:hr-unlocked']
    expect(personalSquadGreeting(parseCareerProfile(current)!)).toBe('Captain，需要補充你的隊伍嗎？')
    expect(personalSquadGreeting(profile('commander'))).toContain('Commander')
  })
})
