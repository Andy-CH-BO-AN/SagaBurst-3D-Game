import { describe, expect, it } from 'vitest'
import { availableCareerMissionsForPage, availableRecruitMissions } from '../../src/career/CareerMissionCatalog'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { careerMissionCompletionsForTier, claimCareerMission, clearCareerMission, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { SOLDIER_TOWN_DEFENSE_TEMPLATE_ID, TOWN_DEFENSE_TEMPLATE_ID, VETERAN_TOWN_DEFENSE_TEMPLATE_ID, townDefenseEnemyCount } from '../../src/career/TownDefenseState'

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

  it('keeps the accepted 61-enemy Veteran roster stable across reload and promotion', () => {
    expect(townDefenseEnemyCount(TOWN_DEFENSE_TEMPLATE_ID, 'veteran')).toBe(120)
    expect(townDefenseEnemyCount(SOLDIER_TOWN_DEFENSE_TEMPLATE_ID, 'soldier')).toBe(120)
    expect(townDefenseEnemyCount(VETERAN_TOWN_DEFENSE_TEMPLATE_ID, 'veteran')).toBe(120)
    expect(townDefenseEnemyCount(VETERAN_TOWN_DEFENSE_TEMPLATE_ID, 'captain')).toBe(120)
    expect(townDefenseEnemyCount(VETERAN_TOWN_DEFENSE_TEMPLATE_ID, 'commander')).toBe(120)

    const accepted = acceptedHomeDefense(veteranProfile(5))
    const stableTargets = [...accepted.activeMission!.targetActorIds]
    expect(accepted.activeMission).toMatchObject({ kind: 'town-defense', targetCampId: -1, friendlyActorIds: expect.arrayContaining(['home-defense-acceptance:friendly:0']) })
    expect(accepted.activeMission!.targetActorIds).toHaveLength(120)
    expect(accepted.activeMission!.friendlyActorIds).toHaveLength(63)
    expect(accepted.activeMission!.civilianActorIds).toHaveLength(20)
    const promoted = { ...accepted, rank: 'commander' as const, totalMerit: 2000 }
    const restored = parseCareerProfile(JSON.parse(JSON.stringify(promoted)))!
    expect(restored.activeMission!.targetActorIds).toEqual(stableTargets)
    expect(restored.activeMission!.targetActorIds).toHaveLength(120)
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
