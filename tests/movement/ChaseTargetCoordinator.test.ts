import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
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
  it('shares one target lookup for allies inside the same 4m chase group', () => {
    const coordinator = new ChaseTargetCoordinator()
    const hostileGrid = new SpatialGrid<NPC>(20)
    const enemy = npc(20, 0, Faction.ENEMY)
    hostileGrid.insert(enemy)

    const findNearest = vi.spyOn(hostileGrid, 'findNearest')
    coordinator.beginFrame()

    const allyA = npc(0.5, 0.5, Faction.PLAYER)
    const allyB = npc(3.5, 3.5, Faction.PLAYER)

    expect(coordinator.findGroupTarget(allyA, hostileGrid)).toBe(enemy)
    expect(coordinator.findGroupTarget(allyB, hostileGrid)).toBe(enemy)
    expect(findNearest).toHaveBeenCalledTimes(1)
  })

  it('partitions ground-only and unrestricted caches for colocated melee and ranged allies', () => {
    const coordinator = new ChaseTargetCoordinator(), grid = new SpatialGrid<NPC>(20)
    const eagle = npc(5, 0, Faction.ENEMY), ground = npc(80, 0, Faction.ENEMY)
    Object.assign(eagle, { mount: { isFlyingMount: true } })
    grid.insert(eagle); grid.insert(ground)
    const ally = npc(.5, .5, Faction.PLAYER)
    expect(coordinator.findGroupTarget(ally, grid)).toBe(eagle)
    expect(coordinator.findGroupTarget(ally, grid, true)).toBe(ground)
    expect(coordinator.findGroupTarget(ally, grid)).toBe(eagle)
    // A grounded target boarding an eagle must immediately leave the ground cache.
    Object.assign(ground, { mount: { isFlyingMount: true } })
    expect(coordinator.findGroupTarget(ally, grid, true)).toBeNull()
  })

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

  it('refreshes a cached group target when that target dies', () => {
    const coordinator = new ChaseTargetCoordinator()
    const hostileGrid = new SpatialGrid<NPC>(20)
    const first = npc(10, 0, Faction.ENEMY)
    const second = npc(14, 0, Faction.ENEMY)
    hostileGrid.insert(first)
    hostileGrid.insert(second)

    coordinator.beginFrame()
    const ally = npc(0.5, 0.5, Faction.PLAYER)
    expect(coordinator.findGroupTarget(ally, hostileGrid)).toBe(first)

    ;(first as unknown as { dead: boolean }).dead = true
    expect(coordinator.findGroupTarget(ally, hostileGrid)).toBe(second)
  })
})
