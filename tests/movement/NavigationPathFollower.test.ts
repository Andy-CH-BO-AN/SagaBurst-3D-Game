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

  it('keeps following a clear existing path when unrelated topology changes hit a pending replan, and pauses only when a remaining cell becomes blocked', () => {
    const budget = 1
    const world = new NavigationWorld({ minX: -40, maxX: 40, minZ: -40, maxZ: 40, cellSize: 2 }, budget)
    const wall = obstacle(-1, -8, 1, 8)
    world.rebuild([wall])
    world.beginFrame()

    const follower = new NavigationPathFollower()
    const out = new THREE.Vector3()
    const start = new THREE.Vector3(-8, 0, 0)
    const goal = new THREE.Vector3(8, 0, 0)

    expect(follower.resolveMoveTarget(start, goal, world, true, out)).toBe('path')
    const safeWaypoint = out.clone()

    // Rebuild with a distant obstacle so topology revision changes, then exhaust the 1-request budget.
    world.rebuild([wall, obstacle(-36, -36, -32, -32)])
    world.beginFrame()
    new NavigationPathFollower().resolveMoveTarget(
      new THREE.Vector3(-20, 0, -20),
      new THREE.Vector3(-20, 0, 20),
      world,
      true,
      new THREE.Vector3(),
    )

    expect(follower.resolveMoveTarget(start, goal, world, true, out)).toBe('path')
    expect(out.toArray()).toEqual(safeWaypoint.toArray())

    // Block a cell directly on the follower's remaining path and exhaust the budget again.
    world.rebuild([
      wall,
      obstacle(safeWaypoint.x - 1.5, safeWaypoint.z - 1.5, safeWaypoint.x + 1.5, safeWaypoint.z + 1.5),
    ])
    world.beginFrame()
    new NavigationPathFollower().resolveMoveTarget(
      new THREE.Vector3(20, 0, -20),
      new THREE.Vector3(20, 0, 20),
      world,
      true,
      new THREE.Vector3(),
    )

    expect(follower.resolveMoveTarget(start, goal, world, true, out)).toBe('pending')
  })
})


it('serves later followers despite earlier actors changing goals each frame', () => {
  // Five real followers exercise queue fairness in a small bounded grid; no scene or actors.
  const budget = 2
  const world = new NavigationWorld({ minX: -30, maxX: 30, minZ: -30, maxZ: 30, cellSize: 2 }, budget)
  world.rebuild([obstacle(-18, -2, 18, 2)])
  const find = vi.spyOn(world.grid, 'findPathCells'); onTestFinished(() => find.mockRestore())
  const followers = Array.from({ length: 5 }, () => new NavigationPathFollower())
  const routes = Array<string>(5), out = new THREE.Vector3()
  for (let frame = 0; frame < 5; frame++) {
    const before = find.mock.calls.length
    world.beginFrame()
    followers.forEach((follower, index) => {
      const start = new THREE.Vector3(-18 + index * 4, 0, -20)
      const goal = new THREE.Vector3(-18 + index * 4 + (index < budget ? frame * 2 : 0), 0, 20)
      routes[index] = follower.resolveMoveTarget(start, goal, world, true, out)
    })
    expect(find.mock.calls.length - before).toBeLessThanOrEqual(budget)
  }
  expect(routes.slice(budget)).toEqual(['path', 'path', 'path'])
})
