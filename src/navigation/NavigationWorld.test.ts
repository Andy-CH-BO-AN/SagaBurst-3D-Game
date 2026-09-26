import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  NAV_PATH_REQUESTS_PER_FRAME,
  NavigationWorld,
} from './NavigationWorld'
import {
  PLAYABLE_WORLD_BOUND,
  type ObstacleData,
} from '../world/Terrain'

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

    // The shared second query must not consume another A* slot, so there is
    // still room for one different group this frame.
    expect(
      world.queryPath(
        new THREE.Vector3(-8.5, 0, 4.5),
        new THREE.Vector3(8.5, 0, 4.5),
      ).status,
    ).toBe('path')

    // A third unique group is now over the frame budget.
    expect(
      world.queryPath(
        new THREE.Vector3(-8.5, 0, 12.5),
        new THREE.Vector3(8.5, 0, 12.5),
      ).status,
    ).toBe('pending')
  })

  it('caps expensive connected A star searches per frame', () => {
    const world = new NavigationWorld()
    world.rebuild([
      obstacle(-1, -8, 1, 8),
    ])
    world.beginFrame()

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
        new THREE.Vector3(-8, 0, 4),
        new THREE.Vector3(8, 0, 4),
      ).status,
    ).toBe('pending')

    world.beginFrame()
    expect(
      world.queryPath(
        new THREE.Vector3(-8, 0, 4),
        new THREE.Vector3(8, 0, 4),
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
})
