import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { CharacterCombatAnimator, COMBAT_ANIMATION_PROFILES, meleeActionTimeScale, AXE_HIT_TIMES } from '../../src/world/CharacterCombatAnimator'
import type { CharacterRig } from '../../src/world/CharacterVisuals'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { WeaponMeshFactory } from '../../src/world/WeaponMeshFactory'

describe('Weapon combat profiles', () => {
  it.each([
    ['paladin_sword_t4', 'sword', 60, .48, 1],
    ['paladin_mace_t4', 'axe', 55, .54, 12],
  ] as const)('%s has shared T4 damage, cadence and fixed shield impact', (id, animationKind, damage, cycle, shieldImpact) => {
    expect(WEAPONS[id]).toMatchObject({ tier: 4, combatKind: 'sword', animationKind,
      damageMin: damage, damageMax: damage, speedOrCharge: cycle, meleeCycleSeconds: cycle, shieldImpact })
  })

  it.each(['axeAttack1H', 'axeAttack2H'] as const)('%s retimes Mace playback, one contact and completion together', action => {
    const animation = { has: () => true, play: vi.fn(), update: vi.fn(), setEquipmentState: vi.fn() }
    // Only the animator-to-renderer boundary is replaced; actual event clock runs.
    const rig = { animation } as unknown as CharacterRig
    const animator = new CharacterCombatAnimator(rig, new THREE.Group(), new THREE.Group())
    const scale = meleeActionTimeScale(action, WEAPONS.paladin_mace_t4, 1.5)
    expect(animator.start(action, scale)).toBe(true)
    expect(animation.play).toHaveBeenLastCalledWith(action, expect.objectContaining({ timeScale: expect.closeTo(4 / 3, 12) }))
    const contact = AXE_HIT_TIMES[action] / scale
    expect(animator.update(contact - .001).hitActiveStarted).toBe(false)
    expect(animator.update(.002).hitActiveStarted).toBe(true)
    expect(animator.update(.36 - contact - .002).actionCompleted).toBe(false)
    const events = animator.update(.002)
    expect(events.actionCompleted).toBe(true)
    expect(events.hitActiveStarted).toBe(false)
    expect(meleeActionTimeScale(action, WEAPONS.viking_axe_t3, 1.5)).toBe(1.5)
  })
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


it.each([
  ['wooden_shortbow', 1, 8, 22, 12, 45, .8],
  ['recurve_longbow', 2, 15, 42, 18, 55, 1.2],
  ['elven_runebow', 3, 28, 75, 25, 65, 1.8],
  ['maki-ranger-bow-ranged', 4, 40, 100, 40, 110, 1.8],
] as const)('%s keeps its authoritative bow charge, speed and damage profile', (id, tier, damageMin, damageMax, arrowSpeedMin, arrowSpeedMax, speedOrCharge) => {
  expect(WEAPONS[id]).toMatchObject({ tier, type: 'ranged', combatKind: 'bow', damageMin, damageMax, arrowSpeedMin, arrowSpeedMax, speedOrCharge })
})

it.each([
  ['pilum_basic', 1, 8, 22, 12, 18, .8],
  ['pilum_standard', 2, 15, 42, 14, 24, 1.2],
  ['legionary_pilum', 3, 28, 75, 16, 30, 1.8],
] as const)('%s preserves the complete javelin profile', (id, tier, damageMin, damageMax, arrowSpeedMin, arrowSpeedMax, speedOrCharge) => {
  expect(WEAPONS[id]).toMatchObject({ tier, combatKind: 'javelin', damageMin, damageMax, arrowSpeedMin, arrowSpeedMax, speedOrCharge })
})
