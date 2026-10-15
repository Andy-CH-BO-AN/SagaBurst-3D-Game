import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { NavigationPathFollower } from '../../src/navigation/NavigationPathFollower'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { PLAYABLE_WORLD_BOUND, type ObstacleData } from '../../src/world/Terrain'

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
  it('uses the exact target when the direct path is clear', () => {
    const world = new NavigationWorld()
    world.rebuild([])
    world.beginFrame()

    const follower = new NavigationPathFollower()
    const out = new THREE.Vector3()
    const goal = new THREE.Vector3(15, 0, 15)

    expect(
      follower.resolveMoveTarget(
        new THREE.Vector3(1, 0, 1),
        goal,
        world,
        false,
        out,
      ),
    ).toBe('direct')
    expect(out).toEqual(goal)
  })

  it('follows A star waypoints around a blocking wall when both sides remain connected', () => {
    const world = new NavigationWorld()
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

  it('returns unreachable without A star when a full barrier splits connectivity', () => {
    const world = new NavigationWorld()
    world.rebuild([
      obstacle(-1, -PLAYABLE_WORLD_BOUND, 1, PLAYABLE_WORLD_BOUND),
    ])
    world.beginFrame()

    const follower = new NavigationPathFollower()
    const out = new THREE.Vector3()

    expect(
      follower.resolveMoveTarget(
        new THREE.Vector3(-10, 0, 0),
        new THREE.Vector3(10, 0, 0),
        world,
        true,
        out,
      ),
    ).toBe('unreachable')
  })

  it('drops old no-route state after a breach reconnects the map', () => {
    const world = new NavigationWorld()
    const follower = new NavigationPathFollower()
    const out = new THREE.Vector3()
    const start = new THREE.Vector3(-10, 0, 0)
    const goal = new THREE.Vector3(10, 0, 0)

    world.rebuild([
      obstacle(-1, -PLAYABLE_WORLD_BOUND, 1, PLAYABLE_WORLD_BOUND),
    ])
    world.beginFrame()
    expect(
      follower.resolveMoveTarget(start, goal, world, true, out),
    ).toBe('unreachable')

    // Rebuild the same wall as two pieces with a 12m breach in the middle.
    world.rebuild([
      obstacle(-1, -PLAYABLE_WORLD_BOUND, 1, -6),
      obstacle(-1, 6, 1, PLAYABLE_WORLD_BOUND),
    ])
    world.beginFrame()

    expect(
      follower.resolveMoveTarget(start, goal, world, true, out),
    ).toBe('path')
  })

  it('returns pending when the supplied A star budget is exhausted', () => {
    const budget = 3
    const world = new NavigationWorld(undefined, budget)
    world.rebuild([
      obstacle(-1, -8, 1, 8),
    ])
    world.beginFrame()

    const followers = Array.from({ length: budget + 1 }, () => new NavigationPathFollower())
    const out = new THREE.Vector3()

    for (let i = 0; i < budget; i++) {
      const z = -4 + i * 4
      expect(followers[i].resolveMoveTarget(
        new THREE.Vector3(-8, 0, z),
        new THREE.Vector3(8, 0, z),
        world,
        true,
        out,
      )).toBe('path')
    }

    const deferredZ = -4 + budget * 4
    expect(followers[budget].resolveMoveTarget(
      new THREE.Vector3(-8, 0, deferredZ),
      new THREE.Vector3(8, 0, deferredZ),
      world,
      true,
      out,
    )).toBe('pending')
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
