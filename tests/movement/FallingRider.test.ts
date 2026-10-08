import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FallingRider, riderFallDamage, parseFallingRiderSnapshot } from '../../src/movement/FallingRider'
import type { ObstacleData } from '../../src/world/Terrain'

describe('Falling rider shared rules (zero actors)', () => {
  it.each([
    [0, 150], [7.5, 75], [14, 10], [14.999, .01], [15, 0], [20, 0],
  ])('150 maximum HP at %sm loses exact max-HP fraction and leaves %s HP', (height, remaining) => {
    expect(Math.max(0, 150 - riderFallDamage(150, height))).toBeCloseTo(remaining, 7)
  })
  it('uses maximum HP so an injured rider dies below the lethal-height threshold', () => {
    expect(Math.max(0, 50 - riderFallDamage(150, 7.5))).toBe(0)
  })
  it('tracks an inherited upward velocity apex and settles only once', () => {
    const fall = new FallingRider(), feet = new THREE.Vector3(0, 10, 0)
    fall.begin(feet, new THREE.Vector3(0, 11, 0))
    let height: number | null = null
    for (let frame = 0; frame < 300 && height === null; frame++) height = fall.update(feet, 1 / 60, [], 300, () => 0)
    expect(height).toBeCloseTo(12.75, 7)
    expect(fall.update(feet, 1, [], 300, () => 0)).toBeNull()
  })
  it('uses the first roof support rather than terrain below it', () => {
    const fall = new FallingRider(), feet = new THREE.Vector3(0, 20, 0)
    const roof: ObstacleData = { box: new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 8, 5)), isBarricade: false }
    fall.begin(feet, new THREE.Vector3())
    let height: number | null = null
    for (let frame = 0; frame < 300 && height === null; frame++) height = fall.update(feet, 1 / 60, [roof], 300, () => 0)
    expect(height).toBeCloseTo(12)
    expect(feet.y).toBe(8)
  })
  it('side collisions preserve the highest feet point and a repeated begin cannot reset it', () => {
    const fall = new FallingRider(), feet = new THREE.Vector3(0, 12, 0)
    const wall: ObstacleData = { box: new THREE.Box3(new THREE.Vector3(1, 0, -3), new THREE.Vector3(1.1, 30, 3)), isBarricade: false }
    fall.begin(feet, new THREE.Vector3(10, 0, 0))
    expect(fall.update(feet, .2, [wall], 300, () => 0)).toBeNull()
    expect(feet.x).toBeLessThan(1)
    fall.begin(feet, new THREE.Vector3())
    expect(fall.highestFeetY).toBe(12)
    let height: number | null = null
    for (let frame = 0; frame < 300 && height === null; frame++) height = fall.update(feet, 1 / 60, [wall], 300, () => 0)
    expect(height).toBeCloseTo(12)
  })
  it('accepts slope support at the actual feet landing coordinate and restores pending semantics', () => {
    const fall = new FallingRider(), feet = new THREE.Vector3(0, 10, 0)
    fall.begin(feet, new THREE.Vector3(2, 0, 0))
    fall.update(feet, .2, [], 300, x => x / 2)
    const restored = new FallingRider()
    restored.restore(parseFallingRiderSnapshot(JSON.parse(JSON.stringify(fall.snapshot())))!)
    let height: number | null = null
    for (let frame = 0; frame < 300 && height === null; frame++) height = restored.update(feet, 1 / 60, [], 300, x => x / 2)
    expect(height).toBeCloseTo(10 - feet.x / 2)
    expect(feet.y).toBeCloseTo(feet.x / 2)
  })
})
