import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  findBlockingProjectileObstacleAlongPath,
  findDamageableBlockerWithoutDetour,
  findObstacleDetourPlan,
  obstacleContainsProjectilePoint,
  type ObstacleData,
} from './Terrain'
import { DamageableObstacle } from './DamageableObstacle'

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


describe('destructible obstacle routing priority', () => {
  function createDamageableWall(): ObstacleData {
    const root = new THREE.Group()
    const damageable = new DamageableObstacle({
      kind: 'palisade',
      maxHp: 100,
      root,
      ownerFaction: 'roman',
    })
    return {
      box: new THREE.Box3(
        new THREE.Vector3(-1, 0, -0.5),
        new THREE.Vector3(1, 3, 0.5),
      ),
      isBarricade: true,
      damageable,
    }
  }

  it('keeps a destructible wall as navigation when a local detour exists', () => {
    const wall = createDamageableWall()
    const position = new THREE.Vector3(0, 1, -4)
    const target = new THREE.Vector3(0, 1, 4)

    const plan = findObstacleDetourPlan(
      position,
      target,
      0.5,
      2.0,
      0,
      [wall],
      undefined,
      10,
    )

    expect(plan).not.toBeNull()
    expect(plan?.obstacle).toBe(wall)
    expect(
      findDamageableBlockerWithoutDetour(
        position,
        target,
        0.5,
        2.0,
        0,
        [wall],
        10,
      ),
    ).toBeNull()
  })

  it('allows destruction fallback when no detour waypoint can be produced', () => {
    const wall = createDamageableWall()
    const position = new THREE.Vector3(0, 1, 0)
    const target = new THREE.Vector3(0, 1, 4)

    expect(
      findDamageableBlockerWithoutDetour(
        position,
        target,
        0.5,
        2.0,
        0,
        [wall],
        10,
      ),
    ).toBe(wall)
  })
})
