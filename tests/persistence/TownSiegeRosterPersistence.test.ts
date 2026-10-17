import { Vector3 } from 'three'
import { allocateTownSiegeCrews, createTownSiegeCrewSlots, townSiegeFrame } from '../../src/career/TownFourGateSiegePolicy'
import { parseTownFourGateSiegeCheckpoint, type TownFourGateSiegeCheckpoint } from '../../src/career/TownFourGateSiegeCheckpoint'
import { TownGateBreachPolicy } from '../../src/career/TownGateBreachPolicy'
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

function fourGateCheckpoint(): TownFourGateSiegeCheckpoint {
  const assignments = allocateTownSiegeCrews(createTownSiegeCrewSlots('roman'))
  const policy = new TownGateBreachPolicy(() => [])
  return { version: 1, faction: 'roman', ramps: assignments.map(assignment => {
    const f = townSiegeFrame(assignment.gateId)
    const position = new Vector3(f.gate.x, 10, f.gate.z).addScaledVector(f.outward, 41.9).addScaledVector(f.tangent, assignment.side * 25)
    return { assignment, stagingZ: position.z, position: { x: position.x, y: position.y, z: position.z },
      hp: 520, state: 'PUSHING', distance: 0, travelDistance: 40, dockingProgress: 0 }
  }), gates: policy.snapshot().map(gate => ({ ...gate, hp: 2080 })), playerCommandedActorIds: [],
  actors: Object.fromEntries(assignments.flatMap(a => [...a.pusherIds, ...a.assaultIds]).map(id => [id,
    { status: 'deployed', hp: 100, order: 'attack', position: { x: 0, y: 0, z: 0, yaw: 0 }, entranceId: null, breachCompleted: false }])) }
}
describe('four-gate checkpoint boundary', () => {
  it('round-trips partial travel, casualties, destroyed carriers and local handled events without changing their identities', () => {
    const saved = fourGateCheckpoint(), east = saved.ramps.find(r => r.assignment.id === 'town-siege-ramp:east:left')!
    east.distance = 17; east.position.x -= 17; east.hp = 237
    const west = saved.ramps.find(r => r.assignment.id === 'town-siege-ramp:west:left')!
    west.state = 'DESTROYED'; west.hp = 0
    saved.actors[east.assignment.pusherIds[1]].status = 'exited'
    saved.actors[east.assignment.pusherIds[0]].status = 'dead'; saved.actors[east.assignment.pusherIds[0]].hp = 0
    const north = saved.gates.find(g => g.gateId === 'north')!
    north.gateState = 'destroyed'; north.hp = 0; north.cavalryEventHandled = true
    const loaded = parseTownFourGateSiegeCheckpoint(JSON.parse(JSON.stringify(saved)))!
    expect(loaded).toEqual(saved)
    const restored = new TownGateBreachPolicy(() => { throw new Error('replayed event') }, loaded.gates)
    restored.gate('north', 'destroyed')
    expect(loaded.ramps.find(r => r.assignment.id === east.assignment.id)).toMatchObject({ hp: 237, distance: 17 })
    expect(loaded.actors[east.assignment.pusherIds[0]]).toMatchObject({ status: 'dead', hp: 0 })
    expect(loaded.actors[east.assignment.pusherIds[1]].status).toBe('exited')
    loaded.ramps[0].hp = 2; expect(saved.ramps[0].hp).toBe(520)
  })
  it('rejects duplicated crew membership and a missing eighth vehicle at the bounded parser boundary', () => {
    const saved = fourGateCheckpoint()
    saved.ramps[1].assignment.pusherIds[0] = saved.ramps[0].assignment.pusherIds[0]
    expect(parseTownFourGateSiegeCheckpoint(saved)).toBeUndefined()
    expect(parseTownFourGateSiegeCheckpoint({ ...fourGateCheckpoint(), ramps: fourGateCheckpoint().ramps.slice(0, 7) })).toBeUndefined()
  })
  it('rejects an undocked bridge claim and a docked carrier outside its real dock position', () => {
    const saved = fourGateCheckpoint(), east = saved.ramps.find(r => r.assignment.id === 'town-siege-ramp:east:left')!
    const gate = saved.gates.find(g => g.gateId === 'east')!
    gate.dockedRampIds = [east.assignment.id]; gate.wallEventHandled = true
    expect(parseTownFourGateSiegeCheckpoint(saved)).toBeUndefined()
    east.state = 'DOCKED'; east.distance = 40; east.dockingProgress = 1
    expect(parseTownFourGateSiegeCheckpoint(saved)).toBeUndefined()
    east.position.x -= 40
    expect(parseTownFourGateSiegeCheckpoint(saved)).toEqual(saved)
  })
})
