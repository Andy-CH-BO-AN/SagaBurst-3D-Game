import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  NavigationWorld,
} from '../../src/navigation/NavigationWorld'
import {
  createRiverCrossingObstacleData,
  getRiverCenterZ,
  RIVER_CROSSING_LAYOUT,
} from '../../src/world/RiverCrossingBattlefield'
import {
  findBlockingObstacleAlongPath,
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

  it('reconnects components after a wall breach', () => {
    const world = new NavigationWorld({ minX: -50, maxX: 50, minZ: -50, maxZ: 50, cellSize: 2 })

    world.rebuild([
      obstacle(-1, -50, 1, 50),
    ])
    expect(
      world.areConnected(
        new THREE.Vector3(-10, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ),
    ).toBe(false)

    world.rebuild([
      obstacle(-1, -50, 1, -6),
      obstacle(-1, 6, 1, 50),
    ])
    expect(
      world.areConnected(
        new THREE.Vector3(-10, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ),
    ).toBe(true)
  })

  it('routes North and South bank paths exclusively through the five-lane bridge and blocks river or map-edge crossings', () => {
    const obstacles = createRiverCrossingObstacleData()
    const world = new NavigationWorld({
      minX: -PLAYABLE_WORLD_BOUND,
      maxX: PLAYABLE_WORLD_BOUND,
      minZ: -120,
      maxZ: 120,
      cellSize: 2,
    }, 4)
    world.rebuild(obstacles)
    world.beginFrame()

    const northPoint = new THREE.Vector3(-34, 0, -36)
    const southPoint = new THREE.Vector3(34, 0, 36)
    expect(world.areConnected(northPoint, southPoint)).toBe(true)

    // Direct off-bridge river crossings and map-edge river cells are blocked.
    for (const sampleX of [-PLAYABLE_WORLD_BOUND + 1, -140, -32, 32, 140, PLAYABLE_WORLD_BOUND - 1]) {
      const riverCell = world.grid.worldToCell({ x: sampleX, z: getRiverCenterZ(sampleX) })
      expect(riverCell).not.toBeNull()
      expect(world.grid.isBlocked(riverCell!)).toBe(true)
      expect(
        findBlockingObstacleAlongPath(
          new THREE.Vector3(sampleX, 0, -35),
          new THREE.Vector3(sampleX, 0, 35),
          0.5,
          2.3,
          0,
          obstacles,
        ),
      ).not.toBeNull()
    }

    // Both North -> South and South -> North paths pass through the bridge corridor.
    const northToSouth = world.queryPath(northPoint, southPoint)
    const southToNorth = world.queryPath(southPoint, northPoint)
    expect(northToSouth.status).toBe('path')
    expect(southToNorth.status).toBe('path')
    for (const result of [northToSouth, southToNorth]) {
      if (result.status !== 'path') continue
      const riverCrossingPoints = result.path
        .map(cell => world.grid.cellToWorld(cell))
        .filter(point => Math.abs(point.z) <= 16)
      expect(riverCrossingPoints.length).toBeGreaterThan(0)
      const maxAbsX = Math.max(...riverCrossingPoints.map(point => Math.abs(point.x)))
      expect(maxAbsX).toBeLessThan(RIVER_CROSSING_LAYOUT.bridge.halfClearWidth)
    }

    // Sealing the bridge corridor disconnects the banks completely (proving zero edge or river shortcuts).
    world.rebuild([
      ...obstacles,
      obstacle(-RIVER_CROSSING_LAYOUT.bridge.halfTotalWidth, -4, RIVER_CROSSING_LAYOUT.bridge.halfTotalWidth, 4),
    ])
    expect(world.areConnected(northPoint, southPoint)).toBe(false)
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
