import { describe, expect, it } from 'vitest'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { WeaponWheel } from '../../src/player/WeaponWheel'

describe('Shared immediate weapon wheel', () => {
  it('skips equipped items and switches sword / bow / shield in stable order both ways', () => {
    const inv = new InventoryManager({ meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'wooden_shortbow', shieldId: 'scutum_t1' })
    const wheel = new WeaponWheel()
    expect(wheel.cycle(inv, 1)).toBe('wooden_shortbow')
    expect(inv.equippedShield).toBeNull()
    expect(inv.rangedEnabled).toBe(true)
    expect(wheel.cycle(inv, 1)).toBe('scutum_t1')
    expect(inv.rangedEnabled).toBe(false)
    expect(wheel.cycle(inv, -1)).toBe('wooden_shortbow')
    expect(inv.inventoryStacks).toHaveLength(3)
  })

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

  it('does nothing when every usable item is already equipped', () => {
    const inv = new InventoryManager({ meleeWeaponId: 'gladius_rusty', rangedWeaponId: '', shieldId: 'scutum_t1' })
    expect(new WeaponWheel().cycle(inv, 1)).toBeNull()
  })
})
