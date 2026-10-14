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
  it('rebinds a replacement actor without losing a partial aim transition or obstacle recovery', () => {
    // Camera-only contract: two presentation records, no actors or GLBs.
    const make = () => {
      const camera = new THREE.PerspectiveCamera()
      const player = { position: new THREE.Vector3(0, 40, 0), facingYaw: 0,
        isMounted: false, isRangedAimViewActive: true }
      const orbit = new ThirdPersonCamera(camera, player as Player)
      orbit.setYaw(-Math.PI)
      return { camera, player, orbit }
    }
    const reference = make(), rebound = make()
    const input = { keys: {}, isRightMouseDown: false, consumeMouseDelta: () => ({ dx: 0, dy: 0 }) }
    const wall = obstacle([-4, 39, -4], [4, 44, -3])
    for (let frame = 0; frame < 3; frame++) {
      reference.orbit.update(input, 1 / 60, [wall]); rebound.orbit.update(input, 1 / 60, [wall])
    }
    expect(rebound.camera.fov).toBeGreaterThan(28); expect(rebound.camera.fov).toBeLessThan(58)
    const replacement = { ...rebound.player, position: new THREE.Vector3(3, 40, 0), isRangedAimViewActive: false }
    rebound.orbit.followPlayer(replacement as Player)
    reference.player.position.copy(replacement.position); reference.player.isRangedAimViewActive = false
    for (let frame = 0; frame < 10; frame++) {
      reference.orbit.update(input, 1 / 60); rebound.orbit.update(input, 1 / 60)
      expect(rebound.camera.fov).toBeCloseTo(reference.camera.fov, 10)
      expect(rebound.camera.position.distanceTo(reference.camera.position)).toBeLessThan(1e-10)
      expect(rebound.camera.quaternion.angleTo(reference.camera.quaternion)).toBeLessThan(1e-7)
    }
  })

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

  it('collides with physical projectileBoxes planks while ignoring empty headroom inside coarse envelopes', () => {
    // Stair obstacle: coarse envelope from y=0 to 4m, but solid step plank only at y=3.86 to 4.0m
    const stepPlank = new THREE.Box3(new THREE.Vector3(-2, 3.86, 3), new THREE.Vector3(2, 4.0, 5))
    const stairObstacle: ObstacleData = {
      box: new THREE.Box3(new THREE.Vector3(-2, 0, 3), new THREE.Vector3(2, 4, 5)),
      isBarricade: false,
      projectileBoxes: [stepPlank],
    }

    // Camera ray 1: passes through open headroom under the stair (at y=1.5 < 3.86) -> not blocked
    const underRay = resolveCameraDistance(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 0, 1), 6, [stairObstacle])
    expect(underRay).toBe(6)

    // Camera ray 2: aimed directly at the step plank (at y=3.95) -> collides with margin
    const hitRay = resolveCameraDistance(new THREE.Vector3(0, 3.95, 0), new THREE.Vector3(0, 0, 1), 6, [stairObstacle])
    // Step box starts at z=3, margin is 0.28 -> distance is 3 - 0.28 = 2.72
    expect(hitRay).toBeCloseTo(2.72, 5)
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
