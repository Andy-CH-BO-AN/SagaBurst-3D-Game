import { describe, expect, it } from 'vitest'
import { InventoryManager } from '../../src/rpg/InventoryManager'

describe('Shared immediate weapon wheel', () => {

  it.each(['wooden_shortbow', 'pilum_basic'])('excludes %s from shields through equip and save/load', ranged => {
    const inv = new InventoryManager({ meleeWeaponId: 'gladius_rusty', rangedWeaponId: ranged, shieldId: 'scutum_t1' })
    inv.equipWeapon(ranged)
    const restored = new InventoryManager(); restored.loadSaveState(inv.saveState)
    expect(restored.isEquipped(ranged)).toBe(true)
    expect(restored.equippedShield).toBeNull()
    restored.equipWeapon('scutum_t1')
    const guarded = new InventoryManager(); guarded.loadSaveState(restored.saveState)
    expect(guarded.isEquipped(ranged)).toBe(false)
    expect(guarded.isEquipped('scutum_t1')).toBe(true)
    guarded.unequipShield()
    expect(guarded.isEquipped(ranged)).toBe(false)
  })
})
