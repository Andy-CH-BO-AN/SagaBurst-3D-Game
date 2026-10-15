import { describe,expect,it } from 'vitest'
import { availableRecruitMissions } from '../../src/career/CareerMissionCatalog'
import { acceptCareerOutpostRelief,claimCareerOutpost,clearCareerOutpost } from '../../src/career/CareerOutpostMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { acceptEnemyTownAssault,ENEMY_TOWN_ASSAULT_ID } from '../../src/career/EnemyTownAssault'
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

describe('Enemy Town Assault canonical Relief prerequisite', () => {
  it('preserves the unlock through save/load and subsequent Relief defeat', () => {
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(settleRelief('victory'))).toBe(true)
    const loaded = store.load()!
    expect(listed(loaded)).toBe(true)
    expect(acceptEnemyTownAssault(loaded, 'after-reload')).not.toBeNull()
    const retry = acceptCareerOutpostRelief(loaded, 'relief-retry')!
    expect(clearCareerOutpost(claimCareerOutpost(retry, 'relief-retry', 'defeat', stats).profile).completedOutpostRelief).toBe(true)
  })
  it('blocks direct acceptance during another outpost mission or town hostility', () => {
    const won = settleRelief('victory')
    expect(acceptEnemyTownAssault(acceptCareerOutpostRelief(won, 'retry')!, 'assault')).toBeNull()
    expect(acceptEnemyTownAssault({ ...won, townEvent: { id: 'hostile-town', state: 'hostile' } }, 'assault')).toBeNull()
  })
})
