import { describe, expect, it } from 'vitest'
import { acceptCaptainEagle, acceptCaptainFrontline, createCaptainFrontlineLaunch, createCaptainFrontlineSpawnPlan } from '../../src/career/CaptainBattleLaunch'
import { CAPTAIN_EAGLE_BATTLE_ID, CAPTAIN_GATE_DEFENSE_ID, captainGateDefenseActorIds, commanderGateDefenseSlots, commanderGateDefenseSquads, createCaptainGateDefenseMission, getCaptainMissionAvailability, getCaptainMissionDefinition } from '../../src/career/CaptainMissionCatalog'
import { townDefenseForceCountsForProfile } from '../../src/career/TownDefenseRoster'
import { townCommanderSpec } from '../../src/town/TownCommanderIdentity'
import { VETERAN_TOWN_DEFENSE_TEMPLATE } from '../../src/career/CareerMissionCatalog'
import { officialActorSquadId, officialCommandSquads } from '../../src/career/CareerCommandAuthority'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { buildCommanderAuthorityForMission } from '../../src/career/CommanderMissionAcceptance'
import { acceptVeteranMission } from '../../src/career/VeteranMission'
import { townAssaultObjectiveRoster, townDefenseForceCounts, townRoster } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'

const captain = (): CareerProfile => ({ ...createCareerProfile('roman'), rank: 'captain', totalMerit: 5000, availableMerit: 5000, ownedMounts: ['horse', 'xongkoro'] })

describe('Captain mission eligibility and official roster policy without actor materialization', () => {
  it('requires actual Eagle ownership, independent of the selected mount', () => {
    const unowned = { ...captain(), ownedMounts: ['horse' as const], selectedMountId: 'xongkoro' as const }
    expect(getCaptainMissionAvailability(unowned, CAPTAIN_EAGLE_BATTLE_ID).unlocked).toBe(false)
    expect(acceptCaptainEagle(unowned)).toBeNull()
    const owned = { ...captain(), selectedMountId: 'horse' as const }
    expect(getCaptainMissionAvailability(owned, CAPTAIN_EAGLE_BATTLE_ID).unlocked).toBe(true)
    expect(acceptCaptainEagle(owned)!.selectedMountId).toBe('xongkoro')
  })
})

describe('Commander accepted production rosters without actor materialization', () => {
  const commander = (): CareerProfile => ({ ...captain(), rank: 'commander', totalMerit: 20000 })

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
    const highMeritCaptain = createCaptainGateDefenseMission({ ...commander(), rank: 'captain' }, accepted, [], residents)
    expect(highMeritCaptain.officialSquad!.actorIds).toEqual(captainGateDefenseActorIds(residents))
    expect(highMeritCaptain.officialSquad!.commandRank).toBeUndefined()
    const force = townDefenseForceCounts(residents)
    expect(force).toEqual({ friendlySoldiers: 213, friendlyCombatants: 214 })
    expect(force.friendlySoldiers).toBe(highMeritCaptain.friendlyActorIds.length)
    expect(VETERAN_TOWN_DEFENSE_TEMPLATE).toMatchObject(force)
    expect(getCaptainMissionDefinition(CAPTAIN_GATE_DEFENSE_ID)).toMatchObject(force)
    expect(highMeritCaptain.friendlyActorIds.filter(id => id.startsWith('watchtower-archer:'))).toHaveLength(5)
    expect(highMeritCaptain.officialSquad!.actorIds.some(id => id.startsWith('watchtower-archer:'))).toBe(false)
    const withCommander = [...residents, townCommanderSpec({ x: 0, z: 0, yaw: 0 })]
    const commandedDefense = createCaptainGateDefenseMission(commander(), accepted, [], withCommander)
    expect(townDefenseForceCountsForProfile(commander(), withCommander)).toEqual({ friendlySoldiers: 214, friendlyCombatants: 215 })
    expect(townDefenseForceCountsForProfile(commander(), withCommander).friendlySoldiers).toBe(commandedDefense.friendlyActorIds.length)
    expect(townDefenseForceCountsForProfile(commander(), withCommander, new Set(['commander']))).toEqual(force)
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

  it('uses Veteran authored squads with distinct pending reinforcement groups at fresh Commander acceptance', () => {
    const profile = acceptVeteranMission(commander(), 'veteran-dread-outpost', { missionId: 'grouped-veteran' })!
    const mission = profile.activeMission!, authority = buildCommanderAuthorityForMission(profile, mission)!
    expect(officialCommandSquads(authority).map(squad => [squad.squadId, squad.actorIds.length]))
      .toEqual([[1, 24], [2, 25], [3, 25], [4, 25], [5, 25], [6, 25]])
    expect(new Set(authority.actorIds)).toEqual(new Set([...mission.friendlyActorIds, ...mission.reinforcementActorIds!]))
    expect(officialActorSquadId(authority, mission.reinforcementActorIds![0])).toBe(5)
    expect(officialActorSquadId(authority, mission.reinforcementActorIds![1])).toBe(6)
    expect(mission.officialSquad).toBeUndefined()
    expect(buildCommanderAuthorityForMission({ ...profile, rank: 'captain' }, mission)).toBeUndefined()
    expect(buildCommanderAuthorityForMission(profile, { ...mission, kind: 'duel' })).toBeUndefined()
    expect(buildCommanderAuthorityForMission(profile, { ...mission, phase: 'RETURNING' })).toBeUndefined()
    expect(buildCommanderAuthorityForMission(profile, { ...mission, officialSquad: authority })).toBeUndefined()
  })
})
