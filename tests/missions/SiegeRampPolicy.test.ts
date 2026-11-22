import { careerRankFixture } from '../helpers/careerRankFixture'
import { describe, expect, it } from 'vitest'
import { Box3, Vector3, type Object3D, type Scene } from 'three'
import { campaignInitialOrder } from '../../src/campaign/CampaignInitialOrder'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
import { createDefaultDefensePlayerLoadout, type DefenseCampaignLaunchConfig } from '../../src/campaign/DefenseCampaignLaunch'
import { allocateSiegeRampCrews, getSiegeRampPlacement, isMobileSiegeRampEnabled, placeSiegeRampCrew, siegeRampDeckHeightAt, siegeRampRearHeightAt, SIEGE_RAMP } from '../../src/campaign/MobileSiegeRampPolicy'
import { getOutpostWalkwayLayout, isOutpostWalkwayEnabled, OUTPOST_WALKWAY, type OutpostWalkwayLayout } from '../../src/campaign/CampaignOutpostWalkways'
import { getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { MobileSiegeRamp } from '../../src/campaign/MobileSiegeRamp'
import { MobileSiegeRampController, type MobileSiegeRampState } from '../../src/campaign/MobileSiegeRampController'
import { bodyAhead, createCrewDouble, createSiegeCarrier, crewAssignment, rampPlacement, type CrewDouble } from '../helpers/siegeRampCarrierHarness'
import { evacuateAbandonedRamp } from '../../src/campaign/SiegeConvoy'
import type { SiegeRampAssignment } from '../../src/campaign/MobileSiegeRampPolicy'
import { parseCampaignSiegeCheckpoint } from '../../src/campaign/CampaignSiegeCheckpoint'
import { allocateTownSiegeCrews, createTownSiegeCrewSlots, isTownSiegeDockConnected, planTownSiegeRamps, townSiegeFrame } from '../../src/career/TownFourGateSiegePolicy'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData } from '../../src/world/Terrain'
import { NPC, AIType, AIState } from '../../src/world/NPC'
import { CampaignBreachController, applyCampaignBreachOrders, restoreCampaignBreachCheckpoint, type CampaignGateController } from '../../src/campaign/CampaignGate'
import { snapshotCommandActor, restoreCommandActor } from '../../src/career/CareerCommandActorCheckpoint'
import { parseCommandActorCheckpoint } from '../../src/career/CareerCommandAuthority'
import { createRampartCommandActor } from '../helpers/armyCommandHarness'
import { initializeCareerReliefBattlefield } from '../../src/career/CareerOutpostRelief'
import { parseCareerOutpostCheckpoint } from '../../src/career/CareerOutpostMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { createCommanderFourGateDefenseRoster } from '../../src/career/CommanderFourGateDefenseRoster'
import { getTownRampartLayout } from '../../src/town/TownRamparts'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../../src/town/TownBounds'
import { TOWN_GATES } from '../../src/town/TownLayout'
import { advanceCommanderInfantryEscort, commanderInfantryEscortAssignments, commanderInfantryEscortTarget, createCommanderInfantryEscort, parseCommanderInfantryEscort, COMMANDER_INFANTRY_ESCORT } from '../../src/career/CommanderInfantryEscort'
import { advanceCommanderCavalryEscort, commanderCavalryEscortAssignments, commanderCavalryEscortTarget, createCommanderCavalryEscort, type CommanderCavalryEscortActorFrame, type CommanderCavalryEscortRampFrame } from '../../src/career/CommanderCavalryEscort'
import type { MobileSiegeRampId, SiegeRampPlacement, TownSiegeRampId } from '../../src/campaign/MobileSiegeRampPolicy'

const noScene = {} as Scene
const asNpc = (actor: CrewDouble) => actor as unknown as NPC

/** Production facade over a replaced render side: the recorded events are everything the meshes would have been told. */
function createRampFacade<Id extends MobileSiegeRampId>(placement: SiegeRampPlacement<Id>, assignment: SiegeRampAssignment<Id>) {
  const renders: string[] = [], changes: { ramp: MobileSiegeRamp<Id>; state: MobileSiegeRampState }[] = []
  const root = { visible: true, parent: null, removeFromParent() {} } as unknown as Object3D
  const damageable = new DamageableObstacle({ kind: 'siege_ramp', maxHp: 520, root })
  const ramp = new MobileSiegeRamp<Id>(noScene, assignment, placement, 'roman', [],
    (changed, state) => changes.push({ ramp: changed, state }),
    () => ({ root, damageable, syncGeometry() { renders.push('sync') }, hide() { renders.push('hide') }, dispose() { renders.push('dispose') } }))
  return { ramp, renders, changes }
}

