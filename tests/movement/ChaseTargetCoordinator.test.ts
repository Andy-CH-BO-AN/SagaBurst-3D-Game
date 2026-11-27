import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { NavigationPathFollower } from '../../src/navigation/NavigationPathFollower'
import { LayeredNavigationRoute } from '../../src/navigation/LayeredNavigationRoute'
import { PursuitBlockList } from '../../src/navigation/PursuitBlockList'
import { TargetReacquireSchedule } from '../../src/navigation/TargetReacquireSchedule'
import { getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ChaseTargetCoordinator } from '../../src/navigation/ChaseTargetCoordinator'
import { AIState, Faction, NPC } from '../../src/world/NPC'
import { SpatialGrid } from '../../src/world/SpatialGrid'
import type { Player } from '../../src/player/Player'

function npc(
  x: number,
  z: number,
  faction: Faction,
  combatantId = '',
): NPC {
  return {
    combatPosition: new THREE.Vector3(x, 0, z),
    faction,
    combatantId,
    dead: false,
  } as NPC
}

describe('ChaseTargetCoordinator', () => {

  it('uses separate target lookups for different 4m chase groups', () => {
    const coordinator = new ChaseTargetCoordinator()
    const hostileGrid = new SpatialGrid<NPC>(20)
    hostileGrid.insert(npc(20, 0, Faction.ENEMY))

    const findNearest = vi.spyOn(hostileGrid, 'findNearest')
    coordinator.beginFrame()

    coordinator.findGroupTarget(npc(0.5, 0.5, Faction.PLAYER), hostileGrid)
    coordinator.findGroupTarget(npc(4.5, 0.5, Faction.PLAYER), hostileGrid)

    expect(findNearest).toHaveBeenCalledTimes(2)
  })
})

// The pursuit policies themselves (range, gate eligibility, block list, reacquire
// cadence) have their own seam tests. The cases below only prove NPC feeds them its
// real state; they borrow the NPC methods on animation-free actor data.

it('NPC 以地圖對角線判斷 Attack 接敵範圍，場景邊界改變、遭遇戰或飛行坐騎時收回', () => {
  const body = {
    tacticalOrder: 'attack', combatPosition: new THREE.Vector3(-200, 0, -200), playableWorldBound: 200,
    battlefieldEngagementRangeSq: null as number | null, encounterOrigin: null as THREE.Vector3 | null,
    mount: null as { isFlyingMount: boolean } | null, holdsRampartPosition: false, alertRange: 300,
  }
  const actor = body as unknown as NPC, corner = new THREE.Vector3(200, 80, 200)
  const optIn = () => NPC.prototype.enableBattlefieldEngagement.call(actor)
  const inRange = (chasing: boolean) => NPC.prototype['_isTargetWithinEngagementRange'].call(actor, corner, chasing)
  expect([inRange(false), inRange(true)]).toEqual([false, false])
  optIn()
  expect([inRange(false), inRange(true)]).toEqual([true, true])
  // A smaller scene bound shrinks the diagonal: a 424 m reach no longer spans the 566 m corner.
  body.playableWorldBound = 150
  optIn()
  expect([inRange(false), inRange(true)]).toEqual([false, false])
  body.playableWorldBound = 200
  optIn()
  body.encounterOrigin = new THREE.Vector3()
  expect(inRange(false)).toBe(false)
  body.encounterOrigin = null
  body.mount = { isFlyingMount: true }
  expect(inRange(true)).toBe(false)
})

