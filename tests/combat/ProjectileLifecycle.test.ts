import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as THREE from 'three'
import { ArrowProjectile } from '../../src/world/ArrowProjectile'
import { BallisticIntercept, createProjectileFlightBudget } from '../../src/combat/ProjectileBallistics'
import { setScenePlayableWorldBound, type ObstacleData } from '../../src/world/Terrain'
import { Faction } from '../../src/world/NPC'
import type { DamageReceiver } from '../../src/combat/DamageReceiver'
import type { Player } from '../../src/player/Player'

// Collision-disabled Player boundary; zero Player/NPC/Mount constructors or assets.
const untargetablePlayer = { targetable: false, currentMount: null, characterFaction: 'viking' } as Player
function update(arrow: ArrowProjectile, dt: number, obstacles: ObstacleData[] = [], visualOnly = false): void {
  arrow.update(dt, untargetablePlayer, [], obstacles, () => {}, () => { throw new Error('unexpected Player hit') }, undefined, visualOnly)
}
function projectile(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, flightTime: number) {
  const scene = new THREE.Scene()
  setScenePlayableWorldBound(scene, 350)
  const arrow = new ArrowProjectile(scene, origin, direction, speed, 25, Faction.PLAYER, false, 'arrow', undefined,
    createProjectileFlightBudget(speed, flightTime))
  onTestFinished(() => arrow.destroy())
  return arrow
}

describe('projectile scene bounds and shot-specific cleanup', () => {
  it.each([[200, 45], [300, 55], [400, 65], [500, 110]])('a physical %dm shot at %dm/s reaches its receiver and applies damage once', (range, speed) => {
    const group = new THREE.Group()
    group.position.set(range / 2, 30, 330)
    const received = vi.fn((amount: number) => amount)
    const target: DamageReceiver = { group, combatPosition: group.position, isMounted: false,
      damageTarget: { targetType: 'training', targetId: 'far-target', name: 'Far target' }, receiveDamage: received }
    const origin = new THREE.Vector3(-range / 2, 31.4, 330), arc = new BallisticIntercept()
    expect(arc.solve(origin, group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), new THREE.Vector3(), speed)).toBe(true)
    const arrow = projectile(origin, arc.direction, speed, arc.flightTime)
    const hit = vi.fn()
    for (let step = 0; step < 900 && arrow.isAlive; step++) {
      arrow.update(1 / 60, untargetablePlayer, [], [], hit, () => { throw new Error('unexpected Player hit') }, undefined, false, [], [target])
    }
    expect(received).toHaveBeenCalledExactlyOnceWith(25)
    expect(hit).toHaveBeenCalledTimes(1)
    expect(arrow.isAlive).toBe(false)
    arrow.update(1 / 60, untargetablePlayer, [], [], hit, () => { throw new Error('unexpected Player hit') }, undefined, false, [], [target])
    expect(received).toHaveBeenCalledTimes(1)
  })
  it('keeps an in-bounds Town corner shot outside the old 400m origin sphere alive', () => {
    const arrow = projectile(new THREE.Vector3(330, 40, 330), new THREE.Vector3(-1, .1, 0), 65, 8)
    update(arrow, .1)
    expect(arrow.mesh.position.length()).toBeGreaterThan(400)
    expect(arrow.isAlive).toBe(true)
    expect(arrow.isStuck).toBe(false)
  })
  it('integrates a 400m flight beyond five seconds to its physical intercept without Euler drop drift', () => {
    const arc = new BallisticIntercept(), origin = new THREE.Vector3(0, 31.4, -200)
    expect(arc.solve(origin, new THREE.Vector3(0, 11.4, 200), new THREE.Vector3(), 65)).toBe(true)
    const arrow = projectile(origin, arc.direction, 65, arc.flightTime)
    for (let time = 0; time < arc.flightTime;) {
      const dt = Math.min(1 / 60, arc.flightTime - time)
      update(arrow, dt, [], true)
      time += dt
    }
    expect(arc.flightTime).toBeGreaterThan(5)
    expect(arrow.isAlive).toBe(true)
    expect(arrow.mesh.position.distanceTo(new THREE.Vector3(0, 11.4, 200))).toBeLessThan(1e-7)
  })
  it('expires visual-only Town shots by their own flight budget and removes the mesh exactly once', () => {
    const scene = new THREE.Scene()
    const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, 1, 0), 20, 10,
      Faction.PLAYER, false, 'arrow', undefined, { maxLifetimeSeconds: 1, maxTravelDistance: 100 })
    onTestFinished(() => arrow.destroy())
    update(arrow, 1, [], true)
    expect(arrow.isAlive).toBe(true)
    update(arrow, .01, [], true)
    expect(arrow.isAlive).toBe(false)
    expect(arrow.mesh.parent).toBeNull()
    arrow.destroy()
    expect(scene.children).toHaveLength(0)
  })
  it.each(['boundary', 'travel', 'invalid'] as const)('cleans up an illegal %s shot even in visual-only mode', reason => {
    const scene = new THREE.Scene()
    const arrow = new ArrowProjectile(scene, new THREE.Vector3(reason === 'boundary' ? 323 : 0, 100, 0),
      new THREE.Vector3(1, 0, 0), reason === 'invalid' ? NaN : 65, 10, Faction.PLAYER, false, 'arrow', undefined,
      { maxLifetimeSeconds: 10, maxTravelDistance: reason === 'travel' ? 1 : 1000 })
    onTestFinished(() => arrow.destroy())
    update(arrow, .1, [], true)
    expect(arrow.isAlive).toBe(false)
    expect(arrow.mesh.parent).toBeNull()
  })
  it('sweeps a thin wall and never moves or applies a second contact after sticking', () => {
    const arrow = projectile(new THREE.Vector3(0, 40, 0), new THREE.Vector3(0, 0, 1), 65, 8)
    const obstacle: ObstacleData = { isBarricade: true, box: new THREE.Box3(new THREE.Vector3(-5, 0, 2), new THREE.Vector3(5, 100, 2.01)) }
    update(arrow, .1, [obstacle])
    expect(arrow.isStuck).toBe(true)
    expect(arrow.mesh.position.z).toBeCloseTo(2)
    const impact = arrow.mesh.position.clone()
    update(arrow, .1, [obstacle])
    expect(arrow.mesh.position.equals(impact)).toBe(true)
  })
})
