import { describe, expect, it } from 'vitest'
import { acceptCareerOutpost, claimCareerOutpost, clearCareerOutpost, isCareerOutpostUnlocked, type CareerOutpostStageId } from '../../src/career/CareerOutpostMission'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'

const stats = { player: { damageDealt: 250, damageTaken: 10, kills: 3, structureDamage: 500, structuresDestroyed: 1, gateBreaches: 1, survived: true }, squads: [] }
function soldier(): CareerProfile {
  return { ...createCareerProfile('roman'), totalMerit: 300, availableMerit: 300, rank: 'soldier', starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'] }
}
function mission(stageId: CareerOutpostStageId = 1): CareerProfile {
  return acceptCareerOutpost({ ...soldier(), completedOutpostStages: stageId === 1 ? [] : stageId === 2 ? [1] : [1, 2] }, stageId, 'outpost-battle')!
}
describe('Career Outpost unlocks and results', () => {

  it('requires Soldier, a previous victory, and no active mission', () => {
    expect(acceptCareerOutpost(createCareerProfile('roman'), 1, 'recruit')).toBeNull()
    expect(isCareerOutpostUnlocked(soldier(), 1)).toBe(true)
    expect(isCareerOutpostUnlocked(soldier(), 2)).toBe(false)
    expect(isCareerOutpostUnlocked(soldier(), 3)).toBe(false)
    expect(acceptCareerOutpost(mission(), 1, 'other')).toBeNull()
  })
  it('awards battle-policy merit once, including after persistence and reload', () => {
    const current = mission(), store = new CareerProfileStore(new MemoryStorage())
    const claim = claimCareerOutpost(current, 'outpost-battle', 'victory', stats)
    const merit = 136
    expect(claim.meritAwarded).toBe(merit)
    expect(claim.profile.totalMerit).toBe(current.totalMerit + merit)
    expect(claim.profile.availableMerit).toBe(current.availableMerit + merit)
    expect(claim.profile.lifetimeStats).toMatchObject({ battles: 1, victories: 1, kills: 3, damage: 250, structureDamage: 0, breaches: 0 })
    expect(store.save(claim.profile)).toBe(true)
    const reloaded = store.load()!
    expect(reloaded.outpostBattleRecords?.[0]).toMatchObject({ id: 'outpost-battle', kind: 'outpost-defense', stageId: 1, outcome: 'victory', completed: true })
    const duplicate = claimCareerOutpost(reloaded, 'outpost-battle', 'victory', stats)
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile).toEqual(reloaded)
    expect(clearCareerOutpost(reloaded).activeOutpostMission).toBeUndefined()
  })
  it('settles defeat merit without unlocking the next stage and permits retry', () => {
    const profile = claimCareerOutpost(mission(), 'outpost-battle', 'defeat', stats).profile
    expect(profile.totalMerit).toBeGreaterThan(300)
    expect(isCareerOutpostUnlocked(profile, 2)).toBe(false)
    expect(profile.outpostBattleRecords?.[0].completed).toBe(false)
    expect(acceptCareerOutpost(clearCareerOutpost(profile), 1, 'retry')).not.toBeNull()
  })
  it('rejects malformed persisted stage ids and copies progression and records independently', () => {
    const raw = { ...soldier(), activeOutpostMission: { id: 'bad', kind: 'outpost-defense', stageId: 9 }, completedOutpostStages: [1, 1, 9, '2'], outpostBattleRecords: [{ id: 'bad' }] }
    const parsed = parseCareerProfile(raw)!
    expect(parsed.activeOutpostMission).toBeUndefined()
    expect(parsed.completedOutpostStages).toEqual([1])
    expect(parsed.outpostBattleRecords).toEqual([])
  })
})