/** Data-only adapter for the real sensor/cache owner, without actor construction. */
function pursuitActor(order: NPC['tacticalOrder'], phase = 0) {
  const methods = NPC.prototype, calls = { pathCleared: 0 }
  const body = {
    combatPosition: new THREE.Vector3(260, 0, 240), faction: Faction.PLAYER,
    tacticalOrder: order, playableWorldBound: 350, battlefieldEngagementRangeSq: null,
    isTownRampartGarrisonActive: false, holdsRampartPosition: false, alertRange: 300,
    hasActiveRangedWeapon: true, isMounted: true, mount: { isFlyingMount: false }, encounterOrigin: null,
    targetsPlayer: false, missionCombatTarget: undefined, playerHitFocus: 0, cavalryPassthroughTimer: 0,
    hasSiegeObstacle: false, _cachedTargetIsPlayer: false, _cachedTargetNpc: null,
    _targetAcquisitionInitialized: false, _initialStaggerPhase: phase, _rangedVisibleTargetHoldFrames: 0,
    targetReacquire: new TargetReacquireSchedule(),
    _liveTargetInfo: {}, _tmpTargetPosition: new THREE.Vector3(), pursuitBlockedTargets: new PursuitBlockList<NPC | Player>(),
    _activeNavigationWorld: { revision: 1, townNav: { siegeEntrances: { revision: 1 }, rampAt: () => undefined, isElevated: () => false } },
    _clearObstacleDetour: () => {}, _clearNavigationPath: () => { calls.pathCleared++ }, _clearSiegeFallback: () => {},
    _pursuitTargetAllowed: methods['_pursuitTargetAllowed'], _findTarget: methods['_findTarget'],
    _acquireTarget: methods['_acquireTarget'], _isCachedTargetValid: methods['_isCachedTargetValid'],
    _shouldRetainLayeredTarget: methods['_shouldRetainLayeredTarget'],
    _getCachedTargetDistance: methods['_getCachedTargetDistance'], _scheduleTargetReacquire: methods['_scheduleTargetReacquire'],
    _getPlayerPosition: methods['_getPlayerPosition'],
  }
  return { body, calls, actor: body as unknown as NPC }
}

it('NPC 依重掃節奏改選更近目標，無法抵達的目標被擱置並在入口改變後重新允許', () => {
  // Phase .5 on a 60 m target: the first scan after acquisition is 1 + floor(.5 * 8) = 5 frames away.
  const { body, calls, actor } = pursuitActor('attack', .5), grid = new SpatialGrid<NPC>(20)
  const current = npc(320, 240, Faction.ENEMY), alternate = npc(280, 240, Faction.ENEMY)
  // A closer hostile the duty policy forbids is never chosen over the permitted distant one.
  const denied = npc(270, 240, Faction.ENEMY)
  Object.assign(body, { combatTargetAllowed: (target: NPC) => target !== denied })
  grid.insert(current); grid.insert(denied)
  const player = { dead: true, targetable: false } as Player
  const sense = () => NPC.prototype['_getTarget'].call(actor, 1 / 60, player, [current, alternate], grid)
  expect(sense()?.npc).toBe(current)
  expect(calls.pathCleared).toBe(1)
  // A hostile under half the distance appears; it is not taken before the scheduled scan.
  grid.insert(alternate)
  for (let frame = 2; frame <= 5; frame++) expect(sense()?.npc, `frame ${frame}`).toBe(current)
  expect(sense()?.npc).toBe(alternate)
  expect(calls.pathCleared).toBe(2)
  // Unreachable: the live target is dropped at once for the next one, then nothing is left to pursue.
  NPC.prototype['_deferUnreachableTarget'].call(actor, alternate)
  expect(sense()?.npc).toBe(current)
  NPC.prototype['_deferUnreachableTarget'].call(actor, current)
  expect(sense()).toBeNull()
  const regained = () => { for (let frame = 1; frame <= 16; frame++) if (sense()) return frame; return null }
  expect(regained()).toBeNull()
  body._activeNavigationWorld.townNav.siegeEntrances.revision++
  expect(regained()).not.toBeNull()
})

