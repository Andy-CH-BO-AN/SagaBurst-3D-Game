/**
 * InventoryManager.ts
 * Manages player inventory, owned weapon stacks (quantity tracking), equipped weapons, and save state.
 */
import { WEAPONS, WeaponData } from './WeaponDatabase'

export interface InventoryStack {
  id: string
  quantity: number
}

export class InventoryManager {
  private items: InventoryStack[] = [
    { id: 'steel_sword', quantity: 1 },
    { id: 'recurve_longbow', quantity: 1 },
  ]

  private equippedMeleeId: string  = 'steel_sword'
  private equippedRangedId: string = 'recurve_longbow'

  get inventoryStacks(): { weapon: WeaponData; quantity: number }[] {
    return this.items
      .map(item => ({ weapon: WEAPONS[item.id], quantity: item.quantity }))
      .filter((entry): entry is { weapon: WeaponData; quantity: number } => entry.weapon !== undefined)
  }

  get equippedMelee(): WeaponData {
    return WEAPONS[this.equippedMeleeId] || WEAPONS['steel_sword']
  }

  get equippedRanged(): WeaponData {
    return WEAPONS[this.equippedRangedId] || WEAPONS['recurve_longbow']
  }

  get saveState(): { items: InventoryStack[]; equippedMeleeId: string; equippedRangedId: string } {
    return {
      items: this.items.map(item => ({ ...item })),
      equippedMeleeId: this.equippedMeleeId,
      equippedRangedId: this.equippedRangedId,
    }
  }

  loadSaveState(state: { items?: InventoryStack[]; ownedWeaponIds?: string[]; equippedMeleeId?: string; equippedRangedId?: string }): void {
    if (state.items && state.items.length > 0) {
      this.items = state.items.map(i => ({ id: i.id, quantity: i.quantity || 1 }))
    } else if (state.ownedWeaponIds && state.ownedWeaponIds.length > 0) {
      this.items = state.ownedWeaponIds.map(id => ({ id, quantity: 1 }))
    }

    if (state.equippedMeleeId && WEAPONS[state.equippedMeleeId]) {
      this.equippedMeleeId = state.equippedMeleeId
    }
    if (state.equippedRangedId && WEAPONS[state.equippedRangedId]) {
      this.equippedRangedId = state.equippedRangedId
    }
  }

  addWeapon(id: string): number {
    if (!WEAPONS[id]) return 0

    const existing = this.items.find(item => item.id === id)
    if (existing) {
      existing.quantity += 1
      return existing.quantity
    } else {
      this.items.push({ id, quantity: 1 })
      return 1
    }
  }

  equipWeapon(id: string): boolean {
    const weapon = WEAPONS[id]
    if (!weapon) return false
    const hasItem = this.items.some(item => item.id === id)
    if (!hasItem) return false

    if (weapon.type === 'melee') {
      this.equippedMeleeId = id
      return true
    } else if (weapon.type === 'ranged') {
      this.equippedRangedId = id
      return true
    }
    return false
  }

  isEquipped(id: string): boolean {
    return this.equippedMeleeId === id || this.equippedRangedId === id
  }
}
