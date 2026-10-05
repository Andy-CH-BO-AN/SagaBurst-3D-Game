import { describe, expect, it } from 'vitest'
import { careerMissionTemplatesForPage, getCareerMissionTemplate, availableRecruitMissions } from '../src/career/CareerMissionCatalog'
import { townDefenseEnemyCount, VETERAN_TOWN_DEFENSE_TEMPLATE_ID } from '../src/career/TownDefenseState'
import { createCareerProfile } from '../src/career/CareerProfile'
import { createTownDefenseMission } from '../src/career/CareerMissionState'
import { parseCareerProfile } from '../src/career/CareerProfileStore'

describe('Four-gate town war catalog', () => {
  it('has only Soldier Assault and Veteran Defense', () => {
    expect(careerMissionTemplatesForPage({ ...createCareerProfile('roman'), rank: 'veteran', totalMerit: 1000, completedOutpostRelief: true }, 'recruit').some(m => m.kind === 'town-defense')).toBe(false)
    expect(careerMissionTemplatesForPage({ ...createCareerProfile('roman'), rank: 'veteran', totalMerit: 1000, completedOutpostRelief: true }, 'soldier').filter(m => m.kind === 'town-defense' || m.kind === 'enemy-town-assault').map(m => m.id)).toEqual(['career-enemy-town-assault'])
    expect(careerMissionTemplatesForPage({ ...createCareerProfile('roman'), rank: 'veteran', totalMerit: 1000, completedOutpostRelief: true }, 'veteran').filter(m => m.kind === 'town-defense').map(m => m.id)).toEqual([VETERAN_TOWN_DEFENSE_TEMPLATE_ID])
    expect(getCareerMissionTemplate('recruit-town-defense-01')).toBeNull()
    expect(getCareerMissionTemplate('soldier-town-defense-01')).toBeNull()
  })
  it.each(['veteran', 'captain', 'commander'] as const)('keeps %s defense fixed at 120', rank => {
    expect(townDefenseEnemyCount(VETERAN_TOWN_DEFENSE_TEMPLATE_ID, rank)).toBe(120)
    expect(createTownDefenseMission(['captain'], [], undefined, VETERAN_TOWN_DEFENSE_TEMPLATE_ID, rank).targetActorIds).toHaveLength(120)
  })
  it('preserves Assault Outpost Relief requirement', () => {
    const p = { ...createCareerProfile('roman'), rank: 'soldier' as const, totalMerit: 300 }
    expect(availableRecruitMissions(p).some(m => m.id === 'career-enemy-town-assault')).toBe(false)
    expect(availableRecruitMissions({ ...p, completedOutpostRelief: true }).some(m => m.id === 'career-enemy-town-assault')).toBe(true)
  })
  it.each(['recruit-town-defense-01', 'soldier-town-defense-01', 'veteran-town-defense-01', 'career-enemy-town-assault'])('cancels legacy %s without changing earned career progress', templateId => {
    const p = createCareerProfile('roman'); p.totalMerit = 500
    const mission = createTownDefenseMission(['captain'], [], 'old', templateId)
    delete mission.siege
    const loaded = parseCareerProfile({ ...p, activeMission: mission })!
    expect(loaded.activeMission).toBeUndefined(); expect(loaded.totalMerit).toBe(500)
  })
})
