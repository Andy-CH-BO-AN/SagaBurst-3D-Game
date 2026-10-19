import { commanderRetirementEligibility, startCommanderRetirement, validateOrdinaryRetirementCommit, type CommanderRetirementStartFailure } from '../../src/career/CareerRetirement'
import { advanceCommanderRetirementToMobilizing, commitCommanderRetirementToMobilizing, outsideRetirementTownCore } from '../../src/career/CareerRetirementMobilization'
import { TOWN_CITY } from '../../src/town/TownLayout'
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
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { emptyPersonalContribution } from '../../src/career/CareerPersonalSquadMission'
import { MemoryStorage } from '../helpers/memoryStorage'
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

it('stages only the first departing exit into mobilizing using the authored town boundary at every riding height', () => {
  const departing: CareerProfile = { ...createCareerProfile('roman'), rank: 'commander', totalMerit: 20000,
    townCommandSquad: { type: 'town-command', squadId: 1, townFaction: 'roman', sceneKey: 'town-home',
      actorIds: ['gate:north:0'], authorized: true, state: 'FOLLOWING', contribution: emptyPersonalContribution() },
    careerRetirement: { version: 1, phase: 'departing', acceptedAt: 123, combatElapsedSeconds: 0 } }
  const original = cloneCareerProfile(departing)
  const mobilizing = advanceCommanderRetirementToMobilizing(departing)!
  expect(mobilizing.careerRetirement).toEqual({ version: 1, phase: 'mobilizing', acceptedAt: 123, combatElapsedSeconds: 0 })
  expect(mobilizing).not.toBe(departing)
  expect(mobilizing.careerRetirement).not.toBe(departing.careerRetirement)
  expect(mobilizing.ownedWeapons).not.toBe(departing.ownedWeapons)
  expect(departing).toEqual(original)
  expect(validateOrdinaryRetirementCommit(departing, mobilizing)).toEqual({ allowed: false, reason: 'retirement-checkpoint-changed' })
  for (const phase of ['mobilizing', 'final-stand', 'completed'] as const) {
    const current: CareerProfile = { ...cloneCareerProfile(departing), careerRetirement: {
      ...departing.careerRetirement!, phase, ...(phase === 'completed' ? { outcome: 'fallen' as const } : {}),
    } }
    const unchanged = cloneCareerProfile(current)
    expect(advanceCommanderRetirementToMobilizing(current)).toBeNull()
    expect(current).toEqual(unchanged)
  }
  expect(advanceCommanderRetirementToMobilizing({ ...departing, careerRetirement: undefined })).toBeNull()
  expect(advanceCommanderRetirementToMobilizing({ ...departing, rank: 'captain' })).toBeNull()
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage), events: string[] = []
  expect(store.save(departing)).toBe(true)
  const originalBytes = storage.getItem(CAREER_STORAGE_KEY)
  let current = departing
  const save = (next: CareerProfile): boolean => {
    events.push('save')
    if (!store.save(next)) return false
    current = next
    return true
  }
  const reconcile = (): boolean => {
    events.push('reconcile')
    expect(store.loadChecked().profile?.careerRetirement?.phase).toBe('mobilizing')
    expect(current.townCommandSquad?.authorized).toBe(false)
    return true
  }
  storage.failWrites = true
  expect(commitCommanderRetirementToMobilizing(current, save, reconcile)).toBe(false)
  expect(events).toEqual(['save'])
  expect(current).toBe(departing)
  expect(departing).toEqual(original)
  expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(originalBytes)
  storage.failWrites = false
  events.length = 0
  expect(commitCommanderRetirementToMobilizing(current, save, reconcile)).toBe(true)
  expect(events).toEqual(['save', 'reconcile'])
  expect(departing).toEqual(original)
  events.length = 0
  expect(commitCommanderRetirementToMobilizing(current, save, reconcile)).toBe(false)
  expect(events).toEqual([])
  // Closed edges remain inside; altitude does not change the foot/horse/xongkoro boundary.
  for (const y of [0, 3, 80]) {
    const boundary = { x: TOWN_CITY.maxX, y, z: TOWN_CITY.minZ }
    expect(outsideRetirementTownCore(boundary)).toBe(false)
    expect(outsideRetirementTownCore({ ...boundary, x: TOWN_CITY.maxX + 0.01 })).toBe(true)
  }
  expect(outsideRetirementTownCore({ x: TOWN_CITY.minX, z: TOWN_CITY.maxZ })).toBe(false)
  expect(outsideRetirementTownCore({ x: TOWN_CITY.minX - 0.01, z: 0 })).toBe(true)
  expect(outsideRetirementTownCore({ x: 0, z: TOWN_CITY.minZ - 0.01 })).toBe(true)
  expect(outsideRetirementTownCore({ x: 0, z: TOWN_CITY.maxZ + 0.01 })).toBe(true)
  expect(outsideRetirementTownCore({ x: Number.NaN, z: 0 })).toBe(false)
  expect(outsideRetirementTownCore({ x: 0, z: Number.POSITIVE_INFINITY })).toBe(false)
})
