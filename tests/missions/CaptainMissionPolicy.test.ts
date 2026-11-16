import { careerRankFixture } from '../helpers/careerRankFixture'
import { describe, expect, it } from 'vitest'
import { acceptCaptainEagle, acceptCaptainFrontline, createCaptainEagleSpawnPlan, createCaptainFrontlineLaunch, createCaptainFrontlineSpawnPlan } from '../../src/career/CaptainBattleLaunch'
import { isEagleLandingClear } from '../../src/world/EagleLanding'
import { hasAerialCombatPower, resolveCaptainEagleBattleOutcome } from '../../src/career/CaptainEagleBattleOutcome'
import { CAPTAIN_EAGLE_BATTLE_ID, commanderGateDefenseSlots, commanderGateDefenseSquads, getCaptainMissionAvailability, getCaptainMissionDefinition } from '../../src/career/CaptainMissionCatalog'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { townAssaultObjectiveRoster, townRoster } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'

const captain = (): CareerProfile => ({ ...createCareerProfile('roman'), ...careerRankFixture('roman', 'captain'), rank: 'captain', totalMerit: 5000, availableMerit: 5000, inventory: { version: 1 as const, quantities: Object.fromEntries(['horse', 'xongkoro'].map(id => [id, 1])) }, ownedMounts: ['horse', 'xongkoro'] })

describe('Captain mission eligibility and official roster policy without actor materialization', () => {
  it('requires actual Eagle ownership, independent of the selected mount', () => {
    const unowned = { ...captain(), inventory: { version: 1 as const, quantities: Object.fromEntries(['horse' as const].map(id => [id, 1])) }, ownedMounts: ['horse' as const], selectedMountId: 'xongkoro' as const }
    expect(getCaptainMissionAvailability(unowned, CAPTAIN_EAGLE_BATTLE_ID).unlocked).toBe(false)
    expect(acceptCaptainEagle(unowned)).toBeNull()
    const owned = { ...captain(), selectedMountId: 'horse' as const }
    expect(getCaptainMissionAvailability(owned, CAPTAIN_EAGLE_BATTLE_ID).unlocked).toBe(true)
    expect(acceptCaptainEagle(owned)!.selectedMountId).toBe('xongkoro')
  })

  it('parks every Eagle battle wing where a grounded eagle is allowed to take off', () => {
    const plan = createCaptainEagleSpawnPlan(acceptCaptainEagle({ ...captain(), selectedMountId: 'horse' as const }, 'eagle-takeoff')!)
    expect(plan.npcSpecs).toHaveLength(59)
    for (const [index, spec] of plan.npcSpecs.entries()) {
      // EagleFlightController only leaves the ground where the landing footprint is clear and level.
      expect(isEagleLandingClear({ x: spec.x, z: spec.z, yaw: spec.z < 0 ? 0 : Math.PI }, [])).toBe(true)
      for (const other of plan.npcSpecs.slice(index + 1)) expect(Math.hypot(other.x - spec.x, other.z - spec.z)).toBeGreaterThanOrEqual(16)
    }
  })

  it('已淘汰的隊長守城任務不列入現役目錄且指揮官也不可接取', () => {
    expect(getCaptainMissionDefinition('captain-gate-defense')).toBeNull()
    const commander: CareerProfile = { ...captain(), ...careerRankFixture((captain()).faction, 'commander'), rank: 'commander', totalMerit: 20000 }
    expect(getCaptainMissionAvailability(commander, 'captain-gate-defense').unlocked).toBe(false)
  })
})

describe('Commander accepted production rosters without actor materialization', () => {
  const commander = (): CareerProfile => ({ ...captain(), ...careerRankFixture((captain()).faction, 'commander'), rank: 'commander', totalMerit: 20000 })

  it('excludes unavailable or unaccepted military without moving the remaining defenders between squads', () => {
    const residents = townRoster(), accepted = townAssaultObjectiveRoster(residents).map(actor => actor.id)
    // Canonical membership needs authored metadata only; adding real garrison/home
    // positions must preserve every official squad's complete ID order.
    expect(commanderGateDefenseSlots()).toEqual(commanderGateDefenseSlots(residents))
    const full = commanderGateDefenseSquads(residents, accepted)
    const unavailable = new Set(['captain', 'town-patrol:a:captain', 'town-eagle-rider:2'])
    const reduced = commanderGateDefenseSquads(residents, accepted.filter(id => id !== 'gate:south:0'), unavailable)
    expect(reduced.flatMap(squad => squad.actorIds)).toHaveLength(200)
    expect(reduced).toEqual(full.map(squad => ({ ...squad,
      actorIds: squad.actorIds.filter(id => !unavailable.has(id) && id !== 'gate:south:0'),
    })))
  })

  it('replays Frontline saved membership instead of regrouping actors after reload', () => {
    const profile = acceptCaptainFrontline(commander(), 'frontline-save')!, authority = profile.activeMission!.officialSquad!
    const first = authority.squads![0].actorIds[0], last = authority.squads![2].actorIds[0]
    authority.squads![0].actorIds[0] = last
    authority.squads![2].actorIds[0] = first
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!, saved = loaded.activeMission!.officialSquad!
    expect(saved.squads).toEqual(authority.squads)
    const specs = createCaptainFrontlineSpawnPlan(createCaptainFrontlineLaunch(loaded), saved).npcSpecs
    expect(specs.find(spec => spec.actorId === first)!.squadId).toBe(3)
    expect(specs.find(spec => spec.actorId === last)!.squadId).toBe(1)
  })

  it('decides Eagle Battle by aerial combat power only, ignoring ground and grounded riders', () => {
    const eagle = { isFlyingMount: true, dead: false }
    expect(hasAerialCombatPower({ dead: false, mount: eagle })).toBe(true)
    expect(hasAerialCombatPower({ dead: false, mount: null })).toBe(false)
    expect(hasAerialCombatPower({ dead: false, mount: { ...eagle, dead: true } })).toBe(false)
    expect(resolveCaptainEagleBattleOutcome(0, 3)).toBe('victory')
    expect(resolveCaptainEagleBattleOutcome(4, 0)).toBe('failure')
    expect(resolveCaptainEagleBattleOutcome(4, 3)).toBeNull()
  })
})
