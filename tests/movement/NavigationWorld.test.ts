import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { NavigationPathFollower } from '../../src/navigation/NavigationPathFollower'
import {
  NavigationWorld,
} from '../../src/navigation/NavigationWorld'
import {
  type ObstacleData
} from '../../src/world/Terrain'

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

describe('NavigationWorld', () => {

  it('rebuilds only when shared obstacle topology changes', () => {
    const world = new NavigationWorld({ minX: -50, maxX: 50, minZ: -50, maxZ: 50, cellSize: 2 })
    const obstacles: ObstacleData[] = []

    expect(world.sync(obstacles)).toBe(true)
    const firstRevision = world.revision
    expect(world.sync(obstacles)).toBe(false)
    expect(world.revision).toBe(firstRevision)

    obstacles.push(obstacle(-1, -1, 1, 1))

    expect(world.sync(obstacles)).toBe(true)
    expect(world.revision).toBe(firstRevision + 1)
    expect(
      world.grid.isBlocked(world.grid.worldToCell(new THREE.Vector3(0, 0, 0))!),
    ).toBe(true)

    obstacles.pop()
    expect(world.sync(obstacles)).toBe(true)
    expect(
      world.grid.isBlocked(world.grid.worldToCell(new THREE.Vector3(0, 0, 0))!),
    ).toBe(false)
  })

  it('invalidates a moved ground footprint only when raster occupancy changes and releases its old cells', () => {
    const world = new NavigationWorld({ minX: -12, maxX: 12, minZ: -12, maxZ: 12 })
    const moving = { ...obstacle(-1.8, -12, -.2, 12), dynamic: true }
    const fixed = obstacle(8, 8, 10, 10), obstacles = [moving, fixed]
    const start = new THREE.Vector3(-6, 0, 0), goal = new THREE.Vector3(6, 0, 0), out = new THREE.Vector3()
    const follower = new NavigationPathFollower()
    world.sync(obstacles)
    expect(follower.resolveMoveTarget(start, goal, world, true, out)).toBe('unreachable')
    const revision = world.revision
    moving.box.translate(new THREE.Vector3(.1, 3, 0))
    expect(world.sync(obstacles)).toBe(false)
    expect(world.revision).toBe(revision)
    moving.box.translate(new THREE.Vector3(0, 0, 26))
    expect(world.sync(obstacles)).toBe(true)
    expect(world.revision).toBe(revision + 1)
    expect(world.grid.isBlocked(world.grid.worldToCell({ x: -1, z: 0 })!)).toBe(false)
    expect(world.grid.isBlocked(world.grid.worldToCell({ x: 9, z: 9 })!)).toBe(true)
    expect(follower.resolveMoveTarget(start, goal, world, true, out)).toBe('path')
    moving.box.translate(new THREE.Vector3(0, 0, 2))
    expect(world.sync(obstacles)).toBe(false)
    obstacles.shift()
    expect(world.sync(obstacles)).toBe(true)
    expect(world.queryPath(start, goal).status).toBe('path')
  })

  it('rejects disconnected regions before spending an A star request', () => {
    const budget = 2
    const world = new NavigationWorld({ minX: -50, maxX: 50, minZ: -50, maxZ: 50, cellSize: 2 }, budget)
    world.rebuild([
      obstacle(-1, -50, 1, 50),
    ])
    world.beginFrame()

    expect(
      world.queryPath(
        new THREE.Vector3(-10, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ).status,
    ).toBe('unreachable')

    // The disconnected query above must not consume the frame A* budget.
    for (let i = 0; i < budget; i++) {
      expect(
        world.queryPath(
          new THREE.Vector3(-10, 0, -40 + i * 4),
          new THREE.Vector3(-20, 0, -40 + i * 4),
        ).status,
      ).toBe('path')
    }
  })

  it('admits the configured number of uncached A star searches and queues the next', () => {
    const budget = 3
    const world = new NavigationWorld({ minX: -50, maxX: 50, minZ: -50, maxZ: 50, cellSize: 2 }, budget)
    world.rebuild([obstacle(-1, -8, 1, 8)])
    world.beginFrame()

    for (let i = 0; i < budget; i++) {
      const z = -4 + i * 4
      expect(world.queryPath(
        new THREE.Vector3(-8, 0, z),
        new THREE.Vector3(8, 0, z),
      ).status).toBe('path')
    }

    const deferredZ = -4 + budget * 4
    expect(world.queryPath(
      new THREE.Vector3(-8, 0, deferredZ),
      new THREE.Vector3(8, 0, deferredZ),
    ).status).toBe('pending')

    world.beginFrame()
    expect(world.queryPath(
      new THREE.Vector3(-8, 0, deferredZ),
      new THREE.Vector3(8, 0, deferredZ),
    ).status).toBe('path')
  })

})

it('updates one deferred owner to its latest destination and discards deferred work after topology changes', () => {
  const world = new NavigationWorld({ minX: 0, maxX: 100, minZ: 0, maxZ: 100, cellSize: 2 }, 2)
  world.rebuild([]); world.beginFrame()
  const find = vi.spyOn(world.grid, 'findPathCells'); onTestFinished(() => find.mockRestore())
  world.queryPath({ x: 5, z: 5 }, { x: 15, z: 5 })
  world.queryPath({ x: 5, z: 15 }, { x: 15, z: 15 })
  const owner = {}
  expect(world.queryPath({ x: 5, z: 25 }, { x: 15, z: 25 }, owner).status).toBe('pending')
  expect(world.queryPath({ x: 5, z: 25 }, { x: 35, z: 25 }, owner).status).toBe('pending')
  const before = find.mock.calls.length
  world.beginFrame()
  expect(find.mock.calls.length - before).toBe(1)
  const result = world.queryPath({ x: 5, z: 25 }, { x: 35, z: 25 }, owner)
  expect(result.status).toBe('path')
  if (result.status === 'path') expect(result.path.at(-1)).toEqual({ x: 17, z: 12 })
  world.queryPath({ x: 5, z: 45 }, { x: 35, z: 45 })
  expect(world.queryPath({ x: 5, z: 65 }, { x: 35, z: 65 }, owner).status).toBe('pending')
  world.rebuild([obstacle(48, 0, 52, 100)])
  const afterRebuild = find.mock.calls.length
  world.beginFrame()
  expect(find.mock.calls.length).toBe(afterRebuild)
})

it('serves the waiting FIFO after eight moving footprints change every frame without spending another budget', () => {
  const budget = 2
  const world = new NavigationWorld({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, budget)
  const obstacles = Array.from({ length: 8 }, (_, i) => ({
    ...obstacle(-18 + i * 4, -8 + i * .25, -16 + i * 4, -2 + i * .25), dynamic: true,
  }))
  const owners = Array.from({ length: budget * 2 + 1 }, (_, i) => ({
    start: new THREE.Vector3(-16 + i * 8, 0, -14), goal: new THREE.Vector3(-16 + i * 8, 0, 14),
  }))
  world.sync(obstacles)
  const find = vi.spyOn(world.grid, 'findPathCells'); onTestFinished(() => find.mockRestore())
  const served = new Set<number>()
  let latestGoalServed = false
  for (let frame = 0; frame < 8; frame++) {
    const before = find.mock.calls.length
    world.beginFrame(true)
    // Peace actors may request before the vehicle update, but must not consume
    // searches against geometry that will be invalidated later in this frame.
    world.queryPath(owners[0].start, owners[0].goal, owners[0])
    if (frame === 1) {
      owners[4].goal.x = 12
      expect(world.queryPath(owners[4].start, owners[4].goal, owners[4]).status).toBe('pending')
    }
    expect(find.mock.calls.length).toBe(before)
    for (const moving of obstacles) moving.box.translate(new THREE.Vector3(0, 0, .48))
    expect(world.sync(obstacles)).toBe(true)
    world.resumePathSearches()
    owners.forEach((owner, index) => {
      const result = world.queryPath(owner.start, owner.goal, owner)
      if (result.status === 'path') {
        served.add(index)
        expect(result.path.every(cell => !world.grid.isBlocked(cell))).toBe(true)
        if (index === 4 && frame >= 1) {
          expect(result.path.at(-1)).toEqual(world.grid.worldToCell(owner.goal))
          latestGoalServed = true
        }
      }
    })
    const after = find.mock.calls.length
    world.resumePathSearches()
    expect(find.mock.calls.length).toBe(after)
    expect(after - before).toBeLessThanOrEqual(budget)
  }
  expect(served.size).toBe(owners.length)
  expect(latestGoalServed).toBe(true)
})
