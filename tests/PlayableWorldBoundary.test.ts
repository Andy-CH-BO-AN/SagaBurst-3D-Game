import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Mount, MountType } from '../src/world/Mount'
import {
  PLAYABLE_WORLD_BOUND,
  TERRAIN_SIZE,
  clampToPlayableWorld,
} from '../src/world/Terrain'

describe('Playable world boundary', () => {
  it('uses most of the 640m terrain while preserving a 20m edge margin', () => {
    expect(TERRAIN_SIZE).toBe(640)
    expect(PLAYABLE_WORLD_BOUND).toBe(300)
    expect(TERRAIN_SIZE / 2 - PLAYABLE_WORLD_BOUND).toBe(20)
  })

  it('allows movement beyond the old ±95m clamp', () => {
    const position = new THREE.Vector3(150, 7, -150)

    clampToPlayableWorld(position)

    expect(position.x).toBe(150)
    expect(position.y).toBe(7)
    expect(position.z).toBe(-150)
  })

  it('clamps X/Z at ±300m without changing height', () => {
    const position = new THREE.Vector3(350, 12, -340)

    clampToPlayableWorld(position)

    expect(position.x).toBe(PLAYABLE_WORLD_BOUND)
    expect(position.y).toBe(12)
    expect(position.z).toBe(-PLAYABLE_WORLD_BOUND)
  })

  it('applies the same boundary to controlled mounts', () => {
    const scene = new THREE.Scene()
    const mount = new Mount(scene, MountType.CORGI, PLAYABLE_WORLD_BOUND - 0.5, 0)

    mount.beginControlledFrame()
    mount.addControlledMovement(new THREE.Vector3(1, 0, 0), 20, 0.1)
    mount.finishControlledFrame(0.1, [])

    expect(mount.group.position.x).toBe(PLAYABLE_WORLD_BOUND)
    expect(Math.abs(mount.group.position.z)).toBeLessThanOrEqual(PLAYABLE_WORLD_BOUND)
  })
})
