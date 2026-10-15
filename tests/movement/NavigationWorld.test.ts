import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import {
  NAV_PATH_REQUESTS_PER_FRAME,
  NavigationWorld,
} from '../../src/navigation/NavigationWorld'
import {
  PLAYABLE_WORLD_BOUND,
  type ObstacleData,
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
    const world = new NavigationWorld()
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

  it('rejects disconnected regions before spending an A star request', () => {
    const world = new NavigationWorld()
    world.rebuild([
      obstacle(-1, -PLAYABLE_WORLD_BOUND, 1, PLAYABLE_WORLD_BOUND),
    ])
    world.beginFrame()

    expect(
      world.queryPath(
        new THREE.Vector3(-10, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ).status,
    ).toBe('unreachable')

    // The disconnected query above must not consume the frame A* budget.
    for (let i = 0; i < NAV_PATH_REQUESTS_PER_FRAME; i++) {
      expect(
        world.queryPath(
          new THREE.Vector3(-10, 0, -40 + i * 4),
          new THREE.Vector3(-20, 0, -40 + i * 4),
        ).status,
      ).toBe('path')
    }
  })

  it('shares one cached A star path across the same 2x2 nav-cell groups', () => {
    const world = new NavigationWorld()
    world.rebuild([
      obstacle(-1, -8, 1, 8),
    ])
    world.beginFrame()

    // Both starts are inside the same 4m macro group, and both goals are too.
    expect(
      world.queryPath(
        new THREE.Vector3(-7.1, 0, -2.5),
        new THREE.Vector3(8.5, 0, -2.5),
      ).status,
    ).toBe('path')
    expect(
      world.queryPath(
        new THREE.Vector3(-6.5, 0, -1.1),
        new THREE.Vector3(9.1, 0, -1.1),
      ).status,
    ).toBe('path')

    // The shared macro-group hit consumed no extra A* slot. Fill the
    // remaining distinct-group slots before asserting that the next waits.
    for (let i = 0; i < NAV_PATH_REQUESTS_PER_FRAME - 1; i++) {
      const z = 4.5 + i * 8
      expect(world.queryPath(
        new THREE.Vector3(-8.5, 0, z),
        new THREE.Vector3(8.5, 0, z),
      ).status).toBe('path')
    }
    const waitingZ = 4.5 + (NAV_PATH_REQUESTS_PER_FRAME - 1) * 8
    expect(world.queryPath(
      new THREE.Vector3(-8.5, 0, waitingZ),
      new THREE.Vector3(8.5, 0, waitingZ),
    ).status).toBe('pending')
  })

  it('caps expensive connected A star searches per frame', () => {
    const world = new NavigationWorld()
    world.rebuild([
      obstacle(-1, -8, 1, 8),
    ])
    world.beginFrame()
    expect(NAV_PATH_REQUESTS_PER_FRAME).toBe(10)

    for (let i = 0; i < NAV_PATH_REQUESTS_PER_FRAME; i++) {
      expect(
        world.queryPath(
          new THREE.Vector3(-8, 0, -4 + i * 4),
          new THREE.Vector3(8, 0, -4 + i * 4),
        ).status,
      ).toBe('path')
    }

    expect(
      world.queryPath(
        new THREE.Vector3(-8, 0, -4 + NAV_PATH_REQUESTS_PER_FRAME * 4),
        new THREE.Vector3(8, 0, -4 + NAV_PATH_REQUESTS_PER_FRAME * 4),
      ).status,
    ).toBe('pending')

    world.beginFrame()
    expect(
      world.queryPath(
        new THREE.Vector3(-8, 0, -4 + NAV_PATH_REQUESTS_PER_FRAME * 4),
        new THREE.Vector3(8, 0, -4 + NAV_PATH_REQUESTS_PER_FRAME * 4),
      ).status,
    ).toBe('path')
  })

  it('reconnects components after a wall breach', () => {
    const world = new NavigationWorld()

    world.rebuild([
      obstacle(-1, -PLAYABLE_WORLD_BOUND, 1, PLAYABLE_WORLD_BOUND),
    ])
    expect(
      world.areConnected(
        new THREE.Vector3(-10, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ),
    ).toBe(false)

    world.rebuild([
      obstacle(-1, -PLAYABLE_WORLD_BOUND, 1, -6),
      obstacle(-1, 6, 1, PLAYABLE_WORLD_BOUND),
    ])
    expect(
      world.areConnected(
        new THREE.Vector3(-10, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ),
    ).toBe(true)
  })

  it('reconnects an outpost-like enclosure when a side wall segment is destroyed', () => {
    const world = new NavigationWorld()
    const gate = obstacle(-4, -108.5, 4, -107.5)
    const frontLeftOuter = obstacle(-44, -108.5, -17.33, -107.5)
    const frontLeftInner = obstacle(-17.33, -108.5, -4, -107.5)
    const frontRight = obstacle(4, -108.5, 44, -107.5)
    const leftSide = obstacle(-44.5, -180, -43.5, -108)
    const rightSide = obstacle(43.5, -180, 44.5, -108)
    const rear = obstacle(-44, -180.5, 44, -179.5)

    const obstacles = [
      gate,
      frontLeftOuter,
      frontLeftInner,
      frontRight,
      leftSide,
      rightSide,
      rear,
    ]

    world.sync(obstacles)
    expect(
      world.areConnected(
        new THREE.Vector3(0, 0, -100),
        new THREE.Vector3(0, 0, -125),
      ),
    ).toBe(false)

    obstacles.splice(obstacles.indexOf(frontLeftInner), 1)
    world.sync(obstacles)

    expect(
      world.areConnected(
        new THREE.Vector3(0, 0, -100),
        new THREE.Vector3(0, 0, -125),
      ),
    ).toBe(true)
  })

  it('projects a coarse blocked actor cell onto nearby walkable navigation', () => {
    const world = new NavigationWorld()
    world.rebuild([
      obstacle(-1, -1, 1, 1),
    ])
    world.beginFrame()

    const result = world.queryPath(
      new THREE.Vector3(0.9, 0, 0),
      new THREE.Vector3(10, 0, 0),
    )
    expect(result.status).toBe('path')
  })

  it('ignores navigationPassable overhead obstacles when blocking the ground grid', () => {
    const world = new NavigationWorld()
    const overhead = { ...obstacle(-3, -3, 3, 3), navigationPassable: true }
    const solid = obstacle(10, -3, 12, 3)
    world.rebuild([overhead, solid])
    const blockedAt = (x: number): boolean => world.grid.isBlocked(world.grid.worldToCell(new THREE.Vector3(x, 0, 0))!)

    expect(blockedAt(0)).toBe(false)
    expect(blockedAt(11)).toBe(true)
    world.beginFrame()
    expect(world.queryPath(new THREE.Vector3(-8, 0, 0), new THREE.Vector3(8, 0, 0)).status).toBe('path')
  })
})


it('updates one deferred owner to its latest destination and discards deferred work after topology changes', () => {
  const world = new NavigationWorld({ minX: 0, maxX: 100, minZ: 0, maxZ: 140, cellSize: 2 })
  world.rebuild([]); world.beginFrame()
  const find = vi.spyOn(world.grid, 'findPathCells'); onTestFinished(() => find.mockRestore())
  for (let i = 0; i < NAV_PATH_REQUESTS_PER_FRAME; i++) {
    // Keep z=25 free for the deferred owner.
    const z = 5 + (i >= 2 ? i + 1 : i) * 10
    expect(world.queryPath({ x: 5, z }, { x: 15, z }).status).toBe('path')
  }
  const owner = {}
  expect(world.queryPath({ x: 5, z: 25 }, { x: 15, z: 25 }, owner).status).toBe('pending')
  expect(world.queryPath({ x: 5, z: 25 }, { x: 35, z: 25 }, owner).status).toBe('pending')
  const before = find.mock.calls.length
  world.beginFrame()
  expect(find.mock.calls.length - before).toBe(1)
  const result = world.queryPath({ x: 5, z: 25 }, { x: 35, z: 25 }, owner)
  expect(result.status).toBe('path')
  if (result.status === 'path') expect(result.path.at(-1)).toEqual({ x: 17, z: 12 })
  // beginFrame serviced one waiting owner; fill the other nine slots.
  for (let i = 0; i < NAV_PATH_REQUESTS_PER_FRAME - 1; i++) {
    const z = 5 + i * 10
    expect(world.queryPath({ x: 5, z }, { x: 45, z }).status).toBe('path')
  }
  expect(world.queryPath({ x: 5, z: 65 }, { x: 35, z: 65 }, owner).status).toBe('pending')
  world.rebuild([obstacle(48, 0, 52, 100)])
  const afterRebuild = find.mock.calls.length
  world.beginFrame()
  expect(find.mock.calls.length).toBe(afterRebuild)
})
