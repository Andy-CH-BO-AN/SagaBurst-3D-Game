import { getOutpostWalkwayLayout } from '../../src/campaign/CampaignOutpostWalkways'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { NavigationPathFollower } from '../../src/navigation/NavigationPathFollower'
import { LayeredNavigationRoute } from '../../src/navigation/LayeredNavigationRoute'
import { getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ChaseTargetCoordinator } from '../../src/navigation/ChaseTargetCoordinator'
import { Faction, NPC } from '../../src/world/NPC'
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


it('acquires an authorized distant attack target and uses the horizontal map diagonal for both engagement gates', () => {
  // Only targeting/range data: no actor, model or scene constructor.
  const body = {
    combatPosition: new THREE.Vector3(-200, 0, -200), faction: Faction.PLAYER, dead: false,
    playableWorldBound: 200,
    tacticalOrder: 'attack' as NPC['tacticalOrder'], battlefieldEngagementRangeSq: null,
    isTownRampartGarrisonActive: false, holdsRampartPosition: false, alertRange: 300,
    hasActiveRangedWeapon: false, mount: null, encounterOrigin: null,
    targetsPlayer: false, missionCombatTarget: undefined,
    _pursuitTargetAllowed: NPC.prototype['_pursuitTargetAllowed'],
    combatTargetAllowed: (target: NPC) => target.combatantId === 'permitted',
  }
  const actor = body as unknown as NPC
  const grid = new SpatialGrid<NPC>(20)
  const denied = npc(-199, -199, Faction.ENEMY, 'denied')
  const target = npc(200, 200, Faction.ENEMY, 'permitted')
  target.combatPosition.y = 80
  grid.insert(denied); grid.insert(target)
  const selected = NPC.prototype['_findTarget'].call(actor, { dead: true, targetable: false } as Player, [], grid)
  expect(selected?.npc).toBe(target)
  const inRange = (chasing: boolean) => NPC.prototype['_isTargetWithinEngagementRange'].call(actor, target.combatPosition, chasing)
  expect(inRange(false)).toBe(false)
  expect(inRange(true)).toBe(false)
  NPC.prototype.enableBattlefieldEngagement.call(actor)
  expect(inRange(false)).toBe(true)
  expect(inRange(true)).toBe(true)
  // Changing the scene bound changes the cached policy, including diagonal extent.
  body.playableWorldBound = 150
  NPC.prototype.enableBattlefieldEngagement.call(actor)
  expect(inRange(false)).toBe(false)
  expect(inRange(true)).toBe(false)
  body.combatPosition.set(-150, 0, -150)
  target.combatPosition.set(150, 80, 150)
  expect(inRange(false)).toBe(true)
  expect(inRange(true)).toBe(true)
  body.tacticalOrder = 'follow'
  expect(inRange(false)).toBe(false)
  expect(inRange(true)).toBe(false)
  body.tacticalOrder = 'attack'
  body.holdsRampartPosition = true
  expect(inRange(false)).toBe(false)
  // Explicit garrisons keep their original pursuit/hold policy.
  target.combatPosition.set(200, 80, 200)
  expect(inRange(true)).toBe(false)
})

/** Data-only adapter for the real sensor/cache owner, without actor construction. */
function pursuitActor(order: NPC['tacticalOrder']) {
  const methods = NPC.prototype
  const body = {
    combatPosition: new THREE.Vector3(260, 0, 240), faction: Faction.PLAYER,
    tacticalOrder: order, playableWorldBound: 350, battlefieldEngagementRangeSq: null,
    isTownRampartGarrisonActive: false, holdsRampartPosition: false, alertRange: 300,
    hasActiveRangedWeapon: true, isMounted: true, mount: { isFlyingMount: false }, encounterOrigin: null,
    targetsPlayer: false, missionCombatTarget: undefined, playerHitFocus: 0, cavalryPassthroughTimer: 0,
    hasSiegeObstacle: false, _cachedTargetIsPlayer: false, _cachedTargetNpc: null,
    _targetAcquisitionInitialized: false, _initialStaggerPhase: 0, _rangedVisibleTargetHoldFrames: 0,
    _targetReacquireFramesRemaining: 0, _targetReacquireIntervalFrames: 1,
    _liveTargetInfo: {}, _tmpTargetPosition: new THREE.Vector3(), pursuitBlockedTargets: new Map(),
    _activeNavigationWorld: { revision: 1, townNav: { siegeEntrances: { revision: 1 } } },
    _clearObstacleDetour: vi.fn(), _clearNavigationPath: vi.fn(), _clearSiegeFallback: vi.fn(),
    _pursuitTargetAllowed: methods['_pursuitTargetAllowed'], _findTarget: methods['_findTarget'],
    _acquireTarget: methods['_acquireTarget'], _isCachedTargetValid: methods['_isCachedTargetValid'],
    _getCachedTargetDistance: methods['_getCachedTargetDistance'], _scheduleTargetReacquire: methods['_scheduleTargetReacquire'],
    _staggeredTargetReacquireDelay: methods['_staggeredTargetReacquireDelay'],
    _getPlayerPosition: methods['_getPlayerPosition'],
  }
  return { body, actor: body as unknown as NPC }
}

