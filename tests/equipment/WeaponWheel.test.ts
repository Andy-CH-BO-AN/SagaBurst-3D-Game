import { describe, expect, it } from 'vitest'
import { InventoryManager } from '../../src/rpg/InventoryManager'

describe('Shared immediate weapon wheel', () => {

  it('excludes a ranged weapon from shields through equip and save/load', () => {
    const ranged = 'wooden_shortbow'
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

  it('discards invalid saved items without converting IDs or granting replacement stock', () => {
    const inv = new InventoryManager(undefined, 'maki-archer-t4')
    inv.loadSaveState({ items: [{ id: 'lance_t4', quantity: 1 }, { id: 'maki-ranger-bow', quantity: 1 },
      { id: 'missing-weapon', quantity: 1 }, { id: 'paladin_mace_t4', quantity: 2 }, { id: 'maki-ranger-bow-ranged', quantity: 1 }],
      equippedMeleeId: 'lance_t4', equippedRangedId: 'maki-ranger-bow-ranged' })
    expect(inv.equippedMelee.id).toBe('paladin_mace_t4')
    expect(inv.saveState.items).toEqual([{ id: 'paladin_mace_t4', quantity: 2 }, { id: 'maki-ranger-bow-ranged', quantity: 1 }])
    expect(inv.canEquipWeapon('lance_t4')).toBe(false)
    expect(inv.canEquipWeapon('maki-ranger-bow')).toBe(false)
    expect(inv.isEquipped('maki-ranger-bow-ranged')).toBe(true)
    const saved = inv.saveState
    inv.loadSaveState(saved)
    expect(inv.saveState).toEqual(saved)
  })
})
