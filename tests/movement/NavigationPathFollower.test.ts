import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { NavigationPathFollower } from '../../src/navigation/NavigationPathFollower'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { type ObstacleData } from '../../src/world/Terrain'

function obstacle(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): ObstacleData {
  return {
    box: new THREE.Box3(
      new THREE.Vector3(minX, 0, minZ),
      new THREE.Vector3(maxX, 3, maxZ),
    ),
    isBarricade: true,
  }
}

describe('NavigationPathFollower', () => {

  it('follows A star waypoints around a blocking wall when both sides remain connected', () => {
    const world = new NavigationWorld({ minX: -50, maxX: 50, minZ: -50, maxZ: 50, cellSize: 2 })
    world.rebuild([
      obstacle(-1, -8, 1, 8),
    ])
    world.beginFrame()

    const follower = new NavigationPathFollower()
    const out = new THREE.Vector3()
    const start = new THREE.Vector3(-8, 0, 0)
    const goal = new THREE.Vector3(8, 0, 0)

    expect(
      follower.resolveMoveTarget(start, goal, world, true, out),
    ).toBe('path')
    expect(out.equals(goal)).toBe(false)
    expect(world.grid.isBlocked(world.grid.worldToCell(out)!)).toBe(false)
  })
})


it('serves later followers despite earlier actors changing goals each frame', () => {
  // 0 NPCs/Mounts/worlds: five real followers and one bounded navigation grid.
  const budget = 2
  const world = new NavigationWorld({ minX: -100, maxX: 100, minZ: -100, maxZ: 100, cellSize: 2 }, budget)
  world.rebuild([obstacle(-60, -2, 60, 2)])
  const find = vi.spyOn(world.grid, 'findPathCells'); onTestFinished(() => find.mockRestore())
  const followers = Array.from({ length: 5 }, () => new NavigationPathFollower())
  const routes = Array<string>(5), out = new THREE.Vector3()
  for (let frame = 0; frame < 5; frame++) {
    const before = find.mock.calls.length
    world.beginFrame()
    followers.forEach((follower, index) => {
      const start = new THREE.Vector3(-60 + index * 12, 0, -60)
      const goal = new THREE.Vector3(-60 + index * 12 + (index < budget ? frame * 8 : 0), 0, 60)
      routes[index] = follower.resolveMoveTarget(start, goal, world, true, out)
    })
    expect(find.mock.calls.length - before).toBeLessThanOrEqual(budget)
  }
  expect(routes.slice(budget)).toEqual(['path', 'path', 'path'])
})
