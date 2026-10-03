import { describe, expect, it } from 'vitest'
import { careerMissionTemplatesForPage, availableCareerMissionsForPage, availableRecruitMissions, getCareerMissionTemplate } from '../src/career/CareerMissionCatalog'
import { createTownDefenseMission } from '../src/career/CareerMissionState'
import { careerMissionCompletionsForTier, claimCareerMission, clearCareerMission, createCareerProfile, type CareerProfile } from '../src/career/CareerProfile'
import { parseCareerProfile } from '../src/career/CareerProfileStore'
import { careerMissionTierForTemplateId } from '../src/career/CareerMissionTier'
import { SOLDIER_TOWN_DEFENSE_TEMPLATE_ID, TOWN_DEFENSE_TEMPLATE_ID, TOWN_DEFENSE_CIVILIAN_LIMIT, VETERAN_TOWN_DEFENSE_TEMPLATE_ID, townDefenseEnemyCount } from '../src/career/TownDefenseState'
import { VETERAN_MISSION_CATALOG } from '../src/career/VeteranMission'

const stats = { damageDealt: 120, kills: 2, survived: true, damageTaken: 10, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }

function veteranProfile(veteranWins = 0): CareerProfile {
  return {
    ...createCareerProfile('roman'), rank: 'veteran', totalMerit: 900, availableMerit: 900,
    careerMissionCompletionsByTier: { 1: 50, 2: 50, 3: veteranWins },
  }
}

function acceptedHomeDefense(profile: CareerProfile, id = 'home-defense-acceptance'): CareerProfile {
  const friendlyActorIds = Array.from({ length: 63 }, (_, index) => `${id}:friendly:${index}`)
  const civilianActorIds = Array.from({ length: 20 }, (_, index) => `${id}:civilian:${index}`)
  return { ...profile, activeMission: createTownDefenseMission(friendlyActorIds, civilianActorIds, id, VETERAN_TOWN_DEFENSE_TEMPLATE_ID, profile.rank) }
}

