import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  DAMAGEABLE_OBSTACLE_HP,
  DamageableObstacle,
} from './DamageableObstacle'

describe('DamageableObstacle', () => {
  it('applies damage and destroys exactly once at zero HP', () => {
    const scene = new THREE.Scene()
    const root = new THREE.Group()
    scene.add(root)
    const onDestroyed = vi.fn()
    const obstacle = new DamageableObstacle({
      kind: 'tree',
      maxHp: 100,
      root,
      ownerFaction: null,
    })
    obstacle.onDestroyed(onDestroyed)

    expect(obstacle.takeDamage(35)).toMatchObject({
      appliedDamage: 35,
      remainingHp: 65,
      destroyed: false,
    })
    expect(obstacle.hpRatio).toBeCloseTo(0.65)

    const lethal = obstacle.takeDamage(100)
    expect(lethal.appliedDamage).toBe(65)
    expect(lethal.remainingHp).toBe(0)
    expect(lethal.destroyed).toBe(true)
    expect(root.parent).toBeNull()
    expect(root.visible).toBe(false)
    expect(onDestroyed).toHaveBeenCalledTimes(1)

    obstacle.takeDamage(10)
    obstacle.destroy()
    expect(onDestroyed).toHaveBeenCalledTimes(1)
  })

  it('ignores invalid or non-positive damage', () => {
    const obstacle = new DamageableObstacle({
      kind: 'gate',
      maxHp: DAMAGEABLE_OBSTACLE_HP.gate,
      root: new THREE.Group(),
      ownerFaction: 'roman',
    })

    expect(obstacle.takeDamage(0).appliedDamage).toBe(0)
    expect(obstacle.takeDamage(-10).appliedDamage).toBe(0)
    expect(obstacle.takeDamage(Number.NaN).appliedDamage).toBe(0)
    expect(obstacle.currentHp).toBe(DAMAGEABLE_OBSTACLE_HP.gate)
  })

  it('allows neutral obstacles and enemy-owned structures but rejects friendly structures', () => {
    const neutralTree = new DamageableObstacle({
      kind: 'tree',
      maxHp: DAMAGEABLE_OBSTACLE_HP.tree,
      root: new THREE.Group(),
      ownerFaction: null,
    })
    const romanGate = new DamageableObstacle({
      kind: 'gate',
      maxHp: DAMAGEABLE_OBSTACLE_HP.gate,
      root: new THREE.Group(),
      ownerFaction: 'roman',
    })

    expect(neutralTree.isDamageableBy('roman')).toBe(true)
    expect(neutralTree.isDamageableBy('viking')).toBe(true)
    expect(romanGate.isDamageableBy('roman')).toBe(false)
    expect(romanGate.isDamageableBy('viking')).toBe(true)
  })

  it('rejects invalid maximum HP', () => {
    expect(() => new DamageableObstacle({
      kind: 'palisade',
      maxHp: 0,
      root: new THREE.Group(),
    })).toThrow(/maxHp/)
  })
})
