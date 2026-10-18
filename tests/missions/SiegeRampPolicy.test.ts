import { describe, expect, it, onTestFinished } from 'vitest'
import { Box3, Matrix4, Vector3, type Object3D } from 'three'
import { allocateSiegeRampCrews, getSiegeRampPlacement, placeSiegeRampCrew, siegeRampDeckHeightAt, siegeRampRearHeightAt, SIEGE_RAMP } from '../../src/campaign/MobileSiegeRampPolicy'
import type { OutpostWalkwayLayout } from '../../src/campaign/CampaignOutpostWalkways'
import { MobileSiegeRamp } from '../../src/campaign/MobileSiegeRamp'
import { MovingPlatformSupport } from '../../src/movement/MovingPlatformSupport'
import { MobileSiegeRampController } from '../../src/campaign/MobileSiegeRampController'
import { parseCampaignSiegeCheckpoint } from '../../src/campaign/CampaignSiegeCheckpoint'
import { allocateTownSiegeCrews, createTownSiegeCrewSlots, isTownSiegeDockConnected, planTownSiegeRamps, townSiegeFrame } from '../../src/career/TownFourGateSiegePolicy'
import { getTerrainHeight, getWalkRampHeight } from '../../src/world/Terrain'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { createCommanderFourGateDefenseRoster } from '../../src/career/CommanderFourGateDefenseRoster'
import { getTownRampartLayout } from '../../src/town/TownRamparts'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../../src/town/TownBounds'
import { TOWN_GATES } from '../../src/town/TownLayout'
import { advanceCommanderCavalryEscort, commanderCavalryEscortAssignments, commanderCavalryEscortTarget,
  createCommanderCavalryEscort, type CommanderCavalryEscortActorFrame, type CommanderCavalryEscortRampFrame } from '../../src/career/CommanderCavalryEscort'
import type { TownSiegeRampId } from '../../src/campaign/MobileSiegeRampPolicy'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'

