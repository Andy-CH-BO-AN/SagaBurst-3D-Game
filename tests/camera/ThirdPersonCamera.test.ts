import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { resolveCameraDistance } from '../../src/camera/ThirdPersonCamera'
import type { ObstacleData } from '../../src/world/Terrain'

function obstacle(min: [number, number, number], max: [number, number, number]): ObstacleData {
  return {
    box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)),
    isBarricade: false,
  }
}

describe('ThirdPersonCamera collision', () => {
  it('pulls the camera in front of a large wall with clipping margin', () => {
    const origin = new THREE.Vector3(0, 2, 0)
    const direction = new THREE.Vector3(0, 0, 1)
    const wall = obstacle([-4, 0, 3], [4, 5, 4])

    const distance = resolveCameraDistance(origin, direction, 6, [wall])

    expect(distance).toBeCloseTo(2.72, 5)
  })

  it('ignores narrow props so posts and tree trunks do not pump the camera', () => {
    const origin = new THREE.Vector3(0, 2, 0)
    const direction = new THREE.Vector3(0, 0, 1)
    const post = obstacle([-.25, 0, 3], [.25, 5, 3.5])

    expect(resolveCameraDistance(origin, direction, 6, [post])).toBe(6)
  })

  it('keeps the camera above a terrain surface when orbiting downward', () => {
    const origin = new THREE.Vector3(0, 2, 0)
    const direction = new THREE.Vector3(0, -1, 1).normalize()

    const distance = resolveCameraDistance(origin, direction, 6, [], {
      terrainHeight: () => 0,
      terrainClearance: .18,
    })

    expect(distance).toBeGreaterThan(1.5)
    expect(distance).toBeLessThan(2.7)
  })
})
