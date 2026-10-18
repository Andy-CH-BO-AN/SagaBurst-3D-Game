import { Vector3 } from 'three'
import { allocateTownSiegeCrews, createTownSiegeCrewSlots, townSiegeFrame } from '../../src/career/TownFourGateSiegePolicy'
import { parseTownFourGateSiegeCheckpoint, type TownFourGateSiegeCheckpoint } from '../../src/career/TownFourGateSiegeCheckpoint'
import { TownGateBreachPolicy } from '../../src/career/TownGateBreachPolicy'
import { describe,expect,it } from 'vitest'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { officialActorSquadId } from '../../src/career/CareerCommandAuthority'
import { stageOfficialCommandOrder } from '../../src/career/CareerOfficialCommandOrder'
import { Faction, type NPC } from '../../src/world/NPC'
import { migrateTownRampartPosition } from '../../src/town/TownLayoutMigration'
import { townRoster } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'
import { createFourGateDefenseProfile } from '../helpers/commanderFourGateDefenseFixture'
import { advanceCommanderCavalryEscort, commanderCavalryEscortAssignments, createCommanderCavalryEscort,
  isCommanderCavalryEscorting, parseCommanderCavalryEscort } from '../../src/career/CommanderCavalryEscort'
import { parseCommanderFourGateDefenseState } from '../../src/career/CommanderFourGateDefenseState'