/** Production navigation + NPC pursuit methods; only animation-free actor data. */
function blockedTownPursuit(order: NPC['tacticalOrder'], ranged = false) {
  const { body, actor } = pursuitActor(order), methods = NPC.prototype
  const world = new NavigationWorld({ minX: 130, maxX: 300, minZ: 20, maxZ: 70, cellSize: 2 }, 2)
  world.setTownRamparts({ decks: [], ramps: [], corners: [], lengths: [], perimeter: 1, wallSpans: [] })
  const baseY = getTerrainHeight(150, 45)
  const gateObstacle = { box: new THREE.Box3(new THREE.Vector3(149, baseY, 38), new THREE.Vector3(151, baseY + 8, 52)), isBarricade: true,
    damageable: { destroyed: false, isDamageableBy: (faction: string) => faction === 'roman' } } as unknown as ObstacleData
  const obstacle = (x0: number, z0: number, x1: number, z1: number): ObstacleData => ({
    box: new THREE.Box3(new THREE.Vector3(x0, -100, z0), new THREE.Vector3(x1, 100, z1)), isBarricade: true })
  const obstacles = [obstacle(149, 20, 151, 38), obstacle(149, 52, 151, 70), gateObstacle, obstacle(218, 38, 220, 50)]
  const gate = { state: 'closed' as 'closed' | 'open' | 'destroyed', siegeObstacle: gateObstacle }
  world.townNav!.setSiegeGates(new Map([['east', gate]]))
  world.rebuild(obstacles)
  const follower = new NavigationPathFollower(), route = new LayeredNavigationRoute(follower)
  body.combatPosition.set(260, getTerrainHeight(260, 45), 45)
  body.hasActiveRangedWeapon = ranged
  Object.assign(body, {
    characterFaction: 'roman', missionMovement: false, mount: { isFlyingMount: false, group: { rotation: { y: -Math.PI / 2 } } },
    _activeNavigationWorld: world, _navigationPath: follower, _layeredNavigationRoute: route,
    _chaseNavigation: { route: 'direct', step: null }, _tmpNavigationTarget: new THREE.Vector3(),
    _movementObstacleRadius: () => 1, _movementObstacleHeight: () => 2.6,
    _resolveNavigationMoveTarget: methods['_resolveNavigationMoveTarget'], _isAttackableObstacle: methods['_isAttackableObstacle'],
    _gateDamageAllowed: (obstacle: ObstacleData) => methods['_isAttackableObstacle'].call(actor, obstacle),
    _getObstacleAttackPoint: methods['_getObstacleAttackPoint'], _rangedObstacleDistance: methods['_rangedObstacleDistance'],
    _tmpSiegeTarget: new THREE.Vector3(), _tmpSiegeCandidateCenter: new THREE.Vector3(),
    _findRangedTrajectoryBlocker: methods['_findRangedTrajectoryBlocker'], _traceRangedTrajectoryBlocker: methods['_traceRangedTrajectoryBlocker'], rangedProjectileSpeed: 60, maxRangedAttackDistance: 60,
    _tmpRangedOrigin: new THREE.Vector3(), _tmpRangedLosTarget: new THREE.Vector3(),
    _tmpRangedArcPrevious: new THREE.Vector3(), _tmpRangedArcPoint: new THREE.Vector3(),
    _rangedPathBounds: new THREE.Box3(), _rangedPathObstacles: [],
  })
  const guard = npc(140, 45, Faction.ENEMY)
  guard.combatPosition.y = getTerrainHeight(140, 45)
  const request = { position: body.combatPosition, goal: guard.combatPosition, world, outpost: null,
    currentLayer: 'ground' as const, targetLayer: 'ground' as const, differentLayer: false,
    mounted: true, outpostMounted: true, flying: false, radius: 1, height: 2.6,
    entranceId: null, sectorId: null, actorId: 'pursuit-party', skipGroundNavigation: false }
  const navigate = () => methods['_resolveChaseNavigation'].call(actor, request, obstacles)
  /** Standing on the legal gate approach; the A* walk there is covered at LayeredNavigationRoute. */
  const arrive = () => {
    const approach = world.townNav!.selectClosedGateApproach(body.combatPosition, guard.combatPosition, o => o === gateObstacle)
    body.combatPosition.copy(approach!.approach)
    world.beginFrame()
    return navigate()
  }
  return { body, actor, world, gate, gateObstacle, guard, obstacles, navigate, arrive, route }
}

