import { describe, expect, it } from 'vitest'
import { InventoryManager } from '../../src/rpg/InventoryManager'

describe('Shared immediate weapon wheel', () => {

  it.each(['wooden_shortbow', 'pilum_basic'])('excludes %s from shields through equip and save/load', ranged => {
    const inv = new InventoryManager({ meleeWeaponId: 'gladius_rusty', rangedWeaponId: ranged, shieldId: 'scutum_t1' }, 'maki-archer-t4', 'roman')
    expect(inv.equippedMelee.id).toBe('gladius_rusty')
    inv.addWeapon('paladin_mace_t4')
    expect(inv.equipWeapon('paladin_mace_t4')).toBe(true)
    expect(inv.equipWeapon(ranged)).toBe(true)
    const restored = new InventoryManager(undefined, 'maki-archer-t4', 'roman'); restored.loadSaveState(inv.saveState)
    expect(restored.isEquipped(ranged)).toBe(true)
    expect(restored.equippedShield).toBeNull()
    restored.equipWeapon('scutum_t1')
    const guarded = new InventoryManager(undefined, 'maki-archer-t4', 'roman'); guarded.loadSaveState(restored.saveState)
    expect(guarded.isEquipped(ranged)).toBe(false)
    expect(guarded.isEquipped('scutum_t1')).toBe(true)
    guarded.unequipShield()
    expect(guarded.isEquipped(ranged)).toBe(false)
  })

  it('replaces an exhausted legacy bow-melee allocation once across save and restore', () => {
    const inv = new InventoryManager(undefined, 'maki-archer-t4', 'roman')
    inv.loadSaveState({ items: [{ id: 'maki-ranger-bow', quantity: 1 }, { id: 'maki-ranger-bow-ranged', quantity: 1 }],
      equippedMeleeId: 'maki-ranger-bow', equippedRangedId: 'maki-ranger-bow-ranged' })
    expect(inv.equippedMelee.id).toBe('centurion_blade')
    expect(inv.saveState.items).toEqual([{ id: 'maki-ranger-bow-ranged', quantity: 1 }, { id: 'centurion_blade', quantity: 1 }])
    const saved = inv.saveState
    inv.loadSaveState(saved)
    expect(inv.saveState).toEqual(saved)
    expect(inv.canEquipWeapon('maki-ranger-bow')).toBe(false)
  })

  it('preserves purchased melee stock when removing the legacy forced bow-melee choice', () => {
    const inv = new InventoryManager(undefined, 'maki-archer-t4')
    inv.loadSaveState({ items: [{ id: 'maki-ranger-bow', quantity: 1 }, { id: 'paladin_mace_t4', quantity: 2 }],
      equippedMeleeId: 'maki-ranger-bow' })
    expect(inv.equippedMelee.id).toBe('paladin_mace_t4')
    expect(inv.saveState.items).toEqual([{ id: 'paladin_mace_t4', quantity: 2 }])
  })
})
