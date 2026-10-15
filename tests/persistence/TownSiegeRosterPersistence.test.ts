import { describe,expect,it } from 'vitest'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { migrateTownRampartPosition } from '../../src/town/TownLayoutMigration'
import { townRoster } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'

describe('siege checkpoint ownership', () => {
  it('retains casualties, elevated coordinates and garrison ownership through storage', () => {
    const profile = createCareerProfile('roman'), id = 'gate:north:7'
    profile.activeMission = createTownDefenseMission([id], [], 'rampart-save')
    const active = profile.activeMission
    active.actorPositions = { [id]: { x: 15, y: 9.25, z: -112.6, yaw: Math.PI, townRampartGarrison: true } }
    active.actorHealth = { [id]: { hp: 0, mountHp: 0 } }
    active.deadFriendlyActorIds = [id]
    active.siege!.playerPosition = { x: 30, y: 9.25, z: -110.6, yaw: 1 }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!.activeMission!
    expect(loaded.actorPositions).toEqual(active.actorPositions)
    expect(loaded.actorHealth).toEqual(active.actorHealth)
    expect(loaded.deadFriendlyActorIds).toEqual([id])
    expect(loaded.siege!.playerPosition).toEqual(active.siege!.playerPosition)
  })

  it('preserves a commanded position when migrating a legacy rampart station', () => {
    const spec = townRoster().find(actor => actor.id === 'gate:north:7')!
    const saved = { x: 25, z: 30, yaw: .4 }
    expect(migrateTownRampartPosition(saved, spec, true, false, true)).toEqual(saved)
  })

  it('round-trips an official formation destination without moving it back to the garrison slot', () => {
    const profile = createCareerProfile('roman'), id = 'gate:north:7'
    profile.activeMission = createTownDefenseMission([id], [], 'official-rampart')
    const member = { status: 'deployed' as const, hp: 37, ammo: 12, order: 'formation' as const,
      position: { x: 30, y: 9.25, z: -110.6, yaw: .7 },
      formation: { commandId: 91, position: { x: 40, y: 8.5, z: -110.6, yaw: 0 }, reached: false } }
    profile.activeMission.officialSquad = { type: 'mission-official', missionId: 'official-rampart', townFaction: 'roman', squadId: 1,
      actorIds: [id], contribution: emptyPersonalContribution(), members: { [id]: member } }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    expect(store.load()!.activeMission!.officialSquad!.members![id]).toEqual(member)
  })
})
