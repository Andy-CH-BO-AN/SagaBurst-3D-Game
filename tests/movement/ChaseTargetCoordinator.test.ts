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

it.each(['attack', 'charge'] as const)('%s 在城外目標死亡後重新取得遠方守軍，弓騎兵可通過開始及持續追擊閘門', order => {
  const { body, actor } = pursuitActor(order), grid = new SpatialGrid<NPC>(20)
  const bandit = npc(262, 240, Faction.BANDIT), guard = npc(-100, -110, Faction.ENEMY)
  grid.insert(bandit); grid.insert(guard)
  const player = { dead: true, targetable: false } as Player
  NPC.prototype.enableBattlefieldEngagement.call(actor)
  const sense = () => NPC.prototype['_getTarget'].call(actor, 1 / 60, player, [bandit, guard], grid)
  expect(sense()?.npc).toBe(bandit)
  Object.assign(bandit, { dead: true })
  expect(sense()?.npc).toBe(guard)
  expect(NPC.prototype['_isTargetWithinEngagementRange'].call(actor, guard.combatPosition, false)).toBe(true)
  expect(NPC.prototype['_isTargetWithinEngagementRange'].call(actor, guard.combatPosition, true)).toBe(true)
  body.tacticalOrder = 'follow'
  expect(NPC.prototype['_isTargetWithinEngagementRange'].call(actor, guard.combatPosition, true)).toBe(false)
})

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
