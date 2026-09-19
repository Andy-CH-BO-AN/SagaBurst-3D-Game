import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  createEmptyArmyConfig,
  type BattleConfig,
  validateBattleConfig,
} from '../src/battle/BattleConfig'
import { shouldCreateStartingHorse } from '../src/Game'
import { Player } from '../src/player/Player'
import { InventoryManager } from '../src/rpg/InventoryManager'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'

const battleConfig = (): BattleConfig => ({
  viking: { ...createEmptyArmyConfig(), infantry: { 1: 1, 2: 0, 3: 0 } },
  roman: { ...createEmptyArmyConfig(), infantry: { 1: 1, 2: 0, 3: 0 } },
  rules: { respawnEnabled: false, includeCamps: true },
})

describe('Player loadout configuration', () => {
  it('accepts legacy, Viking, Roman, and mixed loadouts while rejecting invalid IDs and mounted values', () => {
    const legacy = battleConfig()
    expect(validateBattleConfig(legacy).valid).toBe(true)

    const roman = { ...battleConfig(), playerLoadout: { meleeWeaponId: 'gladius_standard', rangedWeaponId: 'pilum_standard', shieldId: 'scutum_t2', startMounted: false } } as const
    const mixed = { ...battleConfig(), playerLoadout: { meleeWeaponId: 'steel_sword', rangedWeaponId: 'legionary_pilum', shieldId: 'round_shield_t1', startMounted: true } } as const
    expect(validateBattleConfig(roman).valid).toBe(true)
    expect(validateBattleConfig(mixed).valid).toBe(true)
    expect(validateBattleConfig({ ...battleConfig(), playerLoadout: { ...roman.playerLoadout, meleeWeaponId: 'not_a_weapon' } }).valid).toBe(false)
    expect(validateBattleConfig({ ...battleConfig(), playerLoadout: { ...roman.playerLoadout, rangedWeaponId: 'not_a_weapon' } }).valid).toBe(false)
    expect(validateBattleConfig({ ...battleConfig(), playerLoadout: { ...roman.playerLoadout, shieldId: 'not_a_shield' } }).valid).toBe(false)
    expect(validateBattleConfig({ ...battleConfig(), playerLoadout: { ...roman.playerLoadout, startMounted: 'yes' } }).valid).toBe(false)
  })

  it('initializes an explicit loadout without unselected legacy T3 equipment', () => {
    const inventory = new InventoryManager({ meleeWeaponId: 'gladius_standard', rangedWeaponId: 'pilum_standard', shieldId: 'scutum_t2' })
    expect(inventory.equippedMelee.id).toBe('gladius_standard')
    expect(inventory.equippedRanged.id).toBe('pilum_standard')
    expect(inventory.equippedShield?.id).toBe('scutum_t2')
    expect(inventory.inventoryStacks.map(stack => stack.item.id)).toEqual(['gladius_standard', 'pilum_standard', 'scutum_t2'])

    const unshielded = new InventoryManager({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'wooden_shortbow', shieldId: null })
    expect(unshielded.equippedShield).toBeNull()
    expect(unshielded.inventoryStacks.map(stack => stack.item.id)).toEqual(['steel_sword', 'wooden_shortbow'])
  })

  it('uses shared Roman gladius and existing Scutum geometry', () => {
    const gladius = new THREE.Group()
    WeaponMeshFactory.buildMelee('gladius_standard', gladius)
    expect(gladius.getObjectByName('roman-gladius-profiled-blade')).toBeDefined()
    const scutum = new THREE.Group()
    WeaponMeshFactory.buildShield('scutum_t2', scutum)
    expect(scutum.getObjectByName('curved-scutum-board')).toBeDefined()
  })

  it('switches Pilum to the right hand without CharacterBowVisual and emits a Pilum projectile', () => {
    const player = new Player(new THREE.Scene())
    player.rebuildRangedWeapon('pilum_standard')
    const raw = player as any
    expect(player.rangedVisualKind).toBe('pilum')
    expect(raw.bowVisual).toBeNull()
    expect(raw.bowPivot.parent).toBe(raw.rig.right.handSocket)

    player.setArrowCount(2)
    const onFireArrow = vi.fn()
    player.onFireArrow = onFireArrow
    raw._firePilum(new THREE.Vector3(0, 1, -10), 1, { ...raw.pendingRangedWeapon, id: 'pilum_standard', animationKind: 'pilum', arrowSpeedMax: 48, damageMax: 42 })
    expect(onFireArrow).toHaveBeenCalledWith(expect.objectContaining({ visualKind: 'pilum', speed: 48, damage: 42 }))
    expect(player.arrowCount).toBe(1)

    player.rebuildRangedWeapon('elven_runebow')
    expect(player.rangedVisualKind).toBe('bow')
    expect(raw.bowVisual).not.toBeNull()
    expect(raw.bowPivot.parent).toBe(raw.rig.left.handSocket)
  })

  it('keeps legacy mounted starts and respects explicit on-foot and spectator starts', () => {
    expect(shouldCreateStartingHorse()).toBe(true)
    expect(shouldCreateStartingHorse({ ...battleConfig(), playerLoadout: { meleeWeaponId: 'steel_lance', rangedWeaponId: 'elven_runebow', shieldId: 'round_shield_t3', startMounted: true } })).toBe(true)
    expect(shouldCreateStartingHorse({ ...battleConfig(), playerLoadout: { meleeWeaponId: 'steel_lance', rangedWeaponId: 'elven_runebow', shieldId: null, startMounted: false } })).toBe(false)
    expect(shouldCreateStartingHorse({ ...battleConfig(), spectator: true, playerLoadout: { meleeWeaponId: 'steel_lance', rangedWeaponId: 'elven_runebow', shieldId: null, startMounted: true } })).toBe(false)
  })
})
