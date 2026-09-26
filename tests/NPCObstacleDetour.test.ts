import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  findObstacleDetourPlan,
  isObstaclePathClear,
  type ObstacleData,
} from '../src/world/Terrain'
import { AIType, Faction, NPC } from '../src/world/NPC'

function treeObstacle(): ObstacleData {
  return {
    box: new THREE.Box3(
      new THREE.Vector3(-0.4, -1, 4.6),
      new THREE.Vector3(0.4, 6, 5.4),
    ),
    isBarricade: false,
  }
}

describe('Persistent NPC obstacle detour', () => {
  it('builds a clear persistent waypoint around a blocking tree', () => {
    const obstacle = treeObstacle()
    const start = new THREE.Vector3(0, 0, 0)
    const target = new THREE.Vector3(0, 0, 20)

    const plan = findObstacleDetourPlan(
      start,
      target,
      0.5,
      2.3,
      0,
      [obstacle],
      undefined,
      6,
    )

    expect(plan).not.toBeNull()
    expect(Math.abs(plan!.waypoint.x)).toBeGreaterThan(0.9)
    expect(isObstaclePathClear(start, plan!.waypoint, 0.5, 2.3, 0, [obstacle])).toBe(true)
  })

  it('keeps the requested detour side instead of flipping left/right every frame', () => {
    const obstacle = treeObstacle()
    const start = new THREE.Vector3(0, 0, 0)
    const target = new THREE.Vector3(0, 0, 20)

    const initial = findObstacleDetourPlan(start, target, 0.5, 2.3, 0, [obstacle], undefined, 6)
    expect(initial).not.toBeNull()

    const repeated = findObstacleDetourPlan(
      start,
      target,
      0.5,
      2.3,
      0,
      [obstacle],
      initial!.side,
      6,
    )

    expect(repeated).not.toBeNull()
    expect(repeated!.side).toBe(initial!.side)
  })

  it('gives mounted units more clearance than infantry', () => {
    const obstacle = treeObstacle()
    const start = new THREE.Vector3(0, 0, 0)
    const target = new THREE.Vector3(0, 0, 20)

    const infantry = findObstacleDetourPlan(start, target, 0.5, 2.3, 0, [obstacle], undefined, 7)
    const mounted = findObstacleDetourPlan(start, target, 1.0, 2.6, 0, [obstacle], undefined, 7)

    expect(infantry).not.toBeNull()
    expect(mounted).not.toBeNull()
    expect(Math.abs(mounted!.waypoint.x)).toBeGreaterThan(Math.abs(infantry!.waypoint.x))
  })

  it('switches to the opposite detour side after 0.75s without meaningful progress', () => {
    const scene = new THREE.Scene()
    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'Stuck', 1, false)
    const obstacle = treeObstacle()
    const target = new THREE.Vector3(0, 0, 20)
    const moveDir = new THREE.Vector3(0, 0, 1)

    ;(npc as any)._applyPersistentObstacleDetour(moveDir, target, 0.016, [obstacle])
    expect((npc as any)._detourActive).toBe(true)

    const firstSide = (npc as any)._detourSide
    ;(npc as any)._detourProgressAnchor.copy(npc.combatPosition)
    ;(npc as any)._detourStuckElapsed = 0.74

    ;(npc as any)._applyPersistentObstacleDetour(moveDir, target, 0.02, [obstacle])

    expect((npc as any)._detourActive).toBe(true)
    expect((npc as any)._detourSide).toBe(firstSide === 1 ? -1 : 1)
  })

  it('does not create a detour when the direct path is clear', () => {
    const obstacle = treeObstacle()
    const start = new THREE.Vector3(-10, 0, 0)
    const target = new THREE.Vector3(-10, 0, 20)

    const plan = findObstacleDetourPlan(start, target, 0.5, 2.3, 0, [obstacle], undefined, 7)

    expect(plan).toBeNull()
    expect(isObstaclePathClear(start, target, 0.5, 2.3, 0, [obstacle])).toBe(true)
  })
})
