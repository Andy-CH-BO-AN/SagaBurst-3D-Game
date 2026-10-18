import { describe, expect, it } from 'vitest'
import { acceptCaptainEagle, acceptCaptainFrontline, createCaptainFrontlineLaunch, createCaptainFrontlineSpawnPlan } from '../../src/career/CaptainBattleLaunch'
import { CAPTAIN_EAGLE_BATTLE_ID, captainGateDefenseActorIds, commanderGateDefenseSlots, commanderGateDefenseSquads, createCaptainGateDefenseMission, getCaptainMissionAvailability } from '../../src/career/CaptainMissionCatalog'
import { officialActorSquadId, officialCommandSquads } from '../../src/career/CareerCommandAuthority'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { buildCommanderAuthorityForMission } from '../../src/career/CommanderMissionAcceptance'
import { acceptVeteranMission } from '../../src/career/VeteranMission'
import { townAssaultObjectiveRoster, townRoster } from '../../src/town/TownRules'
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
    expect(reduced.flatMap(squad => squad.actorIds)).toHaveLength(204)
    expect(reduced).toEqual(full.map(squad => ({ ...squad,
      actorIds: squad.actorIds.filter(id => !unavailable.has(id) && id !== 'gate:south:0'),
    })))
    const highMeritCaptain = createCaptainGateDefenseMission({ ...commander(), rank: 'captain' }, accepted, [], residents)
    expect(highMeritCaptain.officialSquad!.actorIds).toEqual(captainGateDefenseActorIds(residents))
    expect(highMeritCaptain.officialSquad!.commandRank).toBeUndefined()
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
