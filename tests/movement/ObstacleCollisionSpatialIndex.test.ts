import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  ObstacleCollisionSpatialIndex
} from '../../src/world/ObstacleCollisionSpatialIndex'
import type { ObstacleData } from '../../src/world/Terrain'
import { markObstacleTopologyChanged } from '../../src/world/ObstacleTopology'

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

  it('reads live group bounds while retaining duplicate source indices and ungrouped dynamics', () => {
    const moving = { ...obstacle(-1, -1, 1, 1), dynamic: true }
    const group = { bounds: moving.box.clone() }
    const grouped = { ...moving, collisionGroup: group }
    const fixed = obstacle(-1, -1, 1, 1)
    const loose = { ...obstacle(-1, -1, 1, 1), dynamic: true }
    const remoteBox = obstacle(100, 100, 102, 102).box
    let remotePartChecks = 0
    const remote: ObstacleData = {
      dynamic: true, isBarricade: false, collisionGroup: { bounds: remoteBox.clone() },
      get box() { remotePartChecks++; return remoteBox },
    }
    const obstacles = [grouped, fixed, loose, grouped, remote]
    const index = new ObstacleCollisionSpatialIndex()
    index.sync(obstacles)
    expect(index.queryNear(0, 0, 1)).toEqual([grouped, fixed, loose, grouped])

    grouped.box.translate(new THREE.Vector3(80, 0, 0))
    group.bounds.copy(grouped.box)
    index.sync(obstacles) // No topology change: bounds remain live.
    expect(index.queryNear(0, 0, 1)).toEqual([fixed, loose])
    expect(index.queryNear(80, 0, 1)).toEqual([grouped, grouped])
    loose.box.translate(new THREE.Vector3(80, 0, 0))
    expect(index.queryNear(80, 0, 1)).toEqual([grouped, loose, grouped])
    expect(remotePartChecks).toBe(0)
  })

  it('rebuilds when gate or wall length or same-length topology revision changes', () => {
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

    const replacement = obstacle(40, -1, 42, 1)
    obstacles.splice(obstacles.indexOf(gate), 1, replacement)
    markObstacleTopologyChanged(obstacles)
    index.sync(obstacles)
    expect(index.queryNear(0, 0, 1)).toEqual([])
    expect(index.queryNear(41, 0, 1)).toEqual([replacement])
  })
})
