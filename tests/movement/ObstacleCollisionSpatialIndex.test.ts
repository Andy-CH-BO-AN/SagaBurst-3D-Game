import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  ObstacleCollisionSpatialIndex
} from '../../src/world/ObstacleCollisionSpatialIndex'
import type { ObstacleData } from '../../src/world/Terrain'

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
    isBarricade: false,
  }
}

describe('ObstacleCollisionSpatialIndex', () => {
  it('returns only nearby obstacles in original source order', () => {
    const farFirst = obstacle(80, 80, 82, 82)
    const nearSecond = obstacle(-1, -1, 1, 1)
    const nearThird = obstacle(2, -1, 4, 1)
    const obstacles = [farFirst, nearSecond, nearThird]

    const index = new ObstacleCollisionSpatialIndex()
    index.sync(obstacles)

    expect(index.queryNear(1.5, 0, 1)).toEqual([
      nearSecond,
      nearThird,
    ])
  })

  it('rebuilds when gate or wall topology changes the shared array length', () => {
    const gate = obstacle(-4, -0.5, 4, 0.5)
    const wall = obstacle(12, -1, 14, 1)
    const obstacles = [gate, wall]
    const index = new ObstacleCollisionSpatialIndex()

    index.sync(obstacles)
    expect(index.queryNear(0, 0, 1)).toEqual([gate])

    obstacles.splice(obstacles.indexOf(gate), 1)
    index.sync(obstacles)
    expect(index.queryNear(0, 0, 1)).toEqual([])

    obstacles.push(gate)
    index.sync(obstacles)
    expect(index.queryNear(0, 0, 1)).toEqual([gate])
  })
})
