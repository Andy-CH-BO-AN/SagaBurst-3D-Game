import { describe,expect,it } from 'vitest'
import { availableRecruitMissions, getCareerMissionTemplate } from '../../src/career/CareerMissionCatalog'
import { acceptCareerOutpostRelief,claimCareerOutpost,clearCareerOutpost } from '../../src/career/CareerOutpostMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { acceptEnemyTownAssault, createEnemyTownAssaultMission, ENEMY_TOWN_ASSAULT_ID } from '../../src/career/EnemyTownAssault'
import { MemoryStorage } from '../helpers/memoryStorage'

const stats = { player: { damageDealt: 200, damageTaken: 10, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }, squads: [] }
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
  it('allows historical active missions to be parsed and recognized via retired lookup', () => {
    const raw = {
      ...settleRelief('victory'),
      activeMission: createEnemyTownAssaultMission('legacy-active-assault'),
    }
    const parsed = parseCareerProfile(raw)!
    expect(parsed.activeMission).toBeDefined()
    expect(parsed.activeMission!.templateId).toBe(ENEMY_TOWN_ASSAULT_ID)
    expect(getCareerMissionTemplate(ENEMY_TOWN_ASSAULT_ID)).not.toBeNull()
  })
})
