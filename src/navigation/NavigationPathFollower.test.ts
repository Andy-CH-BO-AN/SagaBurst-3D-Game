import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { NavigationPathFollower } from './NavigationPathFollower'
import { NavigationWorld } from './NavigationWorld'
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
      obstacle(-1, -180, 1, 180),
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
      obstacle(-1, -180, 1, 180),
    ])
    world.beginFrame()
    expect(
      follower.resolveMoveTarget(start, goal, world, true, out),
    ).toBe('unreachable')

    // Rebuild the same wall as two pieces with a 12m breach in the middle.
    world.rebuild([
      obstacle(-1, -180, 1, -6),
      obstacle(-1, 6, 1, 180),
    ])
    world.beginFrame()

    expect(
      follower.resolveMoveTarget(start, goal, world, true, out),
    ).toBe('path')
  })

  it('returns pending when the global per-frame A star budget is exhausted', () => {
    const world = new NavigationWorld()
    world.rebuild([
      obstacle(-1, -8, 1, 8),
    ])
    world.beginFrame()

    const first = new NavigationPathFollower()
    const second = new NavigationPathFollower()
    const third = new NavigationPathFollower()
    const out = new THREE.Vector3()

    expect(
      first.resolveMoveTarget(
        new THREE.Vector3(-8, 0, -4),
        new THREE.Vector3(8, 0, -4),
        world,
        true,
        out,
      ),
    ).toBe('path')
    expect(
      second.resolveMoveTarget(
        new THREE.Vector3(-8, 0, 0),
        new THREE.Vector3(8, 0, 0),
        world,
        true,
        out,
      ),
    ).toBe('path')
    expect(
      third.resolveMoveTarget(
        new THREE.Vector3(-8, 0, 4),
        new THREE.Vector3(8, 0, 4),
        world,
        true,
        out,
      ),
    ).toBe('pending')
  })
})
