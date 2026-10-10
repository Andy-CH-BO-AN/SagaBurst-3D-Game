import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ThirdPersonCamera, resolveCameraDistance } from '../../src/camera/ThirdPersonCamera'
import type { ObstacleData } from '../../src/world/Terrain'
import type { Player } from '../../src/player/Player'
import type { HeroAssetId } from '../../src/world/HeroAssetCatalog'

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

// Camera policy only: 0 actors, 0 GLBs. Player supplies hero identity and anchor.
function aimedCamera(heroAssetId?: HeroAssetId, obstacles: ObstacleData[] = []) {
  const camera = new THREE.PerspectiveCamera()
  const player: Pick<Player, 'position' | 'facingYaw' | 'isMounted' | 'isRangedAimViewActive' | 'heroAssetId'> = {
    position: new THREE.Vector3(0, 40, 0), facingYaw: 0, isMounted: false,
    isRangedAimViewActive: true, heroAssetId,
  }
  // The camera reads only this presentation boundary on foot.
  const orbit = new ThirdPersonCamera(camera, player as Player)
  orbit.setYaw(-Math.PI)
  const input = { keys: {}, isRightMouseDown: true, consumeMouseDelta: () => ({ dx: 0, dy: 0 }) }
  for (let frame = 0; frame < 60; frame++) orbit.update(input, 1 / 60, obstacles)
  return { camera, orbit, player }
}

describe('first-person hero clearance', () => {
  it.each([
    { hero: 'viking-hero-t4' as const, offset: 1.1 },
    { hero: undefined, offset: .55 },
    { hero: 'roman-hero-t4' as const, offset: .55 },
    { hero: 'maki-archer-t4' as const, offset: .55 },
  ])('$hero aims at forward offset $offset without changing the reticle direction or FOV', ({ hero, offset }) => {
    const { camera, orbit, player } = aimedCamera(hero)
    expect(camera.position.z).toBeCloseTo(offset, 4)
    expect(camera.position.y).toBeCloseTo(40.8, 4)
    expect(orbit.getAimDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-8)
    expect(camera.fov).toBeCloseTo(28, 4)
    expect(player.position.toArray()).toEqual([0, 40, 0])
  })

  it('captain clearance still stops before a wall intersecting the extended camera ray', () => {
    const { camera } = aimedCamera('viking-hero-t4', [obstacle([-2, 39, .8], [2, 43, 1.3])])
    expect(camera.position.z).toBeCloseTo(.68, 4)
    expect(camera.position.z).toBeLessThan(.8)
  })
})