function watchdogCrew(): SiegeRampAssignment {
  return { id: 'siege-ramp-left', side: -1,
    pusherIds: ['p0', 'p1', 'p2', 'p3'], assaultIds: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'] }
}

describe('shared siege crew and vehicle lifecycle', () => {
  it('releases native defenders once on any Outpost breach and reloads without redispatching orders', () => {
    const guard = createRampartCommandActor('guard'), ordinary = createRampartCommandActor('ordinary')
    guard.activateOutpostRampartGarrison()
    ordinary.setTacticalOrder('defend')
    const dead = createRampartCommandActor('dead'), passenger = createRampartCommandActor('passenger')
    const personal = createRampartCommandActor('personal')
    for (const actor of [dead, passenger, personal]) actor.activateOutpostRampartGarrison()
    Object.assign(dead, { state: AIState.DEAD }); passenger.siegeTransport = 'siege-ramp-left'
    personal.combatOwnership = 'player-personal'
    const melee = createRampartCommandActor('attacker-melee', 'viking', AIType.MELEE)
    const ranged = createRampartCommandActor('attacker-ranged', 'viking')
    const controller = new CampaignBreachController()
    let dispatches = 0, result: ReturnType<typeof applyCampaignBreachOrders> | undefined
    controller.onBreach(() => { dispatches++; result = applyCampaignBreachOrders([guard, ordinary, dead, passenger, personal, melee, ranged], 'viking') })
    expect(guard.tacticalOrder).toBe('defend')
    expect(guard.holdsRampartPosition).toBe(true)
    expect(controller.trigger()).toBe(true)
    expect(result).toEqual({ attackerChargeCount: 1, attackerAttackCount: 1, defenderAttackCount: 2 })
    expect(guard.tacticalOrder).toBe('attack')
    expect(guard.isOutpostRampartGarrisonActive).toBe(false)
    expect(guard.holdsRampartPosition).toBe(false)
    expect(ordinary.tacticalOrder).toBe('attack')
    expect(melee.tacticalOrder).toBe('charge'); expect(ranged.tacticalOrder).toBe('attack')
    for (const actor of [dead, passenger, personal]) {
      expect(actor.tacticalOrder).toBe('defend')
      expect(actor.isOutpostRampartGarrisonActive).toBe(true)
    }
    const checkpoint = parseCommandActorCheckpoint(JSON.parse(JSON.stringify(snapshotCommandActor(guard))))!
    expect(checkpoint.order).toBe('attack'); expect(checkpoint.outpostRampartGarrison).toBeUndefined()
    guard.setTacticalOrder('defend') // Later player intent is not overwritten by another entrance.
    expect(controller.trigger()).toBe(false)
    expect(guard.tacticalOrder).toBe('defend'); expect(dispatches).toBe(1)
    const restoredBreach = new CampaignBreachController()
    restoredBreach.onBreach(() => { dispatches++ })
    restoreCampaignBreachCheckpoint(restoredBreach, { breached: true }, { state: 'closed', hp: 100 })
    // Physical gate/palisade/docked-ramp restoration all observe the same saved latch.
    expect(restoredBreach.trigger()).toBe(false)
    expect(dispatches).toBe(1)
    const restoredGuard = createRampartCommandActor('guard')
    restoredGuard.activateOutpostRampartGarrison()
    restoreCommandActor(restoredGuard, checkpoint)
    expect(restoredGuard.tacticalOrder).toBe('attack')
    expect(restoredGuard.isOutpostRampartGarrisonActive).toBe(false)
    expect(restoredGuard.holdsRampartPosition).toBe(false)
    restoredGuard.setTacticalOrder('defend')
    const legacyPosition = { hp: 80, x: 0, z: -120, yaw: 0 }
    const saved = parseCareerOutpostCheckpoint({
      runtime: { phase: 'assault', activePhase: 'assault', deploymentRemainingSeconds: 0, assaultElapsedSeconds: 10,
        reinforcementRemainingSeconds: 0, reinforcementTriggered: false, battleFinished: false },
      actors: {
        'legacy-melee': legacyPosition,
        'legacy-ranged': { ...legacyPosition, checkpoint: { status: 'deployed', hp: 80 } },
        'saved-defend': { ...legacyPosition, checkpoint: { status: 'deployed', hp: 80, order: 'defend' } },
        'saved-formation': { ...legacyPosition, checkpoint: { status: 'deployed', hp: 80,
          formation: { commandId: 91, position: { x: 8, z: -110, yaw: 1 }, reached: false } } },
        controlled: { ...legacyPosition, checkpoint: { status: 'deployed', hp: 80, order: 'attack' } },
      },
      player: { hp: 100, stamina: 100, dead: false, x: 0, z: 100, yaw: 0 },
      playerStats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      wave: null, waveIndex: 0, attackersStarted: true, reinforcementsSpawned: false,
      gate: { state: 'destroyed', hp: 0 },
    })!
    expect(saved).toBeDefined()
    expect(saved.actors['legacy-melee'].checkpoint).toBeUndefined()
    expect(saved.actors['legacy-ranged'].checkpoint?.order).toBeUndefined()
    expect(saved.actors['saved-formation'].checkpoint?.order).toBeUndefined()
    const attacker = (combatantId: string) => ({ combatantId, characterFaction: 'viking' as const, squadId: undefined })
    const profile = createCareerProfile('roman')
    Object.assign(profile, careerRankFixture(profile.faction, 'commander'));
    profile.activeOutpostMission = { id: 'relief', kind: 'outpost-relief', stageId: 3, acceptedAt: 0, battle: saved,
      officialSquad: { type: 'mission-official', missionId: 'relief', townFaction: 'roman', squadId: 1,
        commandRank: 'commander', actorIds: ['controlled'], commandedSquadIds: [1],
        squads: [{ squadId: 1, actorIds: ['controlled'] }], contribution: emptyPersonalContribution(),
        members: { controlled: { status: 'deployed', hp: 80, order: 'defend' } } } }
    const campaign: DefenseCampaignLaunchConfig = { type: 'defense', defenderFaction: 'roman', stageId: 3,
      defenderArmy: {}, playerLoadout: createDefaultDefensePlayerLoadout('roman'),
      careerMissionKind: 'outpost-relief', careerMissionId: 'relief' }
    // Game's per-actor restore applies this decision: the fallback order, then the breach orders again
    // only for restored Relief attackers with no saved intent, never for a player-owned official.
    const initial = (id: string, faction: 'roman' | 'viking' = 'viking') =>
      campaignInitialOrder({ ...attacker(id), characterFaction: faction }, campaign, profile)
    expect(initial('legacy-melee')).toEqual({ outpostOwner: false, order: 'defend', breachOrders: true })
    expect(initial('legacy-ranged')).toEqual({ outpostOwner: false, order: 'defend', breachOrders: true })
    expect(initial('saved-defend').breachOrders).toBe(false)
    expect(initial('saved-formation').breachOrders).toBe(false)
    expect(initial('controlled', 'roman')).toEqual({ outpostOwner: true, order: 'defend', breachOrders: false })
    expect(initial('guard', 'roman')).toEqual({ outpostOwner: true, order: 'defend', breachOrders: true })
    // A restored breach is not replayed by the Relief battlefield either.
    restoreCampaignBreachCheckpoint(restoredBreach, saved.outpostSiege, saved.gate)
    const reliefGate = { attackerFaction: 'viking', damageable: { destroy: () => restoredBreach.trigger() } }
    initializeCareerReliefBattlefield(reliefGate as unknown as CampaignGateController, [restoredGuard], restoredBreach)
    expect(restoredGuard.tacticalOrder).toBe('defend')
    expect(restoredBreach.trigger()).toBe(false)
    expect(dispatches).toBe(1)
  })

  it('abandons a fully deployed carrier after immobile simulation seconds, resetting observation across checkpoint restore', () => {
    const assignment = crewAssignment('siege-ramp-left')
    const placement = rampPlacement({ id: assignment.id, start: new Vector3(0, 8, 26), travel: 100, length: 20, dirZ: 1 })
    const { carrier, states } = createSiegeCarrier({ placement, assignment })
    carrier.controller.observeMovement(20, 0, 0, 0, 0)
    expect(carrier.controller.state).toBe('DEPLOYING')
    for (const id of [...assignment.pusherIds, ...assignment.assaultIds]) carrier.register(createCrewDouble(id, 0, 8, 24))
    // A bystander wedged against the front keeps the real swept gate closed.
    const blocker = bodyAhead(carrier.position, 0, 1, .3)
    expect(carrier.canMove(.1, [], [blocker])).toBe(false)
    for (let frame = 0; frame < 99; frame++) carrier.update(.1, [], [blocker])
    expect(carrier.controller.state).toBe('PUSHING')
    carrier.update(.1, [], [blocker])
    expect(carrier.controller.state).toBe('ABANDONED')
    expect(carrier.controller.currentSpeed).toBe(0)
    expect(states).toEqual(['PUSHING', 'ABANDONED'])

    // Checkpoint restore resets unfinished observation
    const controller2 = new MobileSiegeRampController(assignment, 100)
    for (const combatantId of [...assignment.pusherIds, ...assignment.assaultIds]) controller2.register({ combatantId, dead: false })
    controller2.advance(.1, false)
    controller2.observeMovement(9, 30, 20, 30, 20)
    controller2.restore({ state: 'PUSHING', distance: 12, dockingProgress: 0 })
    controller2.observeMovement(9, 42, 20, 42, 20)
    expect(controller2.state).toBe('PUSHING')
    controller2.observeMovement(1, 42, 20, 42, 20)
    expect(controller2.state).toBe('ABANDONED')
  })

  it('starts a fresh actual horizontal displacement window at one metre and abandons a sub-metre next window', () => {
    const assignment = watchdogCrew(), controller = new MobileSiegeRampController(assignment, 100)
    for (const combatantId of [...assignment.pusherIds, ...assignment.assaultIds]) controller.register({ combatantId, dead: false })
    controller.advance(.1, false)
    controller.observeMovement(10, 0, 0, .6, .8)
    expect(controller.state).toBe('PUSHING')
    controller.observeMovement(9, .6, .8, 1.5, .8)
    expect(controller.state).toBe('PUSHING')
    controller.observeMovement(1, 1.5, .8, 1.5, .8)
    expect(controller.state).toBe('ABANDONED')
  })

  it('repairs only a living assigned passenger saved inside the hull before binding the restored platform', () => {
    const assignment = crewAssignment('siege-ramp-left')
    const placement = rampPlacement({ id: assignment.id, start: new Vector3(0, 8, 26), travel: 70, length: 20, dirZ: 1 })
    // The facade runs for real over a replaced render side: no scene, mesh or geometry exists.
    const { ramp, renders, changes } = createRampFacade(placement, assignment)
    expect(renders).toEqual(['sync'])
    ramp.restore({ assignment, stagingZ: 26, position: { x: 0, y: 8, z: 26 }, hp: 520, state: 'PUSHING', distance: 12, dockingProgress: 0 })
    expect(renders).toEqual(['sync', 'sync'])
    const actors = [
      createCrewDouble('a0', 1, 0, 19.8),
      createCrewDouble('a1', -1, 8, 24),
      createCrewDouble('p0', -1, 0, -1.6),
      createCrewDouble('a2', 0, 0, 22),
      createCrewDouble('a3', 2.6, 0, 23),
    ]
    actors[3].dead = true
    const savedPositions = actors.map(actor => actor.position.clone())
    for (const actor of actors) ramp.register(asNpc(actor))
    expect(actors[0].position.toArray()).toEqual([-1, 8, 25])
    expect(actors.slice(1, 4).map(actor => actor.position)).toEqual(savedPositions.slice(1, 4))
    expect(actors[4].position.toArray()).toEqual([1, 8, 23.5])
    expect(ramp.platform.size).toBe(3)
    expect(actors.every(actor => actor.hp === 73 && actor.tacticalOrder === 'defend')).toBe(true)
    expect(actors[3].siegeTransport).toBeNull()
    ramp.platform.moveTo(new Vector3(0, 8, 27))
    expect(actors[0].position.toArray()).toEqual([-1, 8, 26])
    expect(actors[1].position.toArray()).toEqual([-1, 8, 25])

    // End of life reaches the render side once and is not repeated by disposal.
    ramp.damageable.takeDamage(520)
    expect(changes.map(change => change.state)).toEqual(['DESTROYED'])
    expect(changes[0].ramp).toBe(ramp)
    expect(renders).toEqual(['sync', 'sync', 'hide'])
    expect([actors[0], actors[1], actors[4]].map(actor => actor.falls.length)).toEqual([1, 1, 1])
    ramp.dispose(); ramp.dispose()
    expect(renders).toEqual(['sync', 'sync', 'hide', 'dispose'])
  })

  it('releases surviving crew down the rear lane without withdrawing them and restores abandonment without rebinding', () => {
    const assignment = crewAssignment('siege-ramp-left')
    const placement = rampPlacement({ id: assignment.id, start: new Vector3(0, 10, 30), travel: 70, length: 24, dirZ: 1 })
    const makeCrew = () => [...assignment.pusherIds, ...assignment.assaultIds].map((combatantId, index) => {
      const actor = index < 4 ? createCrewDouble(combatantId, index % 2 ? 1 : -1, getTerrainHeight(0, -3), -3)
        : createCrewDouble(combatantId, index % 2 ? 1 : -1, 10, 26)
      actor.dead = index === 9; actor.siegeTransport = assignment.id; actor.siegeTransportSpeed = 2
      return actor
    })
    const crew = makeCrew()
    const abandoned = createSiegeCarrier({ placement, assignment, onChanged: (state, carrier) => {
      if (state === 'ABANDONED') for (const npc of crew) evacuateAbandonedRamp(npc, carrier)
    } })
    const { carrier } = abandoned
    for (const npc of crew) carrier.register(npc)
    expect(carrier.platform.size).toBe(5)
    const blocker = bodyAhead(carrier.position, 0, 1, .3)
    expect(carrier.canMove(.1, [], [blocker])).toBe(false)
    for (let frame = 0; frame < 100; frame++) carrier.update(.1, [], [blocker])
    expect(abandoned.states).toEqual(['PUSHING', 'ABANDONED'])
    expect(carrier.platform.size).toBe(0)
    expect(carrier.obstacles.every(obstacle => obstacle.navigationPassable === false)).toBe(true)
    expect(carrier.controller.alivePushers).toBe(4)
    expect(crew.every(npc => npc.siegeTransport === null && npc.siegeTransportSpeed === 0 && npc.tacticalOrder === 'defend')).toBe(true)
    expect(crew.filter(npc => npc.dead)).toHaveLength(1)
    expect(crew.slice(0, 4).every(npc => npc.siegeEvacuation === null)).toBe(true)
    const surface = carrier.surface
    for (const npc of crew.slice(4, 9)) {
      const target = npc.siegeEvacuation!
      expect(target.z).toBeLessThan(0)
      expect(Math.abs(target.x)).toBeLessThan(surface.halfWidth)
      expect(target.y).toBe(getTerrainHeight(target.x, target.z))
    }
    expect(crew[9].siegeEvacuation).toBeNull()
    carrier.controller.advance(20); carrier.controller.observeMovement(20, 0, 0, 0, 0)
    expect(abandoned.states).toEqual(['PUSHING', 'ABANDONED'])

    const restoredCrew = makeCrew()
    const restored = createSiegeCarrier({ placement, assignment, onChanged: () => { throw new Error('Abandonment replayed') } })
    restored.carrier.restore({ assignment, stagingZ: 30, position: { x: 0, y: 10, z: 30 },
      hp: 520, state: 'ABANDONED', distance: 0, dockingProgress: 0 })
    expect(restored.carrier.obstacles.every(obstacle => obstacle.navigationPassable === false)).toBe(true)
    const savedPositions = restoredCrew.map(npc => npc.position.clone())
    // Registration stops at the terminal-state gate: nothing is bound or moved.
    for (const npc of restoredCrew) restored.carrier.register(npc)
    expect(restored.carrier.platform.size).toBe(0)
    expect(restored.carrier.controller.advance(20)).toBe(0)
    restored.carrier.controller.observeMovement(20, 0, 0, 0, 0)
    expect(restored.carrier.controller.state).toBe('ABANDONED')
    expect(restoredCrew.map(npc => npc.position)).toEqual(savedPositions)
    // Conservative numeric side/front skirts leave only the actual rear walk
    // lane open. Exercise the production foot collider without an actor/model.
    const hull = { box: new Box3(new Vector3(-2.5, -10, 0), new Vector3(2.5, 10, 30)),
      walkSurface: surface, solidBelow: -10, isBarricade: true, navigationPassable: true }
    const obstacles: ObstacleData[] = [hull,
      { box: new Box3(new Vector3(-2.7, -10, 0), new Vector3(-2.5, 10.9, 30)), isBarricade: true },
      { box: new Box3(new Vector3(2.5, -10, 0), new Vector3(2.7, 10.9, 30)), isBarricade: true },
      { box: new Box3(new Vector3(-2.5, -10, 29.9), new Vector3(2.5, 9.75, 30.1)), isBarricade: true },
    ]
    interface FootFrame { group: { position: Vector3; rotation: { x: number } }; velY: number; onGround: boolean; playableWorldBound: number }
    const foot = NPC.prototype as unknown as { _updateFootPhysics(this: FootFrame, previous: Vector3, dt: number, obstacles: ObstacleData[]): void }
    const previous = new Vector3(), direction = new Vector3()
    for (const npc of crew.slice(4, 9)) {
      const target = npc.siegeEvacuation!
      const frame: FootFrame = { group: { position: npc.position, rotation: { x: 0 } }, velY: 0, onGround: true, playableWorldBound: 300 }
      for (let step = 0; step < 180 && npc.position.distanceTo(target) > .3; step++) {
        previous.copy(npc.position)
        direction.copy(target).sub(npc.position).setY(0).normalize()
        npc.position.addScaledVector(direction, .2)
        foot._updateFootPhysics.call(frame, previous, .1, obstacles)
      }
      expect(npc.position.distanceTo(target)).toBeLessThan(.3)
      expect(npc.position.y).toBeCloseTo(getTerrainHeight(npc.position.x, npc.position.z))
      npc.siegeEvacuation = null
      evacuateAbandonedRamp(npc, { assignment, surface })
      expect(npc.siegeEvacuation).toBeNull()
    }
  })

  it('releases only complete fixed escort groups from their own living gate-range and bounded ramp observations', () => {
    const assignments = commanderCavalryEscortAssignments('escort'), initial = createCommanderCavalryEscort('escort')
    const roster = createCommanderFourGateDefenseRoster('escort', 'roman')
    expect(new Set(assignments.map(a => a.actorId))).toEqual(new Set(roster.cavalry.map(actor => actor.actorId)))
    expect(assignments.filter(a => a.gateId === 'north' && a.side === -1).map(a => a.slot)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(assignments.filter(a => a.gateId === 'north' && a.side === 1).map(a => a.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    const actors = new Map<string, CommanderCavalryEscortActorFrame>(assignments.map(a => {
      const gate = TOWN_GATES.find(g => g.id === a.gateId)!
      return [a.actorId, { dead: false, position: { x: gate.x + 120, z: gate.z } }]
    }))
    const ramps = new Map<TownSiegeRampId, CommanderCavalryEscortRampFrame>(assignments.map(a => {
      const gate = TOWN_GATES.find(g => g.id === a.gateId)!
      return [a.rampId, { state: 'PUSHING', position: { x: gate.x + 120, z: gate.z }, distance: 0, alivePushers: 4 }]
    }))
    const north = assignments.filter(a => a.gateId === 'north' && a.side === -1)
    actors.get(north[0].actorId)!.position = { x: 100.001, z: -115 }
    actors.get(north[1].actorId)!.position = { x: 0, z: -115 }
    actors.get(north[1].actorId)!.dead = true
    const movingRear = { x: 270, z: 62 }, inward = { x: -1, z: 0 }
    expect(commanderCavalryEscortTarget(0, movingRear, inward)).toEqual({ x: 276, z: 59.5, yaw: -Math.PI / 2 })
    movingRear.x -= 13
    expect(commanderCavalryEscortTarget(7, movingRear, inward)).toEqual({ x: 275, z: 63.5, yaw: -Math.PI / 2 })
    const waiting = advanceCommanderCavalryEscort(initial, 19.75, actors, ramps)
    expect(waiting.releasedActorIds).toEqual([])
    expect(initial.groups['town-siege-ramp:north:left'].stallSeconds).toBe(0)

    actors.get(north[0].actorId)!.position.x = 100
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
    const npc = { combatantId: north[0].actorId, dead: false, combatPosition: { x: 0, z: -215 }, missionMovement: true,
      setMissionCombatTarget(value: unknown) { expect(value).toBeUndefined(); effects.push('target') },
      setTacticalOrder(order: string) { effects.push(order) } }
    interface ReleaseEntry {
      state: { cavalryEscort: typeof initial; enemyRosterVersion: 2 }
      pendingEscortReleases?: readonly string[]
      updateCavalryEscort(dt: number): void
    }
    const owner = Object.assign(Object.create(CommanderFourGateDefenseController.prototype) as ReleaseEntry, {
      state: { cavalryEscort: initial, enemyRosterVersion: 2 }, enemies: [npc], actorsById: new Map([[npc.combatantId, npc]]), escortAssignments: [],
      fourGateSiege: { ramps: new Map([[north[0].rampId, { position: { x: 0, z: -165 },
        controller: { state: 'PUSHING', distance: 0, alivePushers: 4 } }]]), resumeExternalMovement() { effects.push('route') } },
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

  it('releases trailing cavalry when their own ramp front reaches the hundred-metre gate radius', () => {
    const assignments = commanderCavalryEscortAssignments('convoy'), initial = createCommanderCavalryEscort('convoy')
    const north = assignments.filter(a => a.gateId === 'north' && a.side === -1)
    const actors = new Map<string, CommanderCavalryEscortActorFrame>(north.map(a => [a.actorId,
      { dead: false, position: { x: 30, z: -215 } }]))
    const ramp: CommanderCavalryEscortRampFrame = {
      state: 'PUSHING', position: { x: 0, z: -215.001 }, distance: 10, alivePushers: 4,
    }
    const ramps = new Map<TownSiegeRampId, CommanderCavalryEscortRampFrame>([[north[0].rampId, ramp]])
    const waiting = advanceCommanderCavalryEscort(initial, 0, actors, ramps)
    expect(waiting.releasedActorIds).toEqual([])
    ramp.position.z = -215
    const released = advanceCommanderCavalryEscort(waiting.checkpoint, 0, actors, ramps)
    expect(released.releasedActorIds).toEqual(north.map(a => a.actorId))
    expect(released.checkpoint.groups[north[0].rampId].releaseReason).toBe('gate-range')
    expect(assignments.filter(a => a.rampId !== north[0].rampId).every(a => released.checkpoint.actors[a.actorId].mode === 'escort')).toBe(true)
    expect(advanceCommanderCavalryEscort(released.checkpoint, 0, actors, ramps).releasedActorIds).toEqual([])
  })

  it('keeps each ten-man infantry guard on its own vehicle until it docks, behind the lancers and independent of their 100m release', () => {
    const assignments = commanderInfantryEscortAssignments('guard'), initial = createCommanderInfantryEscort('guard')
    expect(assignments).toHaveLength(80)
    expect(assignments.filter(a => a.rampId === 'town-siege-ramp:east:right').map(a => a.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(assignments[0].actorId).toBe('guard:north:left:escort:infantry:1')
    // Slots sit strictly behind the last lancer row (6 + 3*4m) and never share a cell with a lancer slot.
    const rear = { x: 270, z: 62 }, inward = { x: -1, z: 0 }
    const lancers = Array.from({ length: 8 }, (_, slot) => commanderCavalryEscortTarget(slot, rear, inward))
    const guards = Array.from({ length: 10 }, (_, slot) => commanderInfantryEscortTarget(slot, rear, inward))
    for (const g of guards) for (const l of lancers) expect(Math.hypot(g.x - l.x, g.z - l.z)).toBeGreaterThan(3.5)
    expect(Math.min(...guards.map(g => g.x - rear.x))).toBeGreaterThanOrEqual(COMMANDER_INFANTRY_ESCORT.firstRowBehind)

    const actors = new Map<string, { dead: boolean }>(assignments.map(a => [a.actorId, { dead: false }]))
    const ramps = new Map<TownSiegeRampId, CommanderCavalryEscortRampFrame>(assignments.map(a => {
      const gate = TOWN_GATES.find(g => g.id === a.gateId)!
      return [a.rampId, { state: 'PUSHING', position: { x: gate.x, z: gate.z }, distance: 0, alivePushers: 4 }]
    }))
    // A ramp already inside the lancers' gate radius releases no infantry.
    expect(advanceCommanderInfantryEscort(initial, 0, actors, ramps).releasedActorIds).toEqual([])
    ramps.get('town-siege-ramp:north:left')!.state = 'DOCKED'
    ramps.get('town-siege-ramp:south:left')!.state = 'DESTROYED'
    ramps.get('town-siege-ramp:south:right')!.state = 'ABANDONED'
    ramps.get('town-siege-ramp:east:left')!.alivePushers = 0
    for (const a of assignments.filter(a => a.rampId === 'town-siege-ramp:east:right')) actors.get(a.actorId)!.dead = true
    const advanced = advanceCommanderInfantryEscort(initial, 0, actors, ramps)
    const expected = { 'town-siege-ramp:north:left': 'ramp-docked', 'town-siege-ramp:south:left': 'ramp-destroyed',
      'town-siege-ramp:south:right': 'ramp-abandoned', 'town-siege-ramp:east:left': 'no-pushers', 'town-siege-ramp:east:right': 'group-dead' }
    expect(Object.fromEntries(Object.entries(advanced.checkpoint.groups).filter(([, g]) => g.releaseReason).map(([id, g]) => [id, g.releaseReason]))).toEqual(expected)
    expect(new Set(advanced.releasedActorIds)).toEqual(new Set(assignments.filter(a => a.rampId in expected).map(a => a.actorId)))
    expect(advanced.checkpoint.actors['guard:north:right:escort:infantry:1'].mode).toBe('escort')
    // The shared 0.5m/20s fallback applies, and a released group never regroups.
    const stalled = advanceCommanderInfantryEscort(advanced.checkpoint, 20, actors, ramps)
    expect(stalled.checkpoint.groups['town-siege-ramp:west:left']).toMatchObject({ stallSeconds: 20, releaseReason: 'stalled' })
    expect(advanceCommanderInfantryEscort(stalled.checkpoint, 5, actors, ramps).releasedActorIds).toEqual([])
    const persisted = parseCommanderInfantryEscort(JSON.parse(JSON.stringify(stalled.checkpoint)), 'guard')!
    expect(persisted).toEqual(stalled.checkpoint)
    const regrouped = { ...persisted, actors: { ...persisted.actors, [assignments[0].actorId]: { ...persisted.actors[assignments[0].actorId], mode: 'escort' as const } } }
    expect(parseCommanderInfantryEscort(regrouped, 'guard')).toBeUndefined()
  })

  it('plans full edge approaches with finite walkable ramps and six deck riders plus four ground pushers', () => {
    const slots = createTownSiegeCrewSlots('viking'), assignments = allocateTownSiegeCrews(slots)
    const duplicate = structuredClone(slots); duplicate[10].spec.actorId = duplicate[0].spec.actorId
    expect(() => allocateTownSiegeCrews(duplicate)).toThrow('Invalid Town siege crew')
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
    lifecycle.observeMovement(20, 0, 0, 0, 0); expect(lifecycle.state).toBe('DOCKING')
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
    const assignment = crewAssignment('town-siege-ramp:east:left')
    const placement = rampPlacement({ id: assignment.id, start: new Vector3(191.9, 12, 62), dirX: -1, dirZ: 0, travel: 40, length: 20 })
    const { carrier, shared, states, render, damageable } = createSiegeCarrier({ placement, assignment })
    const crew = [...assignment.pusherIds, ...assignment.assaultIds].map((id, index) =>
      createCrewDouble(id, index < 4 ? 195.5 : 194, 12, 62))
    for (const actor of crew) carrier.register(actor)
    const passenger = crew[4], controller = carrier.controller
    carrier.update(.1, [])
    expect(carrier.position.x).toBeCloseTo(191.42); expect(carrier.position.z).toBe(62)
    expect(crew[0].position.x).toBeCloseTo(195.02); expect(crew[0].position.z).toBe(62)
    expect(passenger.position.x).toBeCloseTo(193.52); expect(passenger.position.z).toBe(62)
    expect(carrier.platform.position).toEqual(carrier.position)
    const withdrawn = crew[0], alighted = crew[5]
    carrier.releaseCrew(withdrawn); carrier.releaseCrew(alighted)
    const releasedPosition = withdrawn.position.clone(), alightedPosition = alighted.position.clone()
    carrier.update(.1, [])
    expect(controller.alivePushers).toBe(3)
    expect(carrier.position.x).toBeCloseTo(191.06)
    expect(withdrawn.position).toEqual(releasedPosition)
    expect(alighted.position).toEqual(alightedPosition)
    expect(withdrawn.siegeTransport).toBeNull(); expect(withdrawn.siegeTransportSpeed).toBe(0)
    expect(() => controller.register(withdrawn)).toThrow('Invalid siege crew registration')
    // The departed actor now has ordinary body ownership and must stop the convoy;
    // a crew member standing on the same spot is still exempt.
    const front = bodyAhead(carrier.position, -1, 0, .6).position
    crew[1].position.copy(front)
    expect(carrier.canMove(.1, [crew[1]], [])).toBe(true)
    withdrawn.position.copy(front)
    const stoppedAt = carrier.position.clone()
    carrier.update(.1, [withdrawn])
    expect(carrier.position).toEqual(stoppedAt)
    expect(controller.currentSpeed).toBe(0)
    // Three live pushers advance at three quarters of the full 0.48 m per 0.1 s frame.
    const distanceBefore = controller.distance
    for (let frame = 0; frame < 10; frame++) carrier.update(.1, [])
    expect(controller.state).toBe('PUSHING')
    expect(controller.distance).toBeCloseTo(distanceBefore + 10 * .36)
    // Destruction releases riders into a fall, hides the carrier and frees its collision volumes.
    damageable.takeDamage(520)
    expect(states).toEqual(['PUSHING', 'DESTROYED'])
    expect(render.hides).toBe(1)
    expect(passenger.falls).toHaveLength(1); expect([crew[1], alighted].map(actor => actor.falls.length)).toEqual([0, 0])
    expect(shared).toEqual([])
    const stoppedDistance = controller.distance
    carrier.update(20, [])
    expect(controller.distance).toBe(stoppedDistance)
  })

  it('restores a destroyed carrier as hidden and collision-free without replaying transitions', () => {
    const assignment = crewAssignment('siege-ramp-left')
    const placement = rampPlacement({ id: assignment.id, start: new Vector3(0, 10, -15), travel: 40, length: 20, dirZ: 1 })
    const neighbor: ObstacleData = { box: new Box3(), isBarricade: true }
    const { carrier, shared, states, render, damageable, root } = createSiegeCarrier({ placement, assignment, neighbors: [neighbor],
      onChanged: state => { throw new Error(`restore replayed ${state}`) } })
    expect(shared).toEqual([neighbor, ...carrier.obstacles])
    const saved = { assignment, stagingZ: -40, position: { x: 0, y: 10, z: -15 }, hp: 0,
      state: 'DESTROYED' as const, distance: 25, dockingProgress: 0 }
    carrier.restore(saved); carrier.restore(saved)
    expect(root.visible).toBe(false); expect(root.removals).toBe(1)
    expect(damageable.destroyed).toBe(true); expect(damageable.currentHp).toBe(0)
    expect(shared).toEqual([neighbor])
    expect(carrier.position).toEqual(new Vector3(0, 10, -15)); expect(carrier.controller.state).toBe('DESTROYED')
    carrier.controller.observeMovement(20, 0, 0, 0, 0); expect(carrier.controller.state).toBe('DESTROYED')
    expect(states).toEqual([]); expect(render.hides).toBe(0)
  })

  it('mirrors a host carrier at its reported distance, walks its docked bridge and removes it once the host destroys it', () => {
    const assignment = crewAssignment('siege-ramp-left')
    const placement = rampPlacement({ id: assignment.id, start: new Vector3(0, 10, -15), travel: 40, length: 20, dirZ: 1 })
    const neighbor: ObstacleData = { box: new Box3(), isBarricade: true }
    const { carrier, shared, states, render, damageable } = createSiegeCarrier({ placement, assignment, neighbors: [neighbor] })
    // No crew is registered on a co-op guest: the host's distance alone places the vehicle.
    carrier.mirror({ state: 'PUSHING', distance: 12, dockingProgress: 0, hp: 400 })
    expect(carrier.position.x).toBe(0); expect(carrier.position.z).toBe(-3)
    expect(carrier.position.y).toBeCloseTo(siegeRampDeckHeightAt(placement, 0, -3), 6)
    expect(carrier.surface.startZ).toBeCloseTo(placement.surface.startZ - 28, 6)
    expect(damageable.currentHp).toBe(400); expect(carrier.bridgeSurface.mounted).toBe(false)
    carrier.mirror({ state: 'DOCKED', distance: 40, dockingProgress: 1, hp: 400 })
    expect(carrier.position.z).toBe(25); expect(carrier.bridgeSurface.mounted).toBe(true)
    expect(shared).toEqual([neighbor, ...carrier.obstacles])
    carrier.mirror({ state: 'DESTROYED', distance: 40, dockingProgress: 1, hp: 0 })
    expect(damageable.destroyed).toBe(true); expect(render.hides).toBe(1); expect(shared).toEqual([neighbor])
    carrier.mirror({ state: 'PUSHING', distance: 5, dockingProgress: 0, hp: 400 })
    expect(carrier.position.z).toBe(25); expect(states).toEqual(['DESTROYED'])
  })

  it('unifies all formal Outpost missions on latest walkways while disabling mobile siege ramps for relief', () => {
    for (const careerMissionKind of [
      'outpost-defense',
      'outpost-relief',
      'captain-outpost-defense',
      'veteran-outpost-defense',
      'veteran-outpost-assault',
      'commander-outpost-last-stand',
    ] as const) {
      const config = {
        type: 'defense',
        careerMissionId: `${careerMissionKind}:test`,
        careerMissionKind,
        ...(careerMissionKind === 'outpost-relief' ? { careerReliefPhase: 'advance' as const } : {}),
      } as DefenseCampaignLaunchConfig
      expect(isOutpostWalkwayEnabled(config, false)).toBe(true)
      expect(isMobileSiegeRampEnabled(config)).toBe(careerMissionKind !== 'outpost-relief')
    }
    expect(isOutpostWalkwayEnabled({
      type: 'defense',
      careerMissionId: 'relief:charge',
      careerMissionKind: 'outpost-relief',
      careerReliefPhase: 'charge',
    }, false)).toBe(true)

    for (const faction of ['roman', 'viking'] as const) {
      const placement = getCampaignOutpostPlacement(faction)
      const layout = getOutpostWalkwayLayout(placement)
      expect(layout.bridge).not.toBeNull()
      // Gate breach corridor is 8m wide ([-4, 4]) and mounted cavalry height is 2.6m;
      // walkway bridge deck must stay comfortably above riders and bridge posts stay outside [-4, 4].
      expect(OUTPOST_WALKWAY.deckClearance - OUTPOST_WALKWAY.deckThickness).toBeGreaterThanOrEqual(4.0)
      expect(layout.bridge!.slab.min.x).toBeLessThanOrEqual(-4.0)
      expect(layout.bridge!.slab.max.x).toBeGreaterThanOrEqual(4.0)
      for (const post of layout.bridge!.posts) {
        expect(post.max.x <= -4.0 || post.min.x >= 4.0).toBe(true)
      }
    }
  })

})
