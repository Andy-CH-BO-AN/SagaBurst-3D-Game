import { describe, expect, it } from 'vitest'
import { initialPersonalEquipment } from '../../src/career/CareerInventory'
import { createCareerProfile, enlistmentMerit, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { createDefaultSkillState } from '../../src/rpg/SkillManager'
import { commitTownProfile, type TownProfileCommitRuntime } from '../../src/town/TownProfileCommit'
import { TownResultSettlement } from '../../src/town/TownResultSettlement'
import type { TownResult } from '../../src/town/TownRules'
import { careerRankFixture } from '../helpers/careerRankFixture'
import { MemoryStorage } from '../helpers/memoryStorage'
import { personalSquadFixture } from '../helpers/personalSquadFixture'

function hostileProfile(): CareerProfile {
  const profile = createCareerProfile('roman')
  profile.totalMerit = 22000; profile.availableMerit = 180
  Object.assign(profile, careerRankFixture(profile.faction, 'commander'))
  profile.townEvent = { id: 'conquest', state: 'hostile' }
  profile.personalSquad = personalSquadFixture(profile, [{ id: 'personal:permanent', type: 'soldier', originalHirePrice: 50,
    equipment: initialPersonalEquipment('soldier', 'roman') }])
  profile.inventory = { version: 1, quantities: { gladius_rusty: 2,
    ...Object.fromEntries(Object.values(initialPersonalEquipment('soldier', 'roman')).filter(Boolean).map(id => [id, 1])) } }
  profile.skills = { ...createDefaultSkillState(), ...profile.skills, ranged: { level: 4, xp: 20 } }
  profile.claimedBattleIds = ['historical-battle']
  return parseCareerProfile(profile)!
}

/** The real save transaction (`commitTownProfile` over a real store); only the scene effects are recorded. */
function settledTown(profile: CareerProfile) {
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(profile)).toBe(true)
  const live = { profile }
  const record = { saveAttempts: 0, announced: [] as Array<{ id: string; result: TownResult }>, disposed: 0,
    restarts: [] as Array<{ profile: CareerProfile; reason?: 'death-return' }> }
  const runtime: TownProfileCommitRuntime = {
    get profile() { return live.profile }, set profile(next) { live.profile = next },
    store: { save: next => { record.saveAttempts++; return store.save(next) } }, get skills() { return { skillState: live.profile.skills ?? createDefaultSkillState() } },
    residents: [], world: { faction: profile.faction }, sceneContext: { missionOnlyResidents: false },
    garrisonRestored: false, restoringAerialState: false, residentReturnPending: false,
    townRefitOnReturn: false, careerSaveFailures: 0, careerSkillsDirty: false, notice: '',
    clearCareerSkillSaveTimer() {}, unavailableTownCavalryActorIds: () => new Set(),
    captureRetirementResources() {}, applyRetirementDeparture() {},
    synchronizeEaglePatrolPolicy() {}, synchronizeCommandActors() {}, cancelCareerAudio() {},
  }
  const settlement = new TownResultSettlement({
    read: () => live.profile, commit: next => commitTownProfile(runtime, next),
    announce: outcome => { record.announced.push(outcome) },
    dispose: () => { record.disposed++ },
    restart: (next, reason) => { record.restarts.push({ profile: next, reason }) },
  })
  return { settlement, storage, store, live, record }
}

describe('Town result settlement', () => {
  it('claims a result only by a successful save, settles once on retry, then allows the transition', () => {
    for (const result of ['town_defeated', 'player_defeated'] as const) {
    const profile = hostileProfile(), original = JSON.parse(JSON.stringify(profile)) as CareerProfile
    const { settlement, storage, store, live, record } = settledTown(profile)
    storage.failWrites = true
    expect(settlement.finish(result)).toEqual({ status: 'save-failed' })
    expect(live.profile.townEvent).toEqual({ id: 'conquest', state: 'hostile' })
    expect(store.load()!.townEvent?.state).toBe('hostile')
    expect(record.announced).toEqual([]); expect(record.restarts).toEqual([])

    storage.failWrites = false
    const retried = settlement.finish(result)
    expect(retried.status).toBe('saved')
    const next = store.load()!
    expect(next.townEvent?.state).toBe('settled'); expect(next.townEvent?.result).toBe(result)
    expect(next.faction).toBe(result === 'town_defeated' ? 'viking' : 'roman')
    expect(next.availableMerit).toBe(result === 'town_defeated' ? 180 : 80)
    expect(next.totalMerit).toBe(22000); expect(next.personalSquad).toEqual(original.personalSquad)
    expect(next.skills).toEqual(original.skills); expect(next.ownedWeapons).toEqual(original.ownedWeapons)
    expect(next.inventory).toEqual(original.inventory); expect(next.lifetimeStats).toEqual(original.lifetimeStats)
    expect(next.claimedBattleIds).toEqual(['historical-battle'])
    if (result === 'town_defeated') { expect(next.rank).toBe('recruit'); expect(enlistmentMerit(next)).toBe(0) }
    expect(record.announced).toEqual([{ id: 'conquest', result }])
    expect(record.saveAttempts).toBe(2) // the failed write, then exactly one successful write

    // A settled event is not settled again: no second write, no second penalty, no second relay.
    const savedBytes = storage.getItem(CAREER_STORAGE_KEY)
    expect(settlement.finish(result)).toEqual({ status: 'ignored' })
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(savedBytes)
    expect(record.announced).toHaveLength(1); expect(record.saveAttempts).toBe(2)

    expect(record.disposed).toBe(0)
    settlement.leave(result)
    expect(record.disposed).toBe(1)
    expect(record.restarts).toEqual([{ profile: live.profile, reason: result === 'player_defeated' ? 'death-return' : undefined }])
    expect(live.profile.townEvent?.result).toBe(result)
    }
  })
})
