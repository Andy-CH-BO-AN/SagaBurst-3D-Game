/**
 * InventoryManager.ts
 * Manages player inventory, owned weapon stacks (quantity tracking), equipped weapons, and save state.
 */
import { T4_RANGER_BOW_RANGED_ID, WEAPONS, WeaponData } from './WeaponDatabase'
import { ARMORS, ArmorData } from './ArmorDatabase'
import { getHeroFixedEquipment, type PlayerHeroId } from '../world/HeroAssetCatalog'

export interface InventoryStack {
  id: string
  quantity: number
}

/** Generic game-start equipment input; intentionally independent of BattleConfig. */
export interface InitialPlayerLoadout {
  meleeWeaponId: string
  rangedWeaponId: string
  shieldId: string | null
}

const LEGACY_LOADOUT: InitialPlayerLoadout = {
  meleeWeaponId: 'steel_lance',
  rangedWeaponId: 'elven_runebow',
  shieldId: 'round_shield_t3',
}

export class InventoryManager {
  rangedEnabled = true
  meleeEnabled = true
  shieldEnabled = true
  private items: InventoryStack[]
  private equippedMeleeId: string
  private equippedRangedId: string
  private equippedShieldId: string | null

  constructor(initialLoadout?: InitialPlayerLoadout, private readonly heroId?: PlayerHeroId | null) {
    const fixed = getHeroFixedEquipment(heroId)
    const loadout = { ...(initialLoadout ?? LEGACY_LOADOUT), ...fixed }
    if (heroId === 'maki-archer-t4' && WEAPONS[loadout.rangedWeaponId]?.combatKind !== 'bow') {
      loadout.rangedWeaponId = T4_RANGER_BOW_RANGED_ID
    }
    this.equippedMeleeId = loadout.meleeWeaponId
    this.equippedRangedId = loadout.rangedWeaponId
    this.equippedShieldId = loadout.shieldId
    this.items = initialLoadout || fixed
      ? [
          { id: loadout.meleeWeaponId, quantity: 1 },
          ...(loadout.rangedWeaponId ? [{ id: loadout.rangedWeaponId, quantity: 1 }] : []),
          ...(loadout.shieldId ? [{ id: loadout.shieldId, quantity: 1 }] : []),
        ]
      : [
          { id: 'steel_lance', quantity: 1 },
          { id: 'runic_greatsword', quantity: 1 },
          { id: 'elven_runebow', quantity: 1 },
          { id: 'round_shield_t3', quantity: 1 },
        ]
  }

  get inventoryStacks(): { item: WeaponData | ArmorData; quantity: number }[] {
    return this.items
      .map<{ item: WeaponData | ArmorData | undefined; quantity: number }>(stack => {
        const item = WEAPONS[stack.id] || ARMORS[stack.id]
        return { item, quantity: stack.quantity }
      })
      .filter((entry): entry is { item: WeaponData | ArmorData; quantity: number } => entry.item !== undefined)
  }

  get equippedMelee(): WeaponData {
    return WEAPONS[this.equippedMeleeId] || WEAPONS['steel_lance']
  }

  get equippedRanged(): WeaponData {
    return WEAPONS[this.equippedRangedId] || WEAPONS['elven_runebow']
  }

  get equippedShield(): ArmorData | null {
    return this.equippedShieldId ? ARMORS[this.equippedShieldId] : null
  }

  get saveState(): { items: InventoryStack[]; equippedMeleeId: string; equippedRangedId: string; equippedShieldId: string | null } {
    return {
      items: this.items.map(item => ({ ...item })),
      equippedMeleeId: this.equippedMeleeId,
      equippedRangedId: this.equippedRangedId,
      equippedShieldId: this.equippedShieldId,
    }
  }

  loadSaveState(state: { items?: InventoryStack[]; ownedWeaponIds?: string[]; equippedMeleeId?: string; equippedRangedId?: string; equippedShieldId?: string | null }): void {
    if (state.items && state.items.length > 0) {
      this.items = state.items.map(i => ({ id: i.id, quantity: i.quantity || 1 }))
    } else if (state.ownedWeaponIds && state.ownedWeaponIds.length > 0) {
      this.items = state.ownedWeaponIds.map(id => ({ id, quantity: 1 }))
    }

    const fixed = getHeroFixedEquipment(this.heroId)
    // A save from Ranger must not equip its asset-only bow on another character.
    if (!fixed) this.items = this.items.filter(item => item.id !== 'maki-ranger-bow')
    if (state.equippedMeleeId && WEAPONS[state.equippedMeleeId]
      && (fixed || state.equippedMeleeId !== 'maki-ranger-bow')) {
      this.equippedMeleeId = state.equippedMeleeId
    }
    if (state.equippedRangedId && WEAPONS[state.equippedRangedId]) {
      this.equippedRangedId = state.equippedRangedId
    }
    if (state.equippedShieldId && ARMORS[state.equippedShieldId]) {
      this.equippedShieldId = state.equippedShieldId
    } else if (state.equippedShieldId === null) {
      this.equippedShieldId = null
    }
    if (fixed) {
      this.equippedMeleeId = fixed.meleeWeaponId
      this.equippedShieldId = fixed.shieldId
      if (!this.items.some(item => item.id === fixed.meleeWeaponId)) this.addWeapon(fixed.meleeWeaponId)
    }
    if (this.heroId === 'maki-archer-t4' && WEAPONS[this.equippedRangedId]?.combatKind !== 'bow') {
      this.equippedRangedId = T4_RANGER_BOW_RANGED_ID
      if (!this.items.some(item => item.id === T4_RANGER_BOW_RANGED_ID)) this.addWeapon(T4_RANGER_BOW_RANGED_ID)
    }
  }

  addWeapon(id: string): number {
    if (!WEAPONS[id] && !ARMORS[id]) return 0

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
    const armor = ARMORS[id]
    if (!weapon && !armor) return false
    if (getHeroFixedEquipment(this.heroId) && (weapon?.type === 'melee' || armor?.type === 'shield')) return false
    if (this.heroId === 'maki-archer-t4' && weapon?.type === 'ranged' && weapon.combatKind !== 'bow') return false
    const hasItem = this.items.some(item => item.id === id)
    if (!hasItem) return false

    if (weapon) {
      if (weapon.type === 'melee') {
        this.equippedMeleeId = id
        return true
      } else if (weapon.type === 'ranged') {
        this.equippedRangedId = id
        return true
      }
    } else if (armor) {
      if (armor.type === 'shield') {
        this.equippedShieldId = id
        return true
      }
    }
    return false
  }

  unequipShield(): void { this.equippedShieldId = null }

  isEquipped(id: string): boolean {
    return this.equippedMeleeId === id || this.equippedRangedId === id || this.equippedShieldId === id
  }
}
