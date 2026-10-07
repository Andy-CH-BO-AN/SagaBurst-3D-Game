import { describe, expect, it, beforeEach } from 'vitest'
import { InventoryManager } from '../../src/rpg/InventoryManager'

describe('Default Mounted Loadout & Inventory', () => {
  let inventory: InventoryManager

  beforeEach(() => {
    inventory = new InventoryManager()
  })

  it('initializes default inventory with elite heavy cavalry items (lance, greatsword, runebow, t3 shield)', () => {
    const stacks = inventory.inventoryStacks
    const itemIds = stacks.map(s => s.item.id)

    expect(itemIds).toContain('steel_lance')
    expect(itemIds).toContain('runic_greatsword')
    expect(itemIds).toContain('elven_runebow')
    expect(itemIds).toContain('round_shield_t3')

    const lanceStack = stacks.find(s => s.item.id === 'steel_lance')
    const greatswordStack = stacks.find(s => s.item.id === 'runic_greatsword')
    const runebowStack = stacks.find(s => s.item.id === 'elven_runebow')
    const shieldStack = stacks.find(s => s.item.id === 'round_shield_t3')

    expect(lanceStack?.quantity).toBe(1)
    expect(greatswordStack?.quantity).toBe(1)
    expect(runebowStack?.quantity).toBe(1)
    expect(shieldStack?.quantity).toBe(1)
  })

  it('equips Steel Lance and Shield, keeping Elven Runebow stowed by default', () => {
    expect(inventory.equippedMelee.id).toBe('steel_lance')
    expect(inventory.equippedRanged.id).toBe('elven_runebow')
    expect(inventory.equippedShield?.id).toBe('round_shield_t3')

    expect(inventory.isEquipped('steel_lance')).toBe(true)
    expect(inventory.isEquipped('elven_runebow')).toBe(false)
    expect(inventory.isEquipped('round_shield_t3')).toBe(true)
  })

  it('keeps Runic Greatsword owned in backpack without default equipping', () => {
    expect(inventory.isEquipped('runic_greatsword')).toBe(false)
    const stacks = inventory.inventoryStacks
    const greatsword = stacks.find(s => s.item.id === 'runic_greatsword')
    expect(greatsword).toBeDefined()
    expect(greatsword?.item.tier).toBe(3)
  })

  it('allows equipping Runic Greatsword on foot/dismount via standard inventory flow', () => {
    const success = inventory.equipWeapon('runic_greatsword')
    expect(success).toBe(true)
    expect(inventory.equippedMelee.id).toBe('runic_greatsword')
    expect(inventory.isEquipped('runic_greatsword')).toBe(true)
    expect(inventory.isEquipped('steel_lance')).toBe(false)
    expect(inventory.equippedMelee.damageMax).toBe(45)
    expect(inventory.equippedMelee.animationKind).toBe('sword')

    // Shield remains equipped and the unified one-handed sword keeps it in the guard hand.
    expect(inventory.equippedShield?.id).toBe('round_shield_t3')
  })
})
