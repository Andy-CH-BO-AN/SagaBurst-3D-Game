import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { COMBAT_ANIMATION_PROFILES } from '../../src/world/CharacterCombatAnimator'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { WeaponMeshFactory } from '../../src/world/WeaponMeshFactory'

describe('Weapon combat profiles', () => {
  it('Lance mesh length in WeaponMeshFactory remains 2.6m (mesh length unchanged)', () => {
    const parent = new THREE.Group()
    const { tipLocal } = WeaponMeshFactory.buildMelee('steel_lance', parent)
    expect(tipLocal.y).toBeCloseTo(2.6, 2)
  })

  it('Attack cadence: unmounted lance is 0.42s (faster than sword 0.48s), mounted lance is 0.28s', () => {
    const mounted = COMBAT_ANIMATION_PROFILES['mountedLance']
    const mountedTotal = mounted.windup + mounted.active + mounted.recovery
    expect(mountedTotal).toBeCloseTo(0.28, 2)

    const unmounted = COMBAT_ANIMATION_PROFILES['lanceThrust']
    const unmountedTotal = unmounted.windup + unmounted.active + unmounted.recovery
    expect(unmountedTotal).toBeCloseTo(0.42, 2)

    // Swords remain 0.48s
    const sword = COMBAT_ANIMATION_PROFILES['swordSlash']
    const swordTotal = sword.windup + sword.active + sword.recovery
    expect(swordTotal).toBeCloseTo(0.48, 2)

    // Unmounted lance (0.42s) is faster than sword (0.48s)
    expect(unmountedTotal).toBeLessThan(swordTotal)
    // Mounted lance (0.28s) has rapid thrust cadence
    expect(mountedTotal).toBeLessThan(unmountedTotal)

    // UI text display
    expect(WEAPONS['steel_lance'].speedOrCharge).toBe(0.42)
    expect(WEAPONS['steel_lance'].range).toBe(3.9)
  })

  it('Swords retain unchanged range and animation profile (no regression)', () => {
    const sword = COMBAT_ANIMATION_PROFILES['swordSlash']
    expect(sword.windup + sword.active + sword.recovery).toBeCloseTo(0.48, 2)
    expect(WEAPONS['steel_sword'].range).toBe(1.8)
  })
})
