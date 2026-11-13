import { describe, expect, it } from 'vitest'
import { availableRecruitMissions, getCareerMissionTemplate } from '../../src/career/CareerMissionCatalog'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { acceptCareerOutpostRelief, claimCareerOutpost, clearCareerOutpost } from '../../src/career/CareerOutpostMission'
import { claimCareerMission, clearCareerMission, createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { acceptEnemyTownAssault, createEnemyTownAssaultMission, ENEMY_TOWN_ASSAULT_ID } from '../../src/career/EnemyTownAssault'
import { VETERAN_TOWN_DEFENSE_TEMPLATE_ID } from '../../src/career/TownDefenseState'
import { MemoryStorage } from '../helpers/memoryStorage'

const stats = { player: { damageDealt: 200, damageTaken: 10, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }, squads: [] }
const missionStats = { damageDealt: 120, kills: 2, survived: true, damageTaken: 10, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }
function readyForRelief(faction: 'roman' | 'viking' = 'roman') {
  return { ...createCareerProfile(faction), rank: 'soldier' as const, totalMerit: 300, availableMerit: 300,
    completedOutpostStages: [1, 2, 3] as (1 | 2 | 3)[], ownedMounts: ['horse' as const], ownedHorseTiers: [1] as (1 | 2 | 3)[], selectedMountId: 'horse-t1' as const }
}
function settleRelief(outcome: 'victory' | 'defeat', faction: 'roman' | 'viking' = 'roman') {
  const active = acceptCareerOutpostRelief(readyForRelief(faction), 'relief')!
  expect(active).not.toBeNull()
  return clearCareerOutpost(claimCareerOutpost(active, 'relief', outcome, stats).profile)
}
function listed(profile: ReturnType<typeof createCareerProfile>) {
  return availableRecruitMissions(profile).some(template => template.id === ENEMY_TOWN_ASSAULT_ID)
}

describe('Enemy Town Assault retired mission policy', () => {
  it('retires Enemy Town Assault from active catalogs and permanently rejects new acceptance', () => {
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(settleRelief('victory'))).toBe(true)
    const loaded = store.load()!
    expect(listed(loaded)).toBe(false)
    expect(acceptEnemyTownAssault(loaded, 'after-reload')).toBeNull()
    const retry = acceptCareerOutpostRelief(loaded, 'relief-retry')!
    expect(clearCareerOutpost(claimCareerOutpost(retry, 'relief-retry', 'defeat', stats).profile).completedOutpostRelief).toBe(true)
  })
  it('allows historical active missions to be parsed, settled once, and cleared safely via retired lookup', () => {
    const rawAssault = {
      ...settleRelief('victory'),
      activeMission: createEnemyTownAssaultMission('legacy-active-assault'),
    }
    const parsedAssault = parseCareerProfile(rawAssault)!
    expect(parsedAssault.activeMission).toBeDefined()
    expect(parsedAssault.activeMission!.templateId).toBe(ENEMY_TOWN_ASSAULT_ID)
    expect(getCareerMissionTemplate(ENEMY_TOWN_ASSAULT_ID)).not.toBeNull()

    const friendlyActorIds = ['legacy-defense:friendly:0', 'legacy-defense:friendly:1']
    const civilianActorIds = ['legacy-defense:civilian:0']
    const rawDefense = {
      ...createCareerProfile('roman'),
      rank: 'veteran' as const,
      totalMerit: 900,
      activeMission: createTownDefenseMission(friendlyActorIds, civilianActorIds, 'legacy-defense', VETERAN_TOWN_DEFENSE_TEMPLATE_ID, 'veteran'),
    }
    const stableTargets = [...rawDefense.activeMission.targetActorIds]
    const promotedDefense = { ...rawDefense, rank: 'commander' as const, totalMerit: 2000 }
    const restoredDefense = parseCareerProfile(JSON.parse(JSON.stringify(promotedDefense)))!
    expect(restoredDefense.activeMission!.targetActorIds).toEqual(stableTargets)
    expect(restoredDefense.activeMission!.templateId).toBe(VETERAN_TOWN_DEFENSE_TEMPLATE_ID)
    expect(getCareerMissionTemplate(VETERAN_TOWN_DEFENSE_TEMPLATE_ID)).not.toBeNull()

    const settled = claimCareerMission(restoredDefense, restoredDefense.activeMission!.id, 'victory', missionStats)
    expect(settled.alreadyClaimed).toBe(false)
    expect(settled.meritAwarded).toBeGreaterThan(0)
    const duplicate = claimCareerMission(settled.profile, restoredDefense.activeMission!.id, 'victory', missionStats)
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.meritAwarded).toBe(0)
    expect(clearCareerMission(duplicate.profile, restoredDefense.activeMission!.id).activeMission).toBeUndefined()
  })
})
