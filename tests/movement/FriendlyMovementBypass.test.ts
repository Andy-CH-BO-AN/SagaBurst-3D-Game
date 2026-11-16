import { expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { NPC, AIState } from '../../src/world/NPC'
import type { TacticalOrder } from '../../src/battle/TacticalOrder'
import { NavigationPathFollower } from '../../src/navigation/NavigationPathFollower'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { findBlockingObstacleAlongPath } from '../../src/world/Terrain'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
import { commanderCavalryEscortAssignments, createCommanderCavalryEscort } from '../../src/career/CommanderCavalryEscort'
import { Faction } from '../../src/combat/CombatFaction'
import { FriendlyMovementBypass, type BypassActor } from '../../src/navigation/FriendlyMovementBypass'

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


/** Only movement-order data and non-movement effect ports; no NPC/model constructor. */
function formationActor(id: string) {
  const body = {
    ...actor(id, 1, -260), isMounted: true, tacticalOrder: 'defend' as TacticalOrder, state: AIState.CHASE,
    formationTarget: { commandId: -4900, position: new Vector3(1, 0, -250), facing: new Vector3(0, 0, 1),
      reached: false, speedLimit: 4.8, arrivalOrder: 'defend' as TacticalOrder } as {
        commandId: number; position: Vector3; facing: Vector3; reached: boolean; speedLimit?: number; arrivalOrder?: TacticalOrder
      } | null,
    _navigationPath: new NavigationPathFollower(), _friendlyBypass: new FriendlyMovementBypass(),
    _detourActive: true, _detourObstacle: null, _detourStuckElapsed: .6, followNavigationGoal: new Vector3(),
    assignedSiegeObstacle: null, missionCombatTarget: null,
    _clearNavigationPath: NPC.prototype['_clearNavigationPath'],
    _clearObstacleDetour: NPC.prototype['_clearObstacleDetour'],
    _clearSiegeFallback: NPC.prototype['_clearSiegeFallback'],
    _resetFollowNavigation: NPC.prototype['_resetFollowNavigation'],
    assignSiegeObstacle: NPC.prototype.assignSiegeObstacle,
    setMissionCombatTarget: NPC.prototype.setMissionCombatTarget,
    assignFormationTarget: NPC.prototype.assignFormationTarget,
    refreshFormationTarget: NPC.prototype.refreshFormationTarget,
    releaseOutpostRampartGarrison() {}, _cancelEquipmentCombatState() {}, _restoreCombatReadyRangedVisual() {},
    get combatFormationCheckpoint(): NPC['combatFormationCheckpoint'] {
      const target = this.formationTarget
      return target ? { commandId: target.commandId, position: { x: target.position.x, y: target.position.y,
        z: target.position.z, yaw: 0 }, reached: target.reached, speedLimit: target.speedLimit, arrivalOrder: target.arrivalOrder } : undefined
    },
  }
  return { body, npc: body as unknown as NPC }
}

it('keeps blocked mounted escort recovery through moving-slot refreshes while invalidating its old path', () => {
  const assignment = commanderCavalryEscortAssignments('moving-escort')[0]
  const { body, npc } = formationActor(assignment.actorId), initial = createCommanderCavalryEscort('moving-escort')
  const ramp = { surface: { startX: 3.5, startZ: -244, dirX: 0, dirZ: 1 }, position: new Vector3(3.5, 0, -225),
    controller: { state: 'PUSHING', distance: 0, alivePushers: 4, currentSpeed: 4.8 } }
  interface EscortFrame { updateCavalryEscort(dt: number): void }
  const controller = Object.assign(Object.create(CommanderFourGateDefenseController.prototype) as EscortFrame, {
    state: { cavalryEscort: initial, actors: {} }, enemies: [npc], actorsById: new Map([[assignment.actorId, npc]]),
    escortAssignments: [assignment], fourGateSiege: { ramps: new Map([[assignment.rampId, ramp]]) },
  })
  const nearby = [{ ...actor('mounted-blocker', 1, -258.2), isMounted: true }], direction = new Vector3(0, 0, 1)
  const rock = { box: new Box3(new Vector3(-4.15, -2, -261.35), new Vector3(-.85, 3, -258.65)), isBarricade: false }
  const clear = (a: Vector3, b: Vector3) => !findBlockingObstacleAlongPath(a, b, 1.2, 2.6, 0, [rock])
  const navigation = new NavigationWorld({ minX: -10, maxX: 10, minZ: -270, maxZ: -230 })
  navigation.sync([rock]); navigation.beginFrame()
  const pathTarget = new Vector3()
  body._navigationPath.resolveMoveTarget(body.combatPosition, body.formationTarget!.position, navigation, true, pathTarget)
  const originalQuery = navigation.queryPath.bind(navigation)
  let queries = 0
  navigation.queryPath = (...args) => { queries++; return originalQuery(...args) }
  let recovering = false
  for (let frame = 0; frame < 6; frame++) {
    ramp.surface.startZ += 1.2; ramp.controller.distance += 1.2
    controller.updateCavalryEscort(.25)
    const goal = body.formationTarget!.position
    if (frame === 0) {
      // The first 1.2m refresh stays in the same goal cache group. It must
      // still invalidate the previous endpoint's path, not rely on that group.
      body._navigationPath.resolveMoveTarget(body.combatPosition, goal, navigation, true, pathTarget)
      expect(queries).toBe(1)
    }
    direction.copy(goal).sub(body.combatPosition).setY(0).normalize()
    recovering = body._friendlyBypass.steer(.25, body, goal, direction, nearby, clear)
  }
  expect(recovering).toBe(true)
  expect(direction.x).toBeGreaterThan(.9)
  expect(body._detourActive).toBe(true)
  expect(body._detourStuckElapsed).toBe(.6)
  expect(body.formationTarget).toMatchObject({ commandId: -4900, reached: false, speedLimit: 4.8, arrivalOrder: 'defend' })
  expect(body.formationTarget!.position.z).toBeCloseTo(-242.8)
})

it('rejects a different or completed order refresh and resets recovery for the actual new order', () => {
  const { body, npc } = formationActor('orders'), direction = new Vector3(0, 0, 1)
  const blocker = { ...actor('guard', 1, -258.2), isMounted: true }, clear = () => true
  const original = body.formationTarget!
  expect(body._friendlyBypass.steer(1.2, body, original.position, direction, [blocker], clear)).toBe(true)
  expect(npc.refreshFormationTarget(-4901, new Vector3(1, 0, -240), direction, 3, 'defend')).toBe(false)
  expect(body.formationTarget).toBe(original)
  npc.assignFormationTarget(-4901, new Vector3(1, 0, -240), new Vector3(0, 0, 1), 3, 'defend')
  expect(body._detourActive).toBe(false)
  direction.set(0, 0, 1)
  expect(body._friendlyBypass.steer(.6, body, body.formationTarget!.position, direction, [blocker], clear)).toBe(false)
  expect(body._friendlyBypass.steer(.6, body, body.formationTarget!.position, direction, [blocker], clear)).toBe(true)
  body.formationTarget = null
  expect(npc.refreshFormationTarget(-4901, new Vector3(1, 0, -230), direction, 3, 'defend')).toBe(false)
  expect(body.formationTarget).toBeNull()
})