it('NPC 追擊把自身狀態交給城門策略：Attack 沿 A* 到門接手攻門並於突破後恢復地面路線，Defend 或遭遇戰不攻門', () => {
  const h = blockedTownPursuit('attack')
  h.world.beginFrame()
  let result = h.navigate()
  expect(result.route).toBe('path')
  expect(result.step?.breach).toBe(h.gateObstacle)
  expect(NPC.prototype['_readyPursuitGate'].call(h.actor, result.step, h.obstacles)).toBeNull()
  result = h.arrive()
  expect(result.step?.approachReached).toBe(true)
  h.gate.state = 'destroyed'
  h.obstacles.splice(h.obstacles.indexOf(h.gateObstacle), 1)
  h.world.rebuild(h.obstacles); h.world.beginFrame()
  result = h.navigate()
  expect(result.step?.breach).toBeUndefined()
  expect(result.route).not.toBe('unreachable')

  // The same closed gate is no objective for a Defend order or an encounter-bound actor.
  const defend = blockedTownPursuit('defend')
  defend.world.beginFrame()
  expect(defend.navigate().step?.breach).toBeUndefined()
  expect(defend.navigate().route).toBe('unreachable')
  const encounter = blockedTownPursuit('attack')
  Object.assign(encounter.body, { encounterOrigin: new THREE.Vector3() })
  encounter.world.beginFrame()
  expect(encounter.navigate().step?.breach).toBeUndefined()
})

it('弓騎兵沿攻門 approach 接近，僅在實際射程與彈道 LOS 允許時射門', () => {
  const h = blockedTownPursuit('attack', true)
  h.world.beginFrame()
  let result = h.navigate()
  expect(NPC.prototype['_readyPursuitGate'].call(h.actor, result.step, h.obstacles)).toBeNull()
  result = h.arrive()
  expect(result.step?.approachReached).toBe(true)
  expect(NPC.prototype['_readyPursuitGate'].call(h.actor, result.step, h.obstacles)).toBe(h.gateObstacle)
  const screen: ObstacleData = { box: new THREE.Box3(
    new THREE.Vector3(155, -100, 35), new THREE.Vector3(157, 100, 55)), isBarricade: true }
  expect(NPC.prototype['_readyPursuitGate'].call(h.actor, result.step, [...h.obstacles, screen])).toBeNull()
  // Changing command immediately drops the breach approach; no implicit Formation is issued.
  h.body.tacticalOrder = 'defend'
  expect(h.navigate().step?.breach).toBeUndefined()
  expect(h.route.closedGateObstacle).toBeNull()
})

it('NPC 攻門中城門被突破後，ATTACK 重新詢問路線並回到 CHASE，不再以城門為目標', () => {
  const h = blockedTownPursuit('attack'), methods = NPC.prototype, cancel = vi.fn()
  expect(methods['_readyPursuitGate'].call(h.actor, h.arrive().step, h.obstacles)).toBe(h.gateObstacle)
  Object.assign(h.body, {
    state: AIState.ATTACK, _siegeTargetObstacle: h.gateObstacle, layeredCombatMovement: false,
    animator: { cancel }, _clearSiegeFallback: methods['_clearSiegeFallback'],
  })
  h.gate.state = 'destroyed'
  h.obstacles.splice(h.obstacles.indexOf(h.gateObstacle), 1)
  h.world.rebuild(h.obstacles); h.world.beginFrame()
  const target = { position: h.guard.combatPosition, isDead: false, isPlayer: false, npc: h.guard }
  methods['_updateAttackState'].call(h.actor, 1 / 60, {} as never, [], h.obstacles, () => {}, () => {}, false, 0, null, null, h.world, target as never, 0)
  const body = h.body as unknown as Record<string, unknown>
  expect(body['state']).toBe(AIState.CHASE)
  expect(body['_siegeTargetObstacle']).toBeNull()
  expect(cancel).toHaveBeenCalled()
})
