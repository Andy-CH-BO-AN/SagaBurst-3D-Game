import type { InventoryManager } from '../rpg/InventoryManager'

/** Stable inventory order prevents an excluded equipped item from shifting the cursor. */
export class WeaponWheel {
  private cursor: string | null = null

  cycle(inventory: InventoryManager, direction: -1 | 1): string | null {
    const items = inventory.inventoryStacks.filter(({ item, quantity }) => quantity > 0 && inventory.canEquipWeapon(item.id))
    const current = items.findIndex(({ item }) => item.id === (this.cursor ?? inventory.equippedMelee.id))
    const start = current < 0 ? (direction === 1 ? -1 : 0) : current
    for (let offset = 1; offset <= items.length; offset++) {
      const item = items[(start + direction * offset + items.length * 2) % items.length].item
      if (!inventory.isEquipped(item.id) && inventory.equipWeapon(item.id)) {
        this.cursor = item.id
        return item.id
      }
    }
    return null
  }
}
