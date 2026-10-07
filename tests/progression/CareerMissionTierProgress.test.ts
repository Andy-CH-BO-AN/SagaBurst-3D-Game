import { describe, expect, it } from 'vitest'
import { availableRecruitMissions, getRecruitMissionTemplate } from '../../src/career/CareerMissionCatalog'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import {
  careerMissionCompletionsForTier, claimCareerMission, clearCareerMission,
  cloneCareerProfile, createCareerProfile, type CareerProfile,
} from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { claimCareerOutpost, clearCareerOutpost } from '../../src/career/CareerOutpostMission'
import { TOWN_DEFENSE_TEMPLATE_ID, SOLDIER_TOWN_DEFENSE_TEMPLATE_ID } from '../../src/career/TownDefenseState'

const stats = { damageDealt: 40, kills: 0, survived: false, damageTaken: 100, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }
const soldier = (): CareerProfile => ({ ...createCareerProfile('roman'), rank: 'soldier', totalMerit: 300, availableMerit: 300 })
const available = (profile: CareerProfile, templateId: string) => availableRecruitMissions(profile).some(template => template.id === templateId)

function activeMission(profile: CareerProfile, templateId: string, id: string): CareerProfile {
  const active = createActiveCareerMission(templateId, 0, 1, 0, id)
  active.kind = getRecruitMissionTemplate(templateId)!.kind
  return { ...profile, activeMission: active }
}

describe('Home mission prerequisites by mission tier', () => {
  it('does not unlock removed Town Defense missions at either tier', () => {
    const p = soldier(); p.careerMissionCompletionsByTier = { 1: 99, 2: 99, 3: 99 }
    expect(available(p, TOWN_DEFENSE_TEMPLATE_ID)).toBe(false)
    expect(available(p, SOLDIER_TOWN_DEFENSE_TEMPLATE_ID)).toBe(false)
  })

  it('counts repeated Recruit missions as T1 even after promotion, and rejects failures and duplicate claims', () => {
    let profile = soldier()
    for (let index = 0; index < 5; index++) {
      const id = `recruit-repeat-${index}`
      const current = activeMission(profile, 'recruit-bandits-01', id)
      const claim = claimCareerMission(current, id, 'victory', stats)
      const duplicate = claimCareerMission(claim.profile, id, 'victory', stats)
      expect(duplicate.alreadyClaimed).toBe(true)
      expect(duplicate.profile.careerMissionCompletionsByTier).toEqual({ 1: index + 1, 2: 0, 3: 0 })
      profile = clearCareerMission(duplicate.profile, id)
    }
    expect(available(profile, TOWN_DEFENSE_TEMPLATE_ID)).toBe(false)
    expect(available(profile, SOLDIER_TOWN_DEFENSE_TEMPLATE_ID)).toBe(false)
    profile = activeMission(profile, 'recruit-bandits-01', 'failed-recruit')
    expect(claimCareerMission(profile, 'failed-recruit', 'failure', stats).profile.careerMissionCompletionsByTier).toEqual({ 1: 5, 2: 0, 3: 0 })
  })

  it('counts Enemy Town Assault with the Soldier board despite its legacy Recruit minimum rank', () => {
    const current = activeMission(soldier(), 'career-enemy-town-assault', 'assault-tier')
    expect(getRecruitMissionTemplate('career-enemy-town-assault')?.minRank).toBe('soldier')
    const claim = claimCareerMission(current, 'assault-tier', 'victory', stats)
    expect(claim.profile.careerMissionCompletionsByTier).toEqual({ 1: 0, 2: 1, 3: 0 })
  })

  it('counts Outpost defense and relief victories toward T2, including a dead player, but counts each result only once', () => {
    let profile = soldier()
    for (let index = 0; index < 5; index++) {
      const id = `outpost-tier-${index}`
      profile.activeOutpostMission = { id, kind: index === 4 ? 'outpost-relief' : 'outpost-defense', stageId: index === 4 ? 3 : 1, acceptedAt: 0 }
      const claim = claimCareerOutpost(profile, id, 'victory', { player: stats, squads: [] })
      const loaded = parseCareerProfile(JSON.parse(JSON.stringify(claim.profile)))!
      const duplicate = claimCareerOutpost(loaded, id, 'victory', { player: stats, squads: [] })
      expect(duplicate.alreadyClaimed).toBe(true)
      expect(duplicate.profile.careerMissionCompletionsByTier).toEqual({ 1: 0, 2: index + 1, 3: 0 })
      profile = clearCareerOutpost(duplicate.profile)
      expect(available(profile, SOLDIER_TOWN_DEFENSE_TEMPLATE_ID)).toBe(false)
    }
    profile.activeOutpostMission = { id: 'outpost-failed', kind: 'outpost-defense', stageId: 1, acceptedAt: 0 }
    expect(claimCareerOutpost(profile, 'outpost-failed', 'defeat', { player: stats, squads: [] }).profile.careerMissionCompletionsByTier).toEqual({ 1: 0, 2: 5, 3: 0 })
    expect(profile.careerMissionCompletions).toBe(5)
  })

  it('round-trips independent counters, sanitizes malformed values, and clones without sharing them', () => {
    const profile = soldier()
    profile.careerMissionCompletionsByTier = { 1: 7, 2: 4, 3: 0 }
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    const copy = cloneCareerProfile(loaded)
    copy.careerMissionCompletionsByTier![2] = 5
    expect(loaded.careerMissionCompletionsByTier).toEqual({ 1: 7, 2: 4, 3: 0 })
    expect(parseCareerProfile({ ...profile, careerMissionCompletionsByTier: { 1: -1, 2: 5.9, 3: 100 } })?.careerMissionCompletionsByTier).toEqual({ 1: 0, 2: 5, 3: 100 })
  })

  it('preserves legacy Recruit progress and reconstructs only proven Soldier victories', () => {
    const profile = soldier()
    profile.careerMissionCompletions = 5
    expect(available(profile, TOWN_DEFENSE_TEMPLATE_ID)).toBe(false)
    expect(available(profile, SOLDIER_TOWN_DEFENSE_TEMPLATE_ID)).toBe(false)
    const current = { ...profile, activeOutpostMission: { id: 'legacy-outpost', kind: 'outpost-defense' as const, stageId: 1 as const, acceptedAt: 0 } }
    const claim = claimCareerOutpost(current, 'legacy-outpost', 'victory', { player: stats, squads: [] })
    expect(claim.profile.careerMissionCompletionsByTier).toEqual({ 1: 5, 2: 1, 3: 0 })
    const legacy = { ...claim.profile, careerMissionCompletionsByTier: undefined }
    expect(careerMissionCompletionsForTier(legacy, 1)).toBe(5)
    expect(careerMissionCompletionsForTier(legacy, 2)).toBe(1)
  })
})