describe('shared siege crew and vehicle lifecycle', () => {
  it('releases only complete fixed escort groups from their own living gate-range and bounded ramp observations', () => {
    const assignments = commanderCavalryEscortAssignments('escort'), initial = createCommanderCavalryEscort('escort')
    const roster = createCommanderFourGateDefenseRoster('escort', 'roman')
    expect(new Set(assignments.map(a => a.actorId))).toEqual(new Set(roster.cavalry.map(actor => actor.actorId)))
    expect(assignments.filter(a => a.gateId === 'north' && a.side === -1).map(a => a.slot)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(assignments.filter(a => a.gateId === 'north' && a.side === 1).map(a => a.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    const actors = new Map<string, CommanderCavalryEscortActorFrame>(assignments.map(a => {
      const gate = TOWN_GATES.find(g => g.id === a.gateId)!
      return [a.actorId, { dead: false, position: { x: gate.x + 80, z: gate.z } }]
    }))
    const ramps = new Map<TownSiegeRampId, CommanderCavalryEscortRampFrame>(assignments.map(a => [a.rampId,
      { state: 'PUSHING', distance: 0, alivePushers: 4 }]))
    const north = assignments.filter(a => a.gateId === 'north' && a.side === -1)
    actors.get(north[0].actorId)!.position = { x: 50.001, z: -115 }
    actors.get(north[1].actorId)!.position = { x: 0, z: -115 }
    actors.get(north[1].actorId)!.dead = true
    const movingRear = { x: 270, z: 62 }, inward = { x: -1, z: 0 }
    expect(commanderCavalryEscortTarget(0, movingRear, inward)).toEqual({ x: 276, z: 59.5, yaw: -Math.PI / 2 })
    movingRear.x -= 13
    expect(commanderCavalryEscortTarget(7, movingRear, inward)).toEqual({ x: 275, z: 63.5, yaw: -Math.PI / 2 })
    const waiting = advanceCommanderCavalryEscort(initial, 19.75, actors, ramps)
    expect(waiting.releasedActorIds).toEqual([])
    expect(initial.groups['town-siege-ramp:north:left'].stallSeconds).toBe(0)

    actors.get(north[0].actorId)!.position.x = 50
    ramps.get('town-siege-ramp:north:right')!.distance = .5
    ramps.get('town-siege-ramp:south:left')!.state = 'DESTROYED'
    ramps.get('town-siege-ramp:south:right')!.state = 'ABANDONED'
    ramps.get('town-siege-ramp:east:left')!.alivePushers = 0
    for (const a of assignments.filter(a => a.gateId === 'east' && a.side === 1)) actors.get(a.actorId)!.dead = true
    Object.assign(ramps.get('town-siege-ramp:west:right')!, { state: 'DOCKED', distance: .5 })
    const advanced = advanceCommanderCavalryEscort(waiting.checkpoint, .25, actors, ramps)
    const expected = {
      'town-siege-ramp:north:left': 'gate-range', 'town-siege-ramp:south:left': 'ramp-destroyed',
      'town-siege-ramp:south:right': 'ramp-abandoned', 'town-siege-ramp:east:left': 'no-pushers',
      'town-siege-ramp:east:right': 'group-dead', 'town-siege-ramp:west:left': 'stalled',
    }
    expect(Object.fromEntries(Object.entries(advanced.checkpoint.groups).filter(([, g]) => g.releaseReason)
      .map(([id, g]) => [id, g.releaseReason]))).toEqual(expected)
    expect(new Set(advanced.releasedActorIds)).toEqual(new Set(assignments.filter(a => a.rampId in expected).map(a => a.actorId)))
    expect(advanced.checkpoint.groups['town-siege-ramp:north:right']).toEqual({ lastProgressDistance: .5, stallSeconds: 0 })
    expect(advanced.checkpoint.groups['town-siege-ramp:west:right'].releaseReason).toBeUndefined()
    expect(advanceCommanderCavalryEscort(advanced.checkpoint, 0, actors, ramps).releasedActorIds).toEqual([])
    expect(advanced.checkpoint.actors[north[1].actorId]).toMatchObject({ slot: 1, side: -1, mode: 'released' })

    // The caller's save is the external boundary: a rejected release cannot alter
    // live charge/routing, and a successful retry delivers the same group once.
    let accept = false
    const effects: string[] = []
    const npc = { combatantId: north[0].actorId, dead: false, combatPosition: { x: 50, z: -115 }, missionMovement: true,
      setMissionCombatTarget(value: unknown) { expect(value).toBeUndefined(); effects.push('target') },
      setTacticalOrder(order: string) { effects.push(order) } }
    interface ReleaseEntry {
      state: { cavalryEscort: typeof initial }
      pendingEscortReleases?: readonly string[]
      updateCavalryEscort(dt: number): void
    }
    const owner = Object.assign(Object.create(CommanderFourGateDefenseController.prototype) as ReleaseEntry, {
      state: { cavalryEscort: initial }, enemies: [npc], actorsById: new Map([[npc.combatantId, npc]]), escortAssignments: [],
      fourGateSiege: { ramps: new Map(), resumeExternalMovement() { effects.push('route') } },
      saveProgress(this: ReleaseEntry) {
        expect(this.pendingEscortReleases).toEqual(north.map(a => a.actorId))
        expect(this.state.cavalryEscort.actors[npc.combatantId].mode).toBe('released')
        expect(npc.missionMovement).toBe(true)
        effects.push(accept ? 'commit' : 'reject'); return accept
      },
    })
    owner.updateCavalryEscort(0)
    expect(owner.state.cavalryEscort).toBe(initial)
    expect(owner.pendingEscortReleases).toBeUndefined()
    expect(effects).toEqual(['reject'])
    accept = true
    owner.updateCavalryEscort(0); owner.updateCavalryEscort(0)
    expect(effects).toEqual(['reject', 'commit', 'target', 'charge', 'route'])
    expect(npc.missionMovement).toBe(false)
  })

  it('allocates the formal 230 attackers with eighty unique Town crew and stable gate roles', () => {
    const roster = createCommanderFourGateDefenseRoster('defense', 'roman')
    const slots = roster.crew, crews = allocateTownSiegeCrews([...slots].reverse())
    expect(roster.all).toHaveLength(230)
    expect(new Set(roster.all.map(spec => spec.actorId)).size).toBe(230)
    expect(roster.ground).toHaveLength(200)
    expect(roster.cavalry.filter(spec => spec.tier === 3 && spec.loadout?.mountId === 'horse')).toHaveLength(56)
    expect(roster.cavalry.filter(spec => spec.tier === 4 && spec.loadout?.mountId === 'corgi')).toHaveLength(4)
    expect(roster.archers.filter(spec => spec.tier === 3 && !spec.loadout?.mountId)).toHaveLength(56)
    expect(roster.archers.filter(spec => spec.tier === 4 && !spec.loadout?.mountId)).toHaveLength(4)
    expect(roster.air.filter(spec => spec.tier === 4 && spec.loadout?.mountId === 'xongkoro')).toHaveLength(30)
    expect(roster.all.every(spec => spec.respawnEnabled === false)).toBe(true)
    for (const spec of [...roster.cavalry, ...roster.archers, ...roster.air]) {
      const axis = Math.max(Math.abs(spec.x), Math.abs(spec.z))
      expect(axis).toBeGreaterThanOrEqual(TOWN_PLAYABLE_WORLD_BOUND - 15)
      expect(axis).toBeLessThanOrEqual(TOWN_PLAYABLE_WORLD_BOUND - (spec.loadout?.mountId === 'xongkoro' ? 15 : 4))
    }
    for (const gate of ['north', 'south', 'east', 'west']) {
      expect(roster.ground.filter(spec => roster.gateByActorId.get(spec.actorId!) === gate)).toHaveLength(50)
      expect(roster.cavalry.filter(spec => spec.actorId?.startsWith(`defense:${gate}:lancer:`))).toHaveLength(15)
      expect(roster.archers.filter(spec => spec.actorId?.startsWith(`defense:${gate}:archer:`))).toHaveLength(15)
    }
    expect(crews).toHaveLength(8)
    expect(new Set(crews.flatMap(c => [...c.pusherIds, ...c.assaultIds])).size).toBe(80)
    expect(slots.filter(s => s.spec.visualAssetId === 'roman-hero-t4')).toHaveLength(72)
    expect(slots.filter(s => s.spec.combatProfileId === 'roman-commander')).toHaveLength(8)
    const east = crews.find(c => c.id === 'town-siege-ramp:east:left')!
    expect([...east.pusherIds].sort()).toEqual(['defense:east:left:pusher:1', 'defense:east:left:pusher:2', 'defense:east:left:pusher:3', 'defense:east:left:pusher:4'])
    expect(east.assaultIds).toHaveLength(6)
    const duplicate = structuredClone(slots); duplicate[10].spec.actorId = duplicate[0].spec.actorId
    expect(() => allocateTownSiegeCrews(duplicate)).toThrow('Invalid Town siege crew')
  })

  it('plans full edge approaches with finite walkable ramps and six deck riders plus four ground pushers', () => {
    const slots = createTownSiegeCrewSlots('viking'), assignments = allocateTownSiegeCrews(slots)
    const layout = getTownRampartLayout()
    const obstruction = { box: new Box3(new Vector3(18, -10, -280), new Vector3(19, 20, -270)), isBarricade: true }
    const placements = planTownSiegeRamps(layout, [obstruction], undefined, 'world-edge')
    expect(placements).toHaveLength(8)
    expect(planTownSiegeRamps(layout, []).every(p => Math.abs(Math.hypot(p.start.x - p.dock.x, p.start.z - p.dock.z) - 40) < .001
      && !p.terrainAnchor)).toBe(true)
    const expected = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }
    const invalid: string[] = []
    for (const p of placements) {
      const frame = townSiegeFrame(p.gateId), crew = assignments.find(c => c.id === p.id)!, s = p.surface
      expect([frame.inward.x + 0, frame.inward.z + 0]).toEqual(expected[p.gateId])
      expect(p.clearance.intersectsBox(obstruction.box)).toBe(false)
      expect(Math.max(Math.abs(p.clearance.min.x), Math.abs(p.clearance.max.x), Math.abs(p.clearance.min.z), Math.abs(p.clearance.max.z))).toBeCloseTo(347.5)
      const travel = Math.hypot(p.start.x - p.dock.x, p.start.z - p.dock.z)
      expect(travel).toBeGreaterThan(145); expect(s.length).toBeLessThanOrEqual(40)
      placeSiegeRampCrew(slots.map(slot => slot.spec), crew, p)
      const movingSurface = { ...s, startX: s.startX + p.start.x - p.dock.x, startZ: s.startZ + p.start.z - p.dock.z, topY: p.start.y }
      for (const id of crew.assaultIds) {
        const actor = slots.find(slot => slot.spec.actorId === id)!.spec
        if (getWalkRampHeight(movingSurface, actor.x, actor.z) !== actor.spawnY) invalid.push(`deck:${id}`)
      }
      for (const id of crew.pusherIds) {
        const actor = slots.find(slot => slot.spec.actorId === id)!.spec
        if (actor.spawnY !== getTerrainHeight(actor.x, actor.z)
          || Math.max(Math.abs(actor.x), Math.abs(actor.z)) > TOWN_PLAYABLE_WORLD_BOUND - .6) invalid.push(`ground:${id}`)
      }
      const deckGroundOffset = p.dock.y - getTerrainHeight(p.dock.x - p.dirX! * 3, p.dock.z - p.dirZ * 3)
      for (let distance = 0; distance < travel; distance += 5) {
        const x = p.start.x + p.dirX! * distance, z = p.start.z + p.dirZ * distance
        const top = siegeRampDeckHeightAt(p, x, z)
        const bottom = siegeRampRearHeightAt(p, x - p.dirX! * (s.length + 6), z - p.dirZ * (s.length + 6))
        if (Math.abs(top - getTerrainHeight(x - p.dirX! * 3, z - p.dirZ * 3) - deckGroundOffset) > .001
          || (top - bottom) / s.length > SIEGE_RAMP.maxSlope || top - getTerrainHeight(x, z) > 11) invalid.push(`sweep:${p.id}`)
      }
      expect(isTownSiegeDockConnected(layout, { ...s, startX: p.dock.x, startZ: p.dock.z,
        startY: p.dock.y, length: 4, landing: 0 }, p.deckConnection)).toBe(true)
    }
    expect(invalid).toEqual([])
  })

  it('reduces native speed with each lost pusher and never replaces a withdrawn/dead crew member', () => {
    const assignment = allocateTownSiegeCrews(createTownSiegeCrewSlots('roman'))[0], controller = new MobileSiegeRampController(assignment, 100)
    const crew = [...assignment.pusherIds, ...assignment.assaultIds].map(combatantId => ({ combatantId, dead: false }))
    for (const actor of crew) controller.register(actor)
    expect(controller.advance(.1, false)).toBe(0)
    expect(controller.advance(.1)).toBeCloseTo(SIEGE_RAMP.speed * .1)
    for (let lost = 1; lost <= 4; lost++) {
      if (lost === 2) controller.withdraw(crew[lost - 1].combatantId)
      else crew[lost - 1].dead = true
      expect(controller.advance(.1)).toBeCloseTo(SIEGE_RAMP.speed * .1 * (4 - lost) / 4)
    }
    expect(controller.state).toBe('ABANDONED')
    expect(() => controller.register({ combatantId: 'unassigned', dead: false })).toThrow()
    expect(controller.advance(10)).toBe(0)
  })

  it('retains Outpost left/right identities, excludes T4, pushes on Z and keeps the old two-ramp parser contract', () => {
    const specs = createTownSiegeCrewSlots('viking').slice(0, 20).map(({ spec }, index) => ({ ...spec, actorId: `outpost:${index}`, tier: 3 as const }))
    const t4 = { ...specs[0], actorId: 'outpost:t4', tier: 4 as const }
    const crews = allocateSiegeRampCrews([t4, ...specs], 'viking')
    expect(crews.map(c => c.id)).toEqual(['siege-ramp-left', 'siege-ramp-right'])
    expect(crews.flatMap(c => [...c.pusherIds, ...c.assaultIds])).not.toContain(t4.actorId)
    // Named adapter supplies only the placement owner's deck/slab dependency; no world builder.
    const layout = { zSign: 1, decks: [{ side: -1, topY: 8,
      slab: new Box3(new Vector3(-25, 7.5, 50), new Vector3(-15, 8, 56)) }] } as OutpostWalkwayLayout
    const p = getSiegeRampPlacement(layout, -1, -20)
    expect(p.start.x).toBe(-20); expect(p.dock.x).toBe(-20); expect(p.dirZ).toBe(1); expect(p.surface.dirX).toBe(0)
  })

  it('retains the Outpost 1.5-second bridge transition and restores the controller without replaying Dock', () => {
    const crews = allocateSiegeRampCrews(createTownSiegeCrewSlots('viking').slice(0, 20).map(({ spec }) => ({ ...spec, tier: 3 as const })))
    const events: string[] = [], lifecycle = new MobileSiegeRampController(crews[0], 1, state => events.push(state))
    for (const combatantId of [...crews[0].pusherIds, ...crews[0].assaultIds]) lifecycle.register({ combatantId, dead: false })
    lifecycle.advance(1); expect(lifecycle.state).toBe('DOCKING')
    lifecycle.advance(1.49); expect(lifecycle.state).toBe('DOCKING')
    lifecycle.advance(.01); expect(lifecycle.state).toBe('DOCKED')
    const restored = new MobileSiegeRampController(crews[0], 1, () => { throw new Error('Dock replayed') })
    restored.restore({ state: 'DOCKED', distance: 1, dockingProgress: 1 })
    expect(restored.advance(10)).toBe(0); expect(restored.dockingProgress).toBe(1)
    expect(events.filter(e => e === 'DOCKED')).toHaveLength(1)
  })

  it('retains the old Campaign v1 checkpoint identities and two-ramp capacity', () => {
    const crews = allocateSiegeRampCrews(createTownSiegeCrewSlots('viking').slice(0, 20).map(({ spec }) => ({ ...spec, tier: 3 as const })))
    const snapshot = { version: 1, breached: true, ramps: crews.map(assignment => ({ assignment, stagingZ: -20, position: { x: -20, y: 8, z: 49 },
      hp: 520, state: 'DOCKED', distance: 69, dockingProgress: 1 })), actors: {}, destroyedPalisadeIds: [] }
    expect(parseCampaignSiegeCheckpoint(snapshot)).toEqual(snapshot)
    expect(parseCampaignSiegeCheckpoint({ ...snapshot, ramps: [...snapshot.ramps, snapshot.ramps[0]] })).toBeUndefined()
  })
  it('moves the shared X carrier but releases a withdrawn pusher from transport and body-collision exemptions', () => {
    const assignment = allocateTownSiegeCrews(createTownSiegeCrewSlots('roman')).find(a => a.id === 'town-siege-ramp:east:left')!
    const controller = new MobileSiegeRampController(assignment, 40)
    const crew = [...assignment.pusherIds, ...assignment.assaultIds].map(combatantId => ({ combatantId, dead: false,
      position: new Vector3(190, 10, 62), get combatPosition() { return this.position }, isMounted: false,
      siegeTransport: assignment.id as string | null, siegeTransportSpeed: 0 }))
    for (const actor of crew) controller.register(actor)
    const position = new Vector3(191.9, 12, 62), passenger = crew[4], platform = new MovingPlatformSupport(position)
    platform.attach(passenger)
    const box = new Box3(new Vector3(189, 0, 60), new Vector3(192, 12, 65))
    const parts: { localBox: Box3; obstacle: { projectileWorldToLocal: Matrix4 } }[] = []
    // The renderer/part-mesh boundary is omitted; real update, readiness, terrain, sweep query and carrier math execute.
    interface VehicleEntry {
      position: Vector3
      update(dt: number, actors: readonly typeof crew[number][]): void
      releaseCrew(actor: typeof crew[number]): void
    }
    const owner = Object.assign(Object.create(MobileSiegeRamp.prototype) as VehicleEntry, {
      disposed: false, position, controller, assignment, placement: { dirX: -1, dirZ: 0,
        dock: new Vector3(151.9, 10, 62), surface: { startX: 182, startZ: 62, topY: 10, startY: 0 } },
      surface: { startX: 222, startZ: 62 }, platform, crew: new Map(crew.map(n => [n.combatantId, n])),
      shared: [], obstacles: [], parts, wheelBodies: [], deck: { obstacle: { box } }, run: { obstacle: { box } },
      scratch: new Vector3(), updateGeometry() {},
    })
    owner.update(.1, [])
    expect(owner.position.x).toBeCloseTo(191.42); expect(owner.position.z).toBe(62)
    expect(crew[0].position.x).toBeCloseTo(189.52); expect(crew[0].position.z).toBe(62)
    expect(passenger.position.x).toBeCloseTo(189.52); expect(passenger.position.z).toBe(62)
    expect(platform.position).toEqual(position)
    const withdrawn = crew[0]
    owner.releaseCrew(withdrawn)
    const releasedPosition = withdrawn.position.clone()
    owner.update(.1, [])
    expect(controller.alivePushers).toBe(3)
    expect(owner.position.x).toBeCloseTo(191.06)
    expect(withdrawn.position).toEqual(releasedPosition)
    expect(withdrawn.siegeTransport).toBeNull(); expect(withdrawn.siegeTransportSpeed).toBe(0)
    expect(() => controller.register(withdrawn)).toThrow('Invalid siege crew registration')
    // The departed actor now has ordinary body ownership and must stop the convoy.
    withdrawn.position.set(190, 0, 62)
    parts.push({ localBox: box, obstacle: { projectileWorldToLocal: new Matrix4() } })
    const stoppedAt = owner.position.clone()
    owner.update(.1, [withdrawn])
    expect(owner.position).toEqual(stoppedAt)
    expect(controller.currentSpeed).toBe(0)
  })

  it('restores a destroyed carrier as hidden and collision-free without replaying transitions', () => {
    const assignment = allocateSiegeRampCrews(createTownSiegeCrewSlots('viking').slice(0, 20).map(({ spec }) => ({ ...spec, tier: 3 as const })))[0]
    const controller = new MobileSiegeRampController(assignment, 40, () => { throw new Error('restore replayed transition') })
    let removals = 0
    // Only the render lifecycle handle is doubled; no Object3D, model or scene is constructed.
    const root = { visible: true, parent: null, removeFromParent() { removals++ } }
    const damageable = new DamageableObstacle({ kind: 'siege_ramp', maxHp: 520, root: root as unknown as Object3D })
    onTestFinished(damageable.onDestroyed(() => controller.destroy()))
    const box = new Box3(), obstacle = { box, isBarricade: true }, neighbor = { box, isBarricade: true }
    const position = new Vector3(), shared = [obstacle, neighbor]
    const owner = Object.assign(Object.create(MobileSiegeRamp.prototype) as Pick<MobileSiegeRamp, 'restore'>, {
      controller, damageable, position, root, shared, obstacles: [obstacle], surface: {},
      placement: { dock: new Vector3(), surface: { startX: 0, startZ: 0 } },
      platform: new MovingPlatformSupport(position), updateGeometry() {},
    })
    const saved = { assignment, stagingZ: -40, position: { x: 0, y: 10, z: -15 }, hp: 0,
      state: 'DESTROYED' as const, distance: 25, dockingProgress: 0 }
    owner.restore(saved); owner.restore(saved)
    expect(root.visible).toBe(false); expect(removals).toBe(1)
    expect(damageable.destroyed).toBe(true); expect(damageable.currentHp).toBe(0)
    expect(shared).toEqual([neighbor])
    expect(position).toEqual(new Vector3(0, 10, -15)); expect(controller.state).toBe('DESTROYED')
  })

})
