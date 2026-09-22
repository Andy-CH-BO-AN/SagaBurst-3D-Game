import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  EntityCollisionBroadPhase,
} from './EntityCollisionBroadPhase'
import {
  resolveEntityCollision,
  type EntityCollisionBody,
  type ObstacleData,
} from './Terrain'

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

function cloneBodies(
  bodies: readonly EntityCollisionBody[],
): EntityCollisionBody[] {
  return bodies.map(candidate => ({
    ...candidate,
    position: candidate.position.clone(),
  }))
}

function resolveNaive(
  bodies: EntityCollisionBody[],
  obstacles: ObstacleData[],
): void {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      resolveEntityCollision(bodies[i], bodies[j], obstacles)
    }
  }
}

function expectSamePositions(
  actual: readonly EntityCollisionBody[],
  expected: readonly EntityCollisionBody[],
): void {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i].position.x).toBeCloseTo(expected[i].position.x, 10)
    expect(actual[i].position.y).toBeCloseTo(expected[i].position.y, 10)
    expect(actual[i].position.z).toBeCloseTo(expected[i].position.z, 10)
  }
}

describe('EntityCollisionBroadPhase', () => {
  it('matches the original all-pairs result for a dense collision chain', () => {
    const source = [
      body(0, 0),
      body(-0.8, 0),
      body(1.05, 0),
      body(1.85, 0),
      body(6, 0),
    ]
    const expected = cloneBodies(source)
    const actual = cloneBodies(source)

    resolveNaive(expected, [])
    const stats = new EntityCollisionBroadPhase().resolve(actual, [])

    expectSamePositions(actual, expected)
    expect(stats.pairChecks).toBeLessThan(source.length * (source.length - 1) / 2)
  })

  it('matches anchored collision behavior beside a world obstacle', () => {
    const source = [
      body(0, 0, 1, true),
      body(1.4, 0, 0.5),
      body(2.1, 0, 0.5),
    ]
    const obstacles: ObstacleData[] = [{
      box: new THREE.Box3(
        new THREE.Vector3(1.8, -1, -1),
        new THREE.Vector3(2.4, 3, 1),
      ),
      isBarricade: true,
    }]
    const expected = cloneBodies(source)
    const actual = cloneBodies(source)

    resolveNaive(expected, obstacles)
    new EntityCollisionBroadPhase().resolve(actual, obstacles)

    expectSamePositions(actual, expected)
  })

  it('skips all impossible pairs for widely separated armies', () => {
    const bodies: EntityCollisionBody[] = []
    for (let z = 0; z < 20; z++) {
      for (let x = 0; x < 20; x++) {
        bodies.push(body(x * 5, z * 5))
      }
    }

    const stats = new EntityCollisionBroadPhase().resolve(bodies, [])

    expect(stats.pairChecks).toBe(0)
    expect(bodies).toHaveLength(400)
  })

  it('updates grid membership after a push creates a new later collision', () => {
    const source = [
      body(0, 0),
      body(-0.8, 0),
      body(1.05, 0),
    ]
    const expected = cloneBodies(source)
    const actual = cloneBodies(source)

    resolveNaive(expected, [])
    new EntityCollisionBroadPhase().resolve(actual, [])

    expectSamePositions(actual, expected)
    expect(actual[2].position.x).toBeGreaterThan(source[2].position.x)
  })
})
