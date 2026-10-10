import { describe, expect, it } from 'vitest'
import { createTrainingInventory } from '../../src/training/TrainingGroundPlan'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { ARMORS } from '../../src/rpg/ArmorDatabase'

describe('Training equipment policy (no actors or assets)', () => {
  it('offers one copy of every official equipment entry without creating extra tiers', () => {
    const inventory = createTrainingInventory()
    expect(inventory.inventoryStacks.map(({ item }) => item.id).sort()).toEqual([...Object.keys(WEAPONS), ...Object.keys(ARMORS)].sort())
    expect(inventory.inventoryStacks.every(({ quantity }) => quantity === 1)).toBe(true)
  })

  it.each([...Object.values(WEAPONS), ...Object.values(ARMORS)].filter(item => item.id !== 'maki-ranger-bow').map(item => [item.id] as const))(
    'equips official %s for the ordinary fighter', id => {
      const inventory = createTrainingInventory()
      expect(inventory.equipWeapon(id)).toBe(true)
      expect(inventory.isEquipped(id)).toBe(true)
      expect(inventory.inventoryStacks.find(({ item }) => item.id === id)?.quantity).toBe(1)
    },
  )

  it('exposes the Ranger melee bow through its official fixed loadout and keeps hero restrictions', () => {
    const ordinary = createTrainingInventory()
    expect(ordinary.equipWeapon('maki-ranger-bow')).toBe(false)
    const ranger = createTrainingInventory('maki-archer-t4')
    expect(ranger.isEquipped('maki-ranger-bow')).toBe(true)
    expect(ranger.equippedShield).toBeNull()
    expect(ranger.equipWeapon('steel_sword')).toBe(false)
    expect(ranger.equipWeapon('scutum_t3')).toBe(false)
    expect(ranger.equipWeapon('pilum_standard')).toBe(false)
    expect(ranger.equipWeapon('maki-ranger-bow-ranged')).toBe(true)
  })
})
