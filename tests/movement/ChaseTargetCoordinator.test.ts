import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ChaseTargetCoordinator } from '../../src/navigation/ChaseTargetCoordinator'
import { Faction, type NPC } from '../../src/world/NPC'
import { SpatialGrid } from '../../src/world/SpatialGrid'

function npc(
  x: number,
  z: number,
  faction: Faction,
): NPC {
  return {
    combatPosition: new THREE.Vector3(x, 0, z),
    faction,
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