describe('siege checkpoint ownership', () => {
  it('bounds persisted combat time and validates the survival reason against the actual living defense', () => {
    const profile = createFourGateDefenseProfile('ATTACKING'), mission = profile.activeMission!, state = mission.fourGateDefense!
    const context = { missionId: mission.id, faction: profile.faction, phase: mission.phase,
      targetActorIds: mission.targetActorIds, friendlyActorIds: mission.friendlyActorIds,
      civilianActorIds: mission.civilianActorIds ?? [], deadTargetActorIds: mission.deadTargetActorIds }
    const { combatElapsedSeconds: _legacyAbsent, ...legacy } = state
    expect(parseCommanderFourGateDefenseState(legacy, context)?.combatElapsedSeconds).toBe(0)
    state.combatElapsedSeconds = 299.9
    expect(parseCommanderFourGateDefenseState(state, context)?.combatElapsedSeconds).toBe(299.9)
    state.victoryReason = 'survival'
    expect(parseCommanderFourGateDefenseState(state, context)).toBeUndefined()
    state.combatElapsedSeconds = 300
    expect(parseCommanderFourGateDefenseState(state, context)?.victoryReason).toBe('survival')
    expect(parseCommanderFourGateDefenseState({ ...state, combatElapsedSeconds: 300.1 }, context)).toBeUndefined()
    expect(parseCommanderFourGateDefenseState({ ...state, victoryReason: 'elimination' }, context)).toBeUndefined()
    expect(parseCommanderFourGateDefenseState({ ...state, attackStarted: false }, context)).toBeUndefined()
    state.player!.dead = true; state.player!.hp = 0
    for (const id of [...mission.friendlyActorIds, ...mission.civilianActorIds!]) {
      Object.assign(state.actors[id], { status: 'dead', hp: 0 })
      if (state.siege!.actors[id]) Object.assign(state.siege!.actors[id], { status: 'dead', hp: 0 })
    }
    expect(parseCommanderFourGateDefenseState(state, context)).toBeUndefined()
    const personal = { status: 'deployed' as const, hp: 1 }
    const personalContext = { ...context, personalActorIds: ['personal:survivor'], personalActors: { 'personal:survivor': personal } }
    expect(parseCommanderFourGateDefenseState(state, personalContext)?.victoryReason).toBe('survival')
    expect(parseCommanderFourGateDefenseState(state, { ...personalContext,
      personalActors: { 'personal:survivor': { status: 'reserve', hp: 1 } } })).toBeUndefined()
  })

  it('restores exact escort ownership and a nearly expired stall without regrouping or replaying released orders', () => {
    const profile = createFourGateDefenseProfile('ATTACKING'), mission = profile.activeMission!, state = mission.fourGateDefense!
    expect(isCommanderCavalryEscorting(state.cavalryEscort, mission.targetActorIds[0])).toBe(false)
    const assignments = commanderCavalryEscortAssignments(mission.id), escort = createCommanderCavalryEscort(mission.id)
    state.cavalryEscort = escort
    const released = assignments.filter(a => a.gateId === 'north' && a.side === -1)
    for (const a of released) escort.actors[a.actorId].mode = 'released'
    escort.groups['town-siege-ramp:north:left'].releaseReason = 'gate-range'
    const east = state.siege!.ramps.find(r => r.assignment.id === 'town-siege-ramp:east:left')!
    east.distance = 17; east.position.x -= 17
    escort.groups[east.assignment.id] = { lastProgressDistance: 17, stallSeconds: 19.75 }
    // This owner needs the real mission-state field/parser boundary, not two
    // more traversals of the entire Career profile already covered below.
    const restored = parseCommanderFourGateDefenseState(JSON.parse(JSON.stringify(state)), {
      missionId: mission.id, faction: profile.faction, phase: mission.phase, targetActorIds: mission.targetActorIds,
      friendlyActorIds: mission.friendlyActorIds, civilianActorIds: mission.civilianActorIds ?? [],
      deadTargetActorIds: mission.deadTargetActorIds,
    })!
    expect(restored.cavalryEscort).toEqual(escort)
    expect(isCommanderCavalryEscorting(restored.cavalryEscort, released[0].actorId)).toBe(false)
    const actors = new Map(assignments.map(a => [a.actorId, { dead: false, position: restored.actors[a.actorId].position! }]))
    const ramps = new Map(restored.siege!.ramps.map(r => [r.assignment.id, { state: r.state, distance: r.distance, alivePushers: 4 }]))
    const resumed = advanceCommanderCavalryEscort(restored.cavalryEscort!, .25, actors, ramps)
    expect(resumed.checkpoint.groups[east.assignment.id]).toEqual({ lastProgressDistance: 17, stallSeconds: 20, releaseReason: 'stalled' })
    expect(resumed.releasedActorIds).toEqual(assignments.filter(a => a.rampId === east.assignment.id).map(a => a.actorId))
    expect(resumed.releasedActorIds.some(id => released.some(a => a.actorId === id))).toBe(false)
    // The mission-state boundary was exercised above; the second transition
    // needs only this checkpoint's parser, without repeating all 230 actor records.
    const persisted = parseCommanderCavalryEscort(JSON.parse(JSON.stringify(resumed.checkpoint)), mission.id)!
    expect(advanceCommanderCavalryEscort(persisted, 0, actors, ramps).releasedActorIds).toEqual([])
    const releasedId = released[0].actorId
    const reversed = { ...persisted, actors: { ...persisted.actors,
      [releasedId]: { ...persisted.actors[releasedId], mode: 'escort' as const } } }
    expect(parseCommanderCavalryEscort(reversed, mission.id)).toBeUndefined()
    const reassigned = { ...persisted, actors: { ...persisted.actors,
      [releasedId]: { ...persisted.actors[releasedId], side: 1 as const } } }
    expect(parseCommanderCavalryEscort(reassigned, mission.id)).toBeUndefined()
    const unbounded = { ...persisted, groups: { ...persisted.groups,
      [east.assignment.id]: { ...persisted.groups[east.assignment.id], stallSeconds: 20.001 } } }
    expect(parseCommanderCavalryEscort(unbounded, mission.id)).toBeUndefined()
  })

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

  it('round-trips a Commander formation in both actor owners without restoring the garrison destination', () => {
    const profile = createFourGateDefenseProfile('ATTACKING'), id = 'gate:north:7'
    const active = profile.activeMission!, state = active.fourGateDefense!
    state.cavalryEscort = createCommanderCavalryEscort(active.id)
    const member = { status: 'deployed' as const, hp: 37, ammo: 12, order: 'formation' as const,
      position: { x: 30, y: 9.25, z: -110.6, yaw: .7 },
      mount: { hp: 0, mounted: false, position: { x: 29, y: 9.25, z: -110.6, yaw: .7 } },
      formation: { commandId: 91, position: { x: 40, y: 8.5, z: -110.6, yaw: 0 }, reached: false as const } }
    state.siege!.actors[id].entranceId = 'town-siege-gate:north'
    state.siege!.actors[id].breachCompleted = true
    const flyerId = 'four-gate-save:air:ranger:1', flyer = state.actors[flyerId]
    flyer.position!.y = 45; flyer.mount!.position.y = 43
    flyer.mount!.flight = { phase: 'cruise', yaw: .4, pitch: .2, bank: -.1, speed: 13, velocity: { x: 4, y: 2, z: 12 } }
    const wallId = 'gate:north:8'
    const wall = { ...state.actors[wallId], order: 'defend' as const, townRampartGarrison: true, townRampartMounted: true,
      mount: { hp: 68, mounted: true, position: { x: 24, y: 9.25, z: -110.6, yaw: .7 } } }
    state.actors[wallId] = wall
    state.siege!.actors[wallId] = { ...wall, entranceId: null, breachCompleted: false }
    // Only the actor snapshot boundary is supplied; command selection and all mirrors are real.
    const npc = { combatantId: id, squadId: officialActorSquadId(active.officialSquad!, id),
      faction: Faction.TOWN, combatOwnership: 'mission-official', dead: false } as NPC
    const nativeMember = { ...member, outpostRampartGarrison: true, townRampartGarrison: true, townRampartMounted: true }
    const staged = stageOfficialCommandOrder(profile, [npc], 'formation', [{ npc, ...member.formation }], () => structuredClone(nativeMember))!
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(staged)).toBe(true)
    const loaded = store.load()!
    const restored = loaded.activeMission!.fourGateDefense!
    expect(restored.cavalryEscort).toEqual(state.cavalryEscort)
    expect(loaded.activeMission!.officialSquad!.members![id]).toEqual(member)
    expect(restored.actors[id]).toEqual(member)
    expect(restored.siege!.actors[id]).toEqual({ ...member, entranceId: null, breachCompleted: true })
    expect(restored.siege!.playerCommandedActorIds).toContain(id)
    expect(restored.actors[flyerId]).toEqual(flyer)
    expect(restored.siege!.actors[flyerId]).toBeUndefined()
    expect(restored.actors[wallId]).toEqual(wall)
    expect(restored.siege!.actors[wallId]).toMatchObject({ townRampartMounted: true, townRampartGarrison: true, mount: { hp: 68, mounted: true } })
    expect(restored.player).toEqual(state.player)
    expect(state.siege!.actors[id].entranceId).toBe('town-siege-gate:north')
    expect(state.siege!.playerCommandedActorIds).toEqual([])

  })

  it('persists Commander dismissal back to native duty in every actor owner', () => {
    // A saved player-owned formation is the input to this distinct handoff. Do not
    // re-run Formation's complete save/load transaction to set up Dismiss.
    const loaded = createFourGateDefenseProfile('ATTACKING'), id = 'gate:north:7'
    const active = loaded.activeMission!, state = active.fourGateDefense!
    const member = { status: 'deployed' as const, hp: 37, ammo: 12, order: 'formation' as const,
      position: { x: 30, y: 9.25, z: -110.6, yaw: .7 },
      mount: { hp: 0, mounted: false, position: { x: 29, y: 9.25, z: -110.6, yaw: .7 } },
      formation: { commandId: 91, position: { x: 40, y: 8.5, z: -110.6, yaw: 0 }, reached: false as const } }
    const npc = { combatantId: id, squadId: officialActorSquadId(active.officialSquad!, id),
      faction: Faction.TOWN, combatOwnership: 'mission-official', dead: false } as NPC
    active.officialSquad!.commandedSquadIds = [officialActorSquadId(active.officialSquad!, id)!]
    active.officialSquad!.members = { [id]: structuredClone(member) }
    state.actors[id] = structuredClone(member)
    state.siege!.actors[id] = { ...structuredClone(member), entranceId: null, breachCompleted: true }
    state.siege!.playerCommandedActorIds = [id]
    const nativeMember = { ...member, outpostRampartGarrison: true, townRampartGarrison: true, townRampartMounted: true }
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    const dismissed = stageOfficialCommandOrder(loaded, [npc], 'dismiss', [], () => structuredClone(nativeMember))!
    expect(store.save(dismissed)).toBe(true)
    // save() validates and normalizes the final command; inspect its persisted
    // bytes; full-store reload is covered by the separate Formation owner case.
    const returned = (JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!) as CareerProfile).activeMission!
    expect(returned.officialSquad!.commandedSquadIds).not.toContain(npc.squadId)
    expect(returned.fourGateDefense!.siege!.playerCommandedActorIds).not.toContain(id)
    expect(returned.fourGateDefense!.actors[id]).toMatchObject({ hp: 37, order: 'defend', mount: { hp: 0, mounted: false },
      outpostRampartGarrison: true, townRampartGarrison: true, townRampartMounted: true })
    expect(returned.fourGateDefense!.actors[id].formation).toBeUndefined()
    expect(returned.officialSquad!.members![id]).toEqual(returned.fourGateDefense!.actors[id])
    expect(returned.fourGateDefense!.siege!.actors[id]).toEqual({ status: 'deployed', hp: 37, ammo: 12, order: 'defend',
      position: member.position, mount: member.mount, townRampartGarrison: true, townRampartMounted: true,
      entranceId: null, breachCompleted: true })
  })

  it('reloads explicit Attack and Defend ownership without native station flags in any actor mirror', () => {
    const profile = createFourGateDefenseProfile('ATTACKING'), active = profile.activeMission!, state = active.fourGateDefense!
    const attackId = 'gate:north:7', defendId = 'gate:east:7'
    const member = { status: 'deployed' as const, hp: 37, order: 'defend' as const,
      position: { x: 30, y: 9.25, z: -110.6, yaw: .7 },
      mount: { hp: 68, mounted: true, position: { x: 30, y: 9.25, z: -110.6, yaw: .7 } } }
    const nativeMember = { ...member, outpostRampartGarrison: true, townRampartGarrison: true, townRampartMounted: true }
    const participants = [attackId, defendId].map(id => {
      state.actors[id] = structuredClone(nativeMember)
      state.siege!.actors[id] = { ...structuredClone(nativeMember), entranceId: 'town-siege-gate:north', breachCompleted: false }
      return { combatantId: id, squadId: officialActorSquadId(active.officialSquad!, id),
        faction: Faction.TOWN, combatOwnership: 'mission-official', dead: false } as NPC
    })
    const snapshot = () => structuredClone(nativeMember)
    const attacked = stageOfficialCommandOrder(profile, [participants[0]], 'attack', [], snapshot)!
    const staged = stageOfficialCommandOrder(attacked, [participants[1]], 'defend', [], snapshot)!
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(staged)).toBe(true)
    const loaded = store.load()!.activeMission!, restored = loaded.fourGateDefense!
    // Both orders share the saved ownership invariant; the parser must not hide stale flags.
    for (const [id, order] of [[attackId, 'attack'], [defendId, 'defend']] as const) {
      const expected = { ...member, order }
      expect(staged.activeMission!.officialSquad!.members![id]).toEqual(expected)
      expect(staged.activeMission!.fourGateDefense!.actors[id]).toEqual(expected)
      expect(staged.activeMission!.fourGateDefense!.siege!.actors[id]).toEqual({ ...expected, entranceId: null, breachCompleted: false })
      expect(loaded.officialSquad!.members![id]).toEqual(expected)
      expect(restored.actors[id]).toEqual(expected)
      expect(restored.siege!.actors[id]).toEqual({ ...expected, entranceId: null, breachCompleted: false })
      expect(loaded.officialSquad!.commandedSquadIds).toContain(officialActorSquadId(loaded.officialSquad!, id))
      expect(restored.siege!.playerCommandedActorIds).toContain(id)
      expect(state.actors[id]).toEqual(nativeMember)
    }
  })

  it('fails closed on a same-size forged Commander target roster without deleting the corrupt saved mission', () => {
    const profile = createFourGateDefenseProfile(), storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    const raw = profile
    raw.activeMission!.targetActorIds[229] = 'four-gate-save:air:ranger:31'
    const corrupt = JSON.stringify(raw)
    storage.setItem(CAREER_STORAGE_KEY, corrupt)
    expect(store.loadChecked().profile).toBeNull()
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(corrupt)
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
