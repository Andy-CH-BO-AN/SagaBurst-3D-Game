import { commanderRetirementEligibility, startCommanderRetirement, type CommanderRetirementStartFailure } from '../../src/career/CareerRetirement'
import { COMMANDER_FOUR_GATE_DEFENSE_ID } from '../../src/career/CommanderFourGateDefenseRoster'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import type { RaceRider } from '../../src/career/CareerRaceState'
import { describe,expect,it } from 'vitest'
import { availableRecruitMissions } from '../../src/career/CareerMissionCatalog'
import { claimCareerOutpost } from '../../src/career/CareerOutpostMission'
import {
careerMissionCompletionsForTier,
cloneCareerProfile,createCareerProfile,type CareerProfile
} from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { SOLDIER_TOWN_DEFENSE_TEMPLATE_ID,TOWN_DEFENSE_TEMPLATE_ID } from '../../src/career/TownDefenseState'

const stats = { damageDealt: 40, kills: 0, survived: false, damageTaken: 100, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }
const soldier = (): CareerProfile => ({ ...createCareerProfile('roman'), rank: 'soldier', totalMerit: 300, availableMerit: 300 })
const available = (profile: CareerProfile, templateId: string) => availableRecruitMissions(profile).some(template => template.id === templateId)

describe('Home mission prerequisites by mission tier', () => {

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

// One qualification predicate: each requirement must be necessary, not an alternative.
it('requires formal Commander appointment, ten Tier 5 wins and a recorded Four-Gate victory for retirement', () => {
  const profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'commander', totalMerit: 20000,
    careerMissionCompletionsByTier: { 1: 50, 4: 50, 5: 10 },
    completedCareerMissionTemplateIds: [COMMANDER_FOUR_GATE_DEFENSE_ID] }
  profile.lifetimeStats.victories = 100
  const qualified = { eligible: true, commanderVictories: 10, requiredVictories: 10, fourGateDefenseCompleted: true }
  expect(commanderRetirementEligibility(profile)).toEqual(qualified)
  expect(commanderRetirementEligibility({ ...profile, rank: 'captain' }).eligible).toBe(false)
  expect(commanderRetirementEligibility({ ...profile, careerMissionCompletionsByTier: { 5: 9 } }).eligible).toBe(false)
  expect(commanderRetirementEligibility({ ...profile, completedCareerMissionTemplateIds: [] }).eligible).toBe(false)
  expect(commanderRetirementEligibility({ ...profile, careerRetirement: {
    version: 1, phase: 'completed', acceptedAt: 0, combatElapsedSeconds: 42.5, outcome: 'fallen',
  } })).toEqual(qualified)
})

it('stages an isolated departing checkpoint only when every retirement start permission is present', () => {
  const profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'commander', totalMerit: 20000,
    availableMerit: 0, careerMissionCompletionsByTier: { 5: 10 },
    completedCareerMissionTemplateIds: [COMMANDER_FOUR_GATE_DEFENSE_ID] }
  const original = cloneCareerProfile(profile)
  const result = startCommanderRetirement(profile, 0)
  expect(result.started).toBe(true)
  expect(result.profile.careerRetirement).toEqual({ version: 1, phase: 'departing', acceptedAt: 0, combatElapsedSeconds: 0 })
  expect(result.profile).not.toBe(profile)
  expect(result.profile.ownedWeapons).not.toBe(profile.ownedWeapons)
  expect(profile).toEqual(original)

  // Each conjunct is necessary; this is one gate, not a matrix of mission/rank variants.
  const reject = (current: CareerProfile, reason: CommanderRetirementStartFailure, acceptedAt = 0) => {
    const rejected = startCommanderRetirement(current, acceptedAt)
    expect(rejected).toEqual({ started: false, profile: current, reason })
    expect(rejected.profile).toBe(current)
  }
  reject(result.profile, 'already-started')
  reject({ ...profile, careerMissionCompletionsByTier: { 5: 9 } }, 'not-eligible')
  reject({ ...profile, activeMission: createActiveCareerMission('recruit-bandits-01', 0, 1, 0, 'active') }, 'mission-active')
  reject({ ...profile, activeOutpostMission: { id: 'outpost', kind: 'outpost-defense', stageId: 1, acceptedAt: 0 } }, 'mission-active')
  const rider: RaceRider = { actorId: 'player', mountId: 'horse', position: { x: 0, y: 0, z: 0, yaw: 0 },
    mountPosition: { x: 0, y: 0, z: 0, yaw: 0 }, hp: 100, mountHp: 100, stamina: 100, mounted: true, dead: false, checkpoint: 0 }
  reject({ ...profile, activeRace: { version: 1, deployed: true, id: 'race', raceId: 'race-1', phase: 'countdown',
    countdownSeconds: 10, elapsedSeconds: 0, gameSeconds: 0, phaseSeconds: 0, waypoint: 0,
    player: rider, opponent: { ...rider, actorId: 'opponent' } } }, 'race-active')
  reject({ ...profile, townEvent: { id: 'hostile-town', state: 'hostile' } }, 'town-hostile')
  reject(profile, 'invalid-time', Number.POSITIVE_INFINITY)
  reject(profile, 'invalid-time', Number.NaN)
  reject(profile, 'invalid-time', -1)
  reject(profile, 'invalid-time', 0.5)
})
