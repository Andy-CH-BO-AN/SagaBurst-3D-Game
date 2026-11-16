import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  EntityCollisionBroadPhase,
} from '../../src/world/EntityCollisionBroadPhase'
import {
  resolveEntityCollision,
  type EntityCollisionBody,
  type ObstacleData,
} from '../../src/world/Terrain'

function body(
  x: number,
  z: number,
  radius = 0.5,
  anchored = false,
): EntityCollisionBody {
  return {
    position: new THREE.Vector3(x, 0, z),
    radius,
    height: 2.3,
    bottomOffset: 0,
    anchored,
  }
}

describe('EntityCollisionBroadPhase', () => {
  it('separates mounted bodies on an admitted slope instead of anchoring them inside its broadphase box', () => {
    const first = { ...body(-.2, 4, 1), mountedSurfaces: true }
    const second = { ...body(.2, 4, 1), mountedSurfaces: true }
    first.position.y = second.position.y = 1
    const obstacle: ObstacleData = { isBarricade: true, box: new THREE.Box3(new THREE.Vector3(-3, 0, 0), new THREE.Vector3(3, 3, 12)),
      walkSurface: { startX: 0, startZ: 0, startY: 0, dirX: 0, dirZ: 1, length: 12, landing: 0, topY: 3, halfWidth: 3, mounted: true } }
    resolveEntityCollision(first, second, [obstacle])
    expect(first.position.distanceTo(second.position)).toBeCloseTo(2)
    expect(first.position.y).toBe(1)
  })

  it('separates a dense collision chain in stable pair order', () => {
    const source = [
      body(0, 0),
      body(-0.8, 0),
      body(1.05, 0),
      body(1.85, 0),
      body(6, 0),
    ]
    const actual = source
    const stats = new EntityCollisionBroadPhase().resolve(actual, [])

    expect(actual.map(candidate => candidate.position.x)).toEqual([
      expect.closeTo(.075, 10), expect.closeTo(-.9, 10), expect.closeTo(.9625, 10), expect.closeTo(1.9625, 10), 6,
    ])
    expect(stats.pairChecks).toBeLessThan(source.length * (source.length - 1) / 2)
  })

  it('updates grid membership after a push creates a new later collision', () => {
    const source = [
      body(0, 0),
      body(-0.8, 0),
      body(1.05, 0),
    ]
    const actual = source
    new EntityCollisionBroadPhase().resolve(actual, [])

    expect(actual.map(candidate => candidate.position.x)).toEqual([
      expect.closeTo(.075, 10), expect.closeTo(-.9, 10), expect.closeTo(1.075, 10),
    ])
  })

  it('distributes displacement proportionally when bodies have unequal push weights', () => {
    // Mount (radius 1.0, weight 4) at x=0, Infantry (radius 0.5, weight 1) at x=1.0.
    // minDistance = 1.5, overlap = 0.5.
    // Infantry should take 4/(4+1) = 80% of push (0.4), Mount takes 1/(4+1) = 20% of push (0.1).
    const mount = { ...body(0, 0, 1.0), pushWeight: 4 }
    const infantry = { ...body(1.0, 0, 0.5), pushWeight: 1 }
    resolveEntityCollision(mount, infantry, [])

    expect(mount.position.x).toBeCloseTo(-0.1)
    expect(infantry.position.x).toBeCloseTo(1.4)
    expect(infantry.position.x - mount.position.x).toBeCloseTo(1.5)
  })
})