describe('Veteran Home Defense career mission', () => {
  it('shows the pre-unlock template on Veteran page and requires five same-tier victories', () => {
    const fourWins = veteranProfile(4)
    const page = careerMissionTemplatesForPage(fourWins, 'veteran')
    expect(page.map(template => template.id)).toEqual([...VETERAN_MISSION_CATALOG.map(template => template.id), VETERAN_TOWN_DEFENSE_TEMPLATE_ID])
    const template = getCareerMissionTemplate(VETERAN_TOWN_DEFENSE_TEMPLATE_ID)
    expect(template).toMatchObject({
      id: VETERAN_TOWN_DEFENSE_TEMPLATE_ID, kind: 'town-defense', name: '守衛家園 · 老兵守城',
      minRank: 'veteran', requiresCompletions: 5, storyOnce: false,
      friendlySoldiers: 60, friendlyCombatants: 64, civilianCount: 20, maxCivilianDeaths: TOWN_DEFENSE_CIVILIAN_LIMIT,
    })
    expect(careerMissionTierForTemplateId(VETERAN_TOWN_DEFENSE_TEMPLATE_ID)).toBe(3)
    expect(availableCareerMissionsForPage(fourWins, 'veteran').some(mission => mission.id === VETERAN_TOWN_DEFENSE_TEMPLATE_ID)).toBe(false)

    const fiveWins = veteranProfile(5)
    expect(availableCareerMissionsForPage(fiveWins, 'veteran').some(mission => mission.id === VETERAN_TOWN_DEFENSE_TEMPLATE_ID)).toBe(true)
    expect(availableRecruitMissions(fiveWins).some(mission => mission.id === VETERAN_TOWN_DEFENSE_TEMPLATE_ID)).toBe(true)
    const underRank = { ...fiveWins, rank: 'soldier' as const }
    expect(careerMissionTemplatesForPage(underRank, 'veteran')).toEqual([])
    expect(availableCareerMissionsForPage(underRank, 'veteran')).toEqual([])
  })

  it('keeps the accepted 61-enemy Veteran roster stable across reload and promotion', () => {
    expect(townDefenseEnemyCount(TOWN_DEFENSE_TEMPLATE_ID, 'veteran')).toBe(50)
    expect(townDefenseEnemyCount(SOLDIER_TOWN_DEFENSE_TEMPLATE_ID, 'soldier')).toBe(55)
    expect(townDefenseEnemyCount(VETERAN_TOWN_DEFENSE_TEMPLATE_ID, 'veteran')).toBe(61)
    expect(townDefenseEnemyCount(VETERAN_TOWN_DEFENSE_TEMPLATE_ID, 'captain')).toBe(67)
    expect(townDefenseEnemyCount(VETERAN_TOWN_DEFENSE_TEMPLATE_ID, 'commander')).toBe(73)

    const accepted = acceptedHomeDefense(veteranProfile(5))
    const stableTargets = [...accepted.activeMission!.targetActorIds]
    expect(accepted.activeMission).toMatchObject({ kind: 'town-defense', targetCampId: -1, friendlyActorIds: expect.arrayContaining(['home-defense-acceptance:friendly:0']) })
    expect(accepted.activeMission!.targetActorIds).toHaveLength(61)
    expect(accepted.activeMission!.friendlyActorIds).toHaveLength(63)
    expect(accepted.activeMission!.civilianActorIds).toHaveLength(20)
    const promoted = { ...accepted, rank: 'commander' as const, totalMerit: 2000 }
    const restored = parseCareerProfile(JSON.parse(JSON.stringify(promoted)))!
    expect(restored.activeMission!.targetActorIds).toEqual(stableTargets)
    expect(restored.activeMission!.targetActorIds).toHaveLength(61)
    expect(restored.activeMission!.templateId).toBe(VETERAN_TOWN_DEFENSE_TEMPLATE_ID)
  })

  it('counts only Tier 3 victories, leaves failure locked, and allows replay after a saved victory', () => {
    const profile = veteranProfile(4)
    const failed = acceptedHomeDefense(profile, 'home-defense-failed')
    const failureClaim = claimCareerMission(failed, failed.activeMission!.id, 'failure', stats)
    expect(failureClaim.profile.careerMissionCompletionsByTier).toEqual({ 1: 50, 2: 50, 3: 4 })
    expect(failureClaim.profile.completedCareerMissionTemplateIds ?? []).not.toContain(VETERAN_TOWN_DEFENSE_TEMPLATE_ID)
    expect(availableCareerMissionsForPage(clearCareerMission(failureClaim.profile, failed.activeMission!.id), 'veteran')
      .some(mission => mission.id === VETERAN_TOWN_DEFENSE_TEMPLATE_ID)).toBe(false)

    const active = acceptedHomeDefense(profile, 'home-defense-victory')
    const victoryClaim = claimCareerMission(active, active.activeMission!.id, 'victory', stats)
    expect(victoryClaim.profile.careerMissionCompletionsByTier).toEqual({ 1: 50, 2: 50, 3: 5 })
    expect(victoryClaim.profile.completedCareerMissionTemplateIds).toContain(VETERAN_TOWN_DEFENSE_TEMPLATE_ID)
    expect(careerMissionCompletionsForTier(victoryClaim.profile, 3)).toBe(5)
    const restored = parseCareerProfile(JSON.parse(JSON.stringify(victoryClaim.profile)))!
    const duplicate = claimCareerMission(restored, restored.activeMission!.id, 'victory', stats)
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.profile.careerMissionCompletionsByTier).toEqual({ 1: 50, 2: 50, 3: 5 })
    const ready = clearCareerMission(duplicate.profile, restored.activeMission!.id)
    expect(ready.completedCareerMissionTemplateIds).toContain(VETERAN_TOWN_DEFENSE_TEMPLATE_ID)
    expect(availableCareerMissionsForPage(ready, 'veteran')
      .some(mission => mission.id === VETERAN_TOWN_DEFENSE_TEMPLATE_ID)).toBe(true)
    expect(availableRecruitMissions(ready).some(mission => mission.id === VETERAN_TOWN_DEFENSE_TEMPLATE_ID)).toBe(true)

    const replay = acceptedHomeDefense(ready, 'home-defense-replay')
    expect(availableCareerMissionsForPage(replay, 'veteran')
      .some(mission => mission.id === VETERAN_TOWN_DEFENSE_TEMPLATE_ID)).toBe(false)
    const replayClaim = claimCareerMission(replay, replay.activeMission!.id, 'victory', stats)
    expect(replayClaim.alreadyClaimed).toBe(false)
    expect(replayClaim.meritAwarded).toBeGreaterThan(0)
    expect(careerMissionCompletionsForTier(replayClaim.profile, 3)).toBe(6)
    expect(replayClaim.profile.completedCareerMissionTemplateIds!.filter(id => id === VETERAN_TOWN_DEFENSE_TEMPLATE_ID)).toHaveLength(1)
    expect(claimCareerMission(replayClaim.profile, replay.activeMission!.id, 'victory', stats).alreadyClaimed).toBe(true)
  })
})
