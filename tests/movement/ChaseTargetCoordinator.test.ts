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
