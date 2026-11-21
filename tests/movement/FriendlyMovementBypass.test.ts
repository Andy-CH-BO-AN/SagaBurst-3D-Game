import { expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { NPC, AIState } from '../../src/world/NPC'
import { PursuitBlockList } from '../../src/navigation/PursuitBlockList'
import type { TacticalOrder } from '../../src/battle/TacticalOrder'
import { NavigationPathFollower } from '../../src/navigation/NavigationPathFollower'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { findBlockingObstacleAlongPath } from '../../src/world/Terrain'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
import { commanderCavalryEscortAssignments, createCommanderCavalryEscort } from '../../src/career/CommanderCavalryEscort'
import { Faction } from '../../src/combat/CombatFaction'
import { FriendlyMovementBypass, type BypassActor } from '../../src/navigation/FriendlyMovementBypass'
import { createFormationTarget, formationCheckpoint, refreshFormationTarget, type FormationTarget } from '../../src/battle/FormationOrder'

function actor(id: string, x: number, z: number): BypassActor {
  return { combatantId: id, combatPosition: new Vector3(x, 0, z), faction: Faction.TOWN, dead: false, isMounted: false }
}

it('recovers behind a moving Follow goal, keeps the open side, then resumes the caller goal', () => {
  const bypass = new FriendlyMovementBypass(), self = actor('captain', 0, 0), goal = new Vector3(0, 0, 10)
  const neighbors = [self, actor('guard-left', -1, 1.5), actor('guard-right', 1, 1.5)]
  const direction = new Vector3(0, 0, 1)
  // A wall closes the negative-X side; the real selector must choose positive X.
  const clear = (a: Vector3, b: Vector3) => a.x >= 0 && b.x >= 0
  expect(bypass.steer(0, self, goal, direction, neighbors, clear)).toBe(false)
  // The leader marches at 6m/s while this follower is completely blocked.
  goal.z += 3.6
  expect(bypass.steer(.6, self, goal, direction, neighbors, clear)).toBe(false)
  goal.z += 3.6
  expect(bypass.steer(.6, self, goal, direction, neighbors, clear)).toBe(true)
  expect(direction.x).toBeGreaterThan(0)
  let completed = false
  let expectedGoalZ = goal.z
  for (let i = 0; i < 180; i++) {
    expectedGoalZ += .3; goal.z = expectedGoalZ
    direction.copy(goal).sub(self.combatPosition).setY(0).normalize()
    const active = bypass.steer(.05, self, goal, direction, neighbors, clear)
    expect(goal).toEqual(new Vector3(0, 0, expectedGoalZ))
    if (!active) { completed = true; break }
    self.combatPosition.addScaledVector(direction, .15)
    expect(self.combatPosition.x).toBeGreaterThanOrEqual(0)
    for (const other of neighbors.slice(1)) expect(self.combatPosition.distanceTo(other.combatPosition)).toBeGreaterThan(.92)
  }
  expect(completed).toBe(true)
  expect(self.combatPosition.z).toBeGreaterThan(3)
  expect(goal.z).toBe(expectedGoalZ)
})

it('ignores lateral jitter after forward progress and bounds the resulting recovery', () => {
  const bypass = new FriendlyMovementBypass(), self = actor('referee', 0, 0), goal = new Vector3(0, 0, 12)
  const direction = new Vector3(0, 0, 1), nearby = [self, actor('guard', 0, 3)]
  const clear = () => true
  expect(bypass.steer(.6, self, goal, direction, nearby, clear)).toBe(false)
  self.combatPosition.z = .8
  expect(bypass.steer(.6, self, goal, direction, nearby, clear)).toBe(false)
  expect(direction).toEqual(new Vector3(0, 0, 1))
  const previousDistance = self.combatPosition.distanceTo(goal)
  self.combatPosition.x = .8
  expect(self.combatPosition.distanceTo(goal)).toBeGreaterThan(previousDistance)
  expect(bypass.steer(1.2, self, goal, direction, nearby, clear)).toBe(true)
  expect(bypass.steer(8.1, self, goal, direction, nearby, clear)).toBe(false)
  expect(goal).toEqual(new Vector3(0, 0, 12))
})


type EscortActor = BypassActor & Pick<NPC, 'missionMovement' | 'setMissionCombatTarget' | 'assignSiegeObstacle'
  | 'combatFormationCheckpoint' | 'refreshFormationTarget' | 'assignFormationTarget'>

it('keeps blocked mounted escort recovery through moving-slot refreshes while invalidating its old path', () => {
  const assignment = commanderCavalryEscortAssignments('moving-escort')[0], initial = createCommanderCavalryEscort('moving-escort')
  // The live order is the real FormationOrder; the escort's path follower is its navigation-reset port.
  const order = createFormationTarget(-4900, new Vector3(1, 0, -250), new Vector3(0, 0, 1), 4.8, 'defend')
  const path = new NavigationPathFollower(), bypass = new FriendlyMovementBypass()
  const reassigned: number[] = []
  const escort: EscortActor = { ...actor(assignment.actorId, 1, -260), isMounted: true, missionMovement: true,
    setMissionCombatTarget() {}, assignSiegeObstacle() {},
    get combatFormationCheckpoint() { return formationCheckpoint(order) },
    refreshFormationTarget: (commandId, position, facing, speedLimit, arrivalOrder) =>
      refreshFormationTarget(order, 'defend', commandId, position, facing, speedLimit, arrivalOrder, path),
    assignFormationTarget: commandId => { reassigned.push(commandId) } }
  const ramp = { surface: { startX: 3.5, startZ: -244, dirX: 0, dirZ: 1 }, position: new Vector3(3.5, 0, -225),
    controller: { state: 'PUSHING', distance: 0, alivePushers: 4, currentSpeed: 4.8 } }
  interface EscortFrame { updateCavalryEscort(dt: number): void }
  const controller = Object.assign(Object.create(CommanderFourGateDefenseController.prototype) as EscortFrame, {
    state: { cavalryEscort: initial, actors: {} }, enemies: [escort], actorsById: new Map([[assignment.actorId, escort]]),
    escortAssignments: [assignment], fourGateSiege: { ramps: new Map([[assignment.rampId, ramp]]) },
  })
  const nearby = [{ ...actor('mounted-blocker', 1, -258.2), isMounted: true }], direction = new Vector3(0, 0, 1)
  const rock = { box: new Box3(new Vector3(-4.15, -2, -261.35), new Vector3(-.85, 3, -258.65)), isBarricade: false }
  const clear = (a: Vector3, b: Vector3) => !findBlockingObstacleAlongPath(a, b, 1.2, 2.6, 0, [rock])
  const navigation = new NavigationWorld({ minX: -10, maxX: 10, minZ: -270, maxZ: -230 })
  navigation.sync([rock]); navigation.beginFrame()
  const pathTarget = new Vector3()
  path.resolveMoveTarget(escort.combatPosition, order.position, navigation, true, pathTarget)
  const originalQuery = navigation.queryPath.bind(navigation)
  let queries = 0
  navigation.queryPath = (...args) => { queries++; return originalQuery(...args) }
  let recovering = false
  for (let frame = 0; frame < 6; frame++) {
    ramp.surface.startZ += 1.2; ramp.controller.distance += 1.2
    controller.updateCavalryEscort(.25)
    const goal = order.position
    if (frame === 0) {
      // The first 1.2m refresh stays in the same goal cache group. It must
      // still invalidate the previous endpoint's path, not rely on that group.
      path.resolveMoveTarget(escort.combatPosition, goal, navigation, true, pathTarget)
      expect(queries).toBe(1)
    }
    direction.copy(goal).sub(escort.combatPosition).setY(0).normalize()
    recovering = bypass.steer(.25, escort, goal, direction, nearby, clear)
  }
  expect(recovering).toBe(true)
  expect(direction.x).toBeGreaterThan(.9)
  // Each moving slot refreshed the same order; a reassignment would have reset recovery.
  expect(reassigned).toEqual([])
  expect(escort.combatFormationCheckpoint).toMatchObject({ commandId: -4900, reached: false, speedLimit: 4.8, arrivalOrder: 'defend' })
  expect(escort.combatFormationCheckpoint!.position.z).toBeCloseTo(-242.8)
})

/** NPC's own order entries on movement data; rampart, equipment and visual effects are inert ports. */
function formationActor(id: string) {
  const pathResets = { count: 0 }
  const body = {
    ...actor(id, 1, -260), isMounted: true, tacticalOrder: 'defend' as TacticalOrder, state: AIState.CHASE,
    formationTarget: createFormationTarget(-4900, new Vector3(1, 0, -250), new Vector3(0, 0, 1), 4.8, 'defend') as FormationTarget | null,
    _navigationPath: { clear() { pathResets.count++ } }, _friendlyBypass: new FriendlyMovementBypass(),
    _detourActive: true, _detourObstacle: null, _detourStuckElapsed: .6, followNavigationGoal: new Vector3(),
    assignedSiegeObstacle: null, pursuitBlockedTargets: new PursuitBlockList<NPC>(),
    _clearNavigationPath: NPC.prototype['_clearNavigationPath'],
    _clearObstacleDetour: NPC.prototype['_clearObstacleDetour'],
    _clearSiegeFallback: NPC.prototype['_clearSiegeFallback'],
    _resetFollowNavigation: NPC.prototype['_resetFollowNavigation'],
    assignSiegeObstacle: NPC.prototype.assignSiegeObstacle,
    assignFormationTarget: NPC.prototype.assignFormationTarget,
    refreshFormationTarget: NPC.prototype.refreshFormationTarget,
    releaseOutpostRampartGarrison() {}, _cancelEquipmentCombatState() {}, _restoreCombatReadyRangedVisual() {},
  }
  return { body, npc: body as unknown as NPC, pathResets }
}

it('rejects a different or completed order refresh and resets recovery for the actual new order', () => {
  const { body, npc, pathResets } = formationActor('orders'), direction = new Vector3(0, 0, 1)
  const blocker = { ...actor('guard', 1, -258.2), isMounted: true }, clear = () => true
  const original = body.formationTarget!
  expect(body._friendlyBypass.steer(1.2, body, original.position, direction, [blocker], clear)).toBe(true)
  expect(npc.refreshFormationTarget(-4901, new Vector3(1, 0, -240), direction, 3, 'defend')).toBe(false)
  expect(body.formationTarget).toBe(original)
  expect(pathResets.count).toBe(0)
  // The same live order moves its endpoint and replans, keeping local recovery.
  expect(npc.refreshFormationTarget(-4900, new Vector3(1, 0, -248), new Vector3(0, 0, 1), 4.8, 'defend')).toBe(true)
  expect([original.position.z, pathResets.count, body._detourActive, body._detourStuckElapsed]).toEqual([-248, 1, true, .6])
  expect(body._friendlyBypass.steer(.1, body, original.position, direction, [blocker], clear)).toBe(true)
  npc.assignFormationTarget(-4901, new Vector3(1, 0, -240), new Vector3(0, 0, 1), 3, 'defend')
  expect(body._detourActive).toBe(false)
  direction.set(0, 0, 1)
  expect(body._friendlyBypass.steer(.6, body, body.formationTarget!.position, direction, [blocker], clear)).toBe(false)
  expect(body._friendlyBypass.steer(.6, body, body.formationTarget!.position, direction, [blocker], clear)).toBe(true)
  body.formationTarget = null
  expect(npc.refreshFormationTarget(-4901, new Vector3(1, 0, -230), direction, 3, 'defend')).toBe(false)
  expect(body.formationTarget).toBeNull()
})
