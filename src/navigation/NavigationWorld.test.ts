import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  NAV_PATH_NODE_EXPANSIONS_PER_FRAME,
  NavigationWorld,
} from './NavigationWorld'
import type { ObstacleData } from '../world/Terrain'

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

  it('rejects disconnected regions before spending node-expansion budget', () => {
    const world = new NavigationWorld()
    world.rebuild([
      obstacle(-1, -180, 1, 180),
    ])
    world.beginFrame()

    const internals = world as unknown as {
      remainingPathNodeBudget: number
    }
    expect(internals.remainingPathNodeBudget)
      .toBe(NAV_PATH_NODE_EXPANSIONS_PER_FRAME)

    expect(
      world.queryPath(
        new THREE.Vector3(-10, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ).status,
    ).toBe('unreachable')

    expect(internals.remainingPathNodeBudget)
      .toBe(NAV_PATH_NODE_EXPANSIONS_PER_FRAME)
  })

  it('shares one cached A star path across the same 2x2 nav-cell groups', () => {
    const world = new NavigationWorld()
    world.rebuild([
      obstacle(-1, -8, 1, 8),
    ])
    world.beginFrame()

    const internals = world as unknown as {
      remainingPathNodeBudget: number
    }

    // Both starts are inside the same 4m macro group, and both goals are too.
    expect(
      world.queryPath(
        new THREE.Vector3(-8.5, 0, -4.5),
        new THREE.Vector3(8.5, 0, -4.5),
      ).status,
    ).toBe('path')
    const remainingAfterFirst = internals.remainingPathNodeBudget

    expect(
      world.queryPath(
        new THREE.Vector3(-7.1, 0, -3.1),
        new THREE.Vector3(9.1, 0, -3.1),
      ).status,
    ).toBe('path')

    // Cache hit must spend no additional search nodes.
    expect(internals.remainingPathNodeBudget).toBe(remainingAfterFirst)
  })

  it('time-slices one long A star search across frame budgets', () => {
    const world = new NavigationWorld()
    world.rebuild([])
    world.beginFrame()

    const start = new THREE.Vector3(-150, 0, 0)
    const goal = new THREE.Vector3(150, 0, 0)
    const internals = world as unknown as {
      remainingPathNodeBudget: number
      activePathKey: string | null
    }

    expect(world.queryPath(start, goal).status).toBe('pending')
    expect(internals.remainingPathNodeBudget).toBe(0)
    expect(internals.activePathKey).not.toBeNull()

    world.beginFrame()

    expect(world.queryPath(start, goal).status).toBe('path')
    expect(internals.activePathKey).toBeNull()
  })

  it('queues a second path while a long search owns the current frame budget', () => {
    const world = new NavigationWorld()
    world.rebuild([])
    world.beginFrame()

    const firstStart = new THREE.Vector3(-150, 0, -40)
    const firstGoal = new THREE.Vector3(150, 0, -40)
    const secondStart = new THREE.Vector3(-150, 0, 40)
    const secondGoal = new THREE.Vector3(150, 0, 40)

    expect(world.queryPath(firstStart, firstGoal).status).toBe('pending')
    expect(world.queryPath(secondStart, secondGoal).status).toBe('pending')

    const internals = world as unknown as {
      pendingPathRequests: Map<string, unknown>
    }
    expect(internals.pendingPathRequests.size).toBe(1)

    world.beginFrame()
    expect(world.queryPath(firstStart, firstGoal).status).toBe('path')
    expect(world.queryPath(secondStart, secondGoal).status).toBe('pending')

    world.beginFrame()
    expect(world.queryPath(secondStart, secondGoal).status).toBe('path')
  })

  it('cancels an unfinished search when topology changes', () => {
    const world = new NavigationWorld()
    world.rebuild([])
    world.beginFrame()

    const start = new THREE.Vector3(-150, 0, 0)
    const goal = new THREE.Vector3(150, 0, 0)
    expect(world.queryPath(start, goal).status).toBe('pending')

    world.rebuild([
      obstacle(-1, -180, 1, 180),
    ])
    world.beginFrame()

    expect(world.queryPath(start, goal).status).toBe('unreachable')
  })

  it('reconnects components after a wall breach', () => {
    const world = new NavigationWorld()

    world.rebuild([
      obstacle(-1, -180, 1, 180),
    ])
    expect(
      world.areConnected(
        new THREE.Vector3(-10, 0, 0),
        new THREE.Vector3(10, 0, 0),
      ),
    ).toBe(false)

    world.rebuild([
      obstacle(-1, -180, 1, -6),
      obstacle(-1, 6, 1, 180),
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