it('保留接敵中的有效目標及路徑，無法抵達時改取其他敵人並於入口改變後重新允許原目標', () => {
  const { body, actor } = pursuitActor('attack'), grid = new SpatialGrid<NPC>(20)
  const current = npc(270, 240, Faction.ENEMY), alternate = npc(275, 240, Faction.ENEMY)
  grid.insert(current); grid.insert(alternate)
  const player = { dead: true, targetable: false } as Player
  const sense = () => NPC.prototype['_getTarget'].call(actor, 1 / 60, player, [current, alternate], grid)
  expect(sense()?.npc).toBe(current)
  alternate.combatPosition.x = 268
  body._targetReacquireFramesRemaining = 0
  expect(sense()?.npc).toBe(current)
  expect(body._clearNavigationPath).toHaveBeenCalledOnce()
  NPC.prototype['_deferUnreachableTarget'].call(actor, current)
  expect(sense()?.npc).toBe(alternate)
  Object.assign(alternate, { dead: true })
  expect(sense()).toBeNull()
  body._activeNavigationWorld.townNav.siegeEntrances.revision++
  body._targetReacquireFramesRemaining = 0
  expect(sense()?.npc).toBe(current)
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
    characterFaction: 'roman', mount: { isFlyingMount: false, group: { rotation: { y: -Math.PI / 2 } } },
    _activeNavigationWorld: world, _navigationPath: follower, _layeredNavigationRoute: route,
    _chaseNavigation: { route: 'direct', step: null }, _tmpNavigationTarget: new THREE.Vector3(),
    _movementObstacleRadius: () => 1, _movementObstacleHeight: () => 2.6,
    _resolveNavigationMoveTarget: methods['_resolveNavigationMoveTarget'], _isAttackableObstacle: methods['_isAttackableObstacle'],
    _gateDamageAllowed: (obstacle: ObstacleData) => methods['_isAttackableObstacle'].call(actor, obstacle),
    _getObstacleAttackPoint: methods['_getObstacleAttackPoint'], _rangedObstacleDistance: methods['_rangedObstacleDistance'],
    _tmpSiegeTarget: new THREE.Vector3(), _tmpSiegeCandidateCenter: new THREE.Vector3(),
    _findRangedTrajectoryBlocker: methods['_findRangedTrajectoryBlocker'], rangedProjectileSpeed: 60, maxRangedAttackDistance: 60,
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
  const out = (body as typeof body & { _tmpNavigationTarget: THREE.Vector3 })._tmpNavigationTarget
  const advance = () => {
    const delta = out.clone().sub(body.combatPosition).setY(0), distance = delta.length()
    if (distance > .001) body.combatPosition.addScaledVector(delta, Math.min(4, distance) / distance)
    body.combatPosition.y = getTerrainHeight(body.combatPosition.x, body.combatPosition.z)
    world.beginFrame()
    expect(world.grid.isBlocked(world.grid.worldToCell(body.combatPosition)!)).toBe(false)
    return navigate()
  }
  return { body, actor, world, gate, gateObstacle, guard, obstacles, navigate, advance, out, route }
}

it.each(['attack', 'charge'] as const)('%s 清空 Bandit 後沿原 A* 自行到合法城門、接手攻門並在突破後進城', order => {
  const h = blockedTownPursuit(order), grid = new SpatialGrid<NPC>(20)
  const bandit = npc(262, 45, Faction.BANDIT)
  grid.insert(bandit); grid.insert(h.guard)
  const player = { dead: true, targetable: false } as Player
  const sense = () => NPC.prototype['_getTarget'].call(h.actor, 1 / 60, player, [bandit, h.guard], grid)
  expect(sense()?.npc).toBe(bandit)
  Object.assign(bandit, { dead: true })
  expect(sense()?.npc).toBe(h.guard)
  h.world.beginFrame()
  const searches = vi.spyOn(h.world, 'queryPath')
  let result = h.navigate()
  expect(result.route).toBe('path')
  expect(result.step?.breach).toBe(h.gateObstacle)
  const calls = searches.mock.calls.length
  h.navigate()
  expect(searches).toHaveBeenCalledTimes(calls)
  for (let frame = 0; frame < 70 && !result.step?.approachReached; frame++) result = h.advance()
  expect(result.step?.approachReached).toBe(true)
  expect(NPC.prototype['_readyPursuitGate'].call(h.actor, result.step, h.obstacles)).toBe(h.gateObstacle)
  NPC.prototype['_activateDirectObstacle'].call(h.actor, h.gateObstacle)
  expect(NPC.prototype['_getActiveSiegeObstacle'].call(h.actor, h.guard.combatPosition, h.obstacles)).toBe(h.gateObstacle)
  h.gate.state = 'destroyed'
  h.obstacles.splice(h.obstacles.indexOf(h.gateObstacle), 1)
  h.world.rebuild(h.obstacles); h.world.beginFrame()
  result = h.navigate()
  expect(result.step?.breach).toBeUndefined()
  expect(result.route).not.toBe('unreachable')
  for (let frame = 0; frame < 40 && h.body.combatPosition.x >= 145; frame++) result = h.advance()
  expect(h.body.combatPosition.x).toBeLessThan(145)
  expect(h.body.tacticalOrder).toBe(order)
})

it('弓騎兵沿攻門 approach 接近，僅在實際射程與彈道 LOS 允許時射門', () => {
  const h = blockedTownPursuit('attack', true)
  h.world.beginFrame()
  let result = h.navigate()
  expect(NPC.prototype['_readyPursuitGate'].call(h.actor, result.step, h.obstacles)).toBeNull()
  for (let frame = 0; frame < 70 && !result.step?.approachReached; frame++) result = h.advance()
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


it('Outpost 入口變動會立即釋放弓騎兵的不可達目標快取，不必等待敵人或地面拓樸移動', () => {
  const { body, actor } = pursuitActor('attack')
  const world = new NavigationWorld({ minX: -24, maxX: 24, minZ: -24, maxZ: 32 })
  world.setOutpostWalkways(getOutpostWalkwayLayout({ centerX: 0, halfWidth: 44,
    frontZ: 0, backZ: 72, gateWidth: 8, stakeLineZ: -7 }))
  Object.assign(body, { _activeNavigationWorld: world })
  body.combatPosition.set(0, 0, -4)
  const target = npc(0, 12, Faction.ENEMY), grid = new SpatialGrid<NPC>(20)
  grid.insert(target)
  const sense = () => NPC.prototype['_getTarget'].call(actor, 1 / 60, { dead: true, targetable: false } as Player, [target], grid)
  expect(sense()?.npc).toBe(target)
  NPC.prototype['_deferUnreachableTarget'].call(actor, target)
  expect(sense()).toBeNull()
  expect(NPC.prototype['_pursuitTargetAllowed'].call(actor, target)).toBe(false)
  const revision = world.revision
  world.outpostNav!.entrances.set({ id: 'side-gap', type: 'palisade', position: new THREE.Vector3(44, 0, 12),
    approach: new THREE.Vector3(47, 0, 12), exit: new THREE.Vector3(41, 0, 12),
    mounted: true, walkable: true, faction: null, connectionId: 'side-gap' })
  expect(world.revision).toBe(revision)
  expect(NPC.prototype['_pursuitTargetAllowed'].call(actor, target)).toBe(true)
  expect(body.pursuitBlockedTargets.size).toBe(0)
  expect(sense()?.npc).toBe(target)
})


it.each(['front', 'side', 'rear'] as const)('Outpost %s 木牆破口在城門關閉與錯開更新時仍由共用 A* 出城，不要求重下命令', side => {
  const { body, actor } = pursuitActor('attack'), world = new NavigationWorld({ minX: -18, maxX: 18, minZ: -6, maxZ: 30, cellSize: 1 }, 2)
  world.setOutpostWalkways(getOutpostWalkwayLayout({ centerX: 0, halfWidth: 12, frontZ: 0, backZ: 24, gateWidth: 8, stakeLineZ: -7 }))
  // Only the perimeter is relevant to this ground route; keep elevated surfaces away.
  const nav = world.outpostNav!, bounds = (x0: number, z0: number, x1: number, z1: number): ObstacleData => ({
    box: new THREE.Box3(new THREE.Vector3(x0, -100, z0), new THREE.Vector3(x1, 100, z1)), isBarricade: true })
  const opening = side === 'front' ? bounds(-8, 0, -4, 1) : side === 'side' ? bounds(11, 10, 12, 14) : bounds(-8, 23, -4, 24)
  const walls = [bounds(-12, 0, -8, 1), bounds(-4, 0, 12, 1), bounds(-8, 23, 12, 24),
    bounds(-12, 1, -11, 24), bounds(11, 1, 12, 10), bounds(11, 14, 12, 24)]
  // Seal the two untested gaps and retain a physically closed front gate throughout.
  if (side !== 'front') walls.push(bounds(-8, 0, -4, 1))
  if (side !== 'side') walls.push(bounds(11, 10, 12, 14))
  if (side !== 'rear') walls.push(bounds(-8, 23, -4, 24))
  // The rear wall starts left of its removable section.
  walls[2] = bounds(-4, 23, 12, 24); walls.push(bounds(-12, 23, -8, 24))
  walls.push(opening)
  world.rebuild(walls)
  const position = body.combatPosition.set(0, 0, 10), goal = side === 'front' ? new THREE.Vector3(6, 0, -4)
    : side === 'side' ? new THREE.Vector3(16, 0, 18) : new THREE.Vector3(6, 0, 28)
  const follower = new NavigationPathFollower(), route = new LayeredNavigationRoute(follower), out = new THREE.Vector3()
  Object.assign(body, { _activeNavigationWorld: world, _navigationPath: follower, _layeredNavigationRoute: route,
    _chaseNavigation: { route: 'direct', step: null }, _tmpNavigationTarget: out,
    _gateDamageAllowed: () => false, _resolveNavigationMoveTarget: NPC.prototype['_resolveNavigationMoveTarget'],
    _movementObstacleRadius: () => .4, _movementObstacleHeight: () => 2.3 })
  const request = { position, goal, world, outpost: nav, currentLayer: 'ground' as const, targetLayer: 'ground' as const,
    differentLayer: false, mounted: side !== 'front', outpostMounted: side !== 'front', flying: false,
    radius: .4, height: 2.3, entranceId: 'gate', sectorId: null, actorId: 'native-defender', skipGroundNavigation: false }
  const navigate = () => NPC.prototype['_resolveChaseNavigation'].call(actor, request, walls)
  world.beginFrame()
  expect(navigate().route).toBe('unreachable')
  walls.splice(walls.indexOf(opening), 1)
  const centre = opening.box.getCenter(new THREE.Vector3()).setY(0), approach = centre.clone(), exit = centre.clone()
  if (side === 'side') { approach.x += 3; exit.x -= 3 }
  else { approach.z += side === 'front' ? -3 : 3; exit.z += side === 'front' ? 3 : -3 }
  nav.entrances.set({ id: side + '-gap', type: 'palisade', position: centre, approach, exit,
    mounted: true, walkable: true, faction: null, connectionId: side + '-gap' })
  world.sync(walls); world.beginFrame(); request.skipGroundNavigation = true
  let result = navigate()
  expect(result.route).toBe('path')
  let crossedWall = false
  for (let frame = 0; frame < 65 && position.distanceTo(goal) > .6; frame++) {
    const delta = out.clone().sub(position), distance = delta.length()
    if (distance > .001) position.addScaledVector(delta, Math.min(.8, distance) / distance)
    expect(world.grid.isBlocked(world.grid.worldToCell(position)!)).toBe(false)
    crossedWall ||= side === 'side' ? position.x > 12 : side === 'front' ? position.z < 0 : position.z > 24
    world.beginFrame(); result = navigate()
  }
  expect(crossedWall).toBe(true)
  expect(position.distanceTo(goal)).toBeLessThan(.6)
  expect(body.tacticalOrder).toBe('attack')
})
