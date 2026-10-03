import { describe, expect, it } from 'vitest'
import { InventoryManager } from '../src/rpg/InventoryManager'
import { WeaponWheel } from '../src/player/WeaponWheel'
import { TownEquipment } from '../src/town/TownEquipment'
import { createCareerProfile } from '../src/career/CareerProfile'
import { CareerProfileStore } from '../src/career/CareerProfileStore'

describe('shared immediate weapon wheel', () => {
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

  it('Career selection persists exclusivity, respects failed writes and restores after returning', () => {
    let profile = createCareerProfile('roman')
    profile.ownedWeapons = ['gladius_rusty', 'pilum_basic']
    profile.ownedArmors = ['scutum_t1']
    let canSave = true
    const inv = new TownEquipment(() => profile, next => { if (!canSave) return false; profile = next; return true })
    expect(inv.rangedEnabled).toBe(false)
    expect(inv.equipWeapon('pilum_basic')).toBe(true)
    expect(inv.equipWeapon('scutum_t1')).toBe(true)
    expect(profile.equipment?.ranged).toBeUndefined()
    canSave = false
    expect(inv.equipWeapon('pilum_basic')).toBe(false)
    expect(inv.isEquipped('scutum_t1')).toBe(true)
    canSave = true
    expect(inv.equipWeapon('pilum_basic')).toBe(true)
    expect(profile.equipment?.shield).toBeNull()
    const data = new Map<string, string>()
    const store = new CareerProfileStore({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) }, removeItem: k => { data.delete(k) } })
    expect(store.save(profile)).toBe(true)
    profile = store.load()!
    const returned = new TownEquipment(() => profile, () => true)
    returned.prepareForCombat()
    expect(returned.isEquipped('pilum_basic')).toBe(true)
    expect(returned.equippedShield).toBeNull()
    returned.sheathAll()
    expect(new WeaponWheel().cycle(returned, 1)).toBe('pilum_basic')
  })
})
