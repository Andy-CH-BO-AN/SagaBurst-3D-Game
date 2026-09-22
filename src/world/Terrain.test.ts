import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  findBlockingProjectileObstacleAlongPath,
  obstacleContainsProjectilePoint,
  type ObstacleData,
} from './Terrain'

describe('projectile obstacle geometry', () => {
  const obstacle: ObstacleData = {
    box: new THREE.Box3(
      new THREE.Vector3(-1.2, 0, -0.5),
      new THREE.Vector3(1.2, 3, 0.5),
    ),
    isBarricade: true,
    projectileBoxes: [
      new THREE.Box3(
        new THREE.Vector3(-1.0, 0, -0.25),
        new THREE.Vector3(-0.65, 3, 0.25),
      ),
      new THREE.Box3(
        new THREE.Vector3(0.65, 0, -0.25),
        new THREE.Vector3(1.0, 3, 0.25),
      ),
    ],
  }

  it('keeps navigation collision continuous while allowing projectiles through visual gaps', () => {
    expect(obstacle.box.containsPoint(new THREE.Vector3(0, 1.2, 0))).toBe(true)
    expect(obstacleContainsProjectilePoint(obstacle, new THREE.Vector3(0, 1.2, 0))).toBe(false)
    expect(obstacleContainsProjectilePoint(obstacle, new THREE.Vector3(0.8, 1.2, 0))).toBe(true)
  })

  it('uses the projectile solids for ranged line of sight', () => {
    const throughGap = findBlockingProjectileObstacleAlongPath(
      new THREE.Vector3(0, 1.2, -5),
      new THREE.Vector3(0, 1.2, 5),
      [obstacle],
    )
    const throughStake = findBlockingProjectileObstacleAlongPath(
      new THREE.Vector3(0.8, 1.2, -5),
      new THREE.Vector3(0.8, 1.2, 5),
      [obstacle],
    )

    expect(throughGap).toBeNull()
    expect(throughStake).toBe(obstacle)
  })
})
