/**
 * InventoryManager.ts
 * Manages player inventory, owned weapon stacks (quantity tracking), equipped weapons, and save state.
 */
import { defaultRangerMeleeWeaponId, T4_RANGER_BOW_RANGED_ID, WEAPONS, WeaponData } from './WeaponDatabase'
import { ARMORS, ArmorData } from './ArmorDatabase'
import { type PlayerHeroId } from '../world/HeroAssetCatalog'
import {
  acquireEquipmentDemand, isEquipmentReady, releaseAllEquipmentDemands,
  releaseEquipmentDemand, resolveEquipmentSlot, retryEquipmentNow,
} from '../world/HighTierEquipment'

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
  protected get combatRestricted(): boolean { return false }
  private drawnRanged = true
  private drawnMelee = true
  private drawnShield = true
  get rangedEnabled(): boolean { return !this.combatRestricted && this.drawnRanged }
  set rangedEnabled(value: boolean) { this.drawnRanged = value }
  get meleeEnabled(): boolean { return !this.combatRestricted && this.drawnMelee }
  set meleeEnabled(value: boolean) { this.drawnMelee = value }
  get shieldEnabled(): boolean { return !this.combatRestricted && this.drawnShield }
  set shieldEnabled(value: boolean) { this.drawnShield = value }
  private items: InventoryStack[]
  private equippedMeleeId: string
  private equippedRangedId: string
  private equippedShieldId: string | null
  /** What the hands really hold. A selected item waiting for its model stays selected and saved, with no combat effect. */
  private heldMeleeId: string | null = null
  private heldShieldId: string | null = null

  constructor(initialLoadout?: InitialPlayerLoadout, heroId?: PlayerHeroId | null,
    faction: 'viking' | 'roman' = 'viking') {
    const loadout = { ...(initialLoadout ?? (heroId === 'maki-archer-t4'
      ? { meleeWeaponId: defaultRangerMeleeWeaponId(faction), rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null }
      : LEGACY_LOADOUT)) }
    this.equippedMeleeId = loadout.meleeWeaponId
    this.equippedRangedId = loadout.rangedWeaponId
    this.equippedShieldId = loadout.shieldId
    if (this.equippedMeleeId) acquireEquipmentDemand(this.equippedMeleeId, this)
    if (this.equippedShieldId) acquireEquipmentDemand(this.equippedShieldId, this)
    this.meleeEnabled = Boolean(loadout.meleeWeaponId)
    this.rangedEnabled = Boolean(loadout.rangedWeaponId) && !loadout.shieldId
    this.items = initialLoadout || heroId === 'maki-archer-t4'
      ? [
          ...(loadout.meleeWeaponId ? [{ id: loadout.meleeWeaponId, quantity: 1 }] : []),
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

  get equippedMelee(): WeaponData | undefined {
    this.heldMeleeId = resolveEquipmentSlot(this.equippedMeleeId, this.heldMeleeId, this)
    return this.heldMeleeId ? WEAPONS[this.heldMeleeId] : undefined
  }

  /** Authoritative drawn melee slot; ownership alone never selects an attack. */
  get activeMelee(): WeaponData | undefined {
    return this.meleeEnabled ? this.equippedMelee : undefined
  }

  get equippedRanged(): WeaponData {
    return WEAPONS[this.equippedRangedId] || WEAPONS['elven_runebow']
  }

  /** The ranged weapon actually selected; unlike equippedRanged it never falls back to a default bow. */
  get selectedRanged(): WeaponData | undefined { return WEAPONS[this.equippedRangedId] }

  get equippedShield(): ArmorData | null {
    this.heldShieldId = resolveEquipmentSlot(this.equippedShieldId, this.heldShieldId, this)
    return this.heldShieldId ? ARMORS[this.heldShieldId] : null
  }

  get saveState() {
    return {
      items: this.items.map(item => ({ ...item })),
      equippedMeleeId: this.equippedMeleeId,
      equippedRangedId: this.equippedRangedId,
      equippedShieldId: this.equippedShieldId,
      rangedEnabled: this.rangedEnabled,
    }
  }

  /** A loaded save is a fresh selection: nothing held before it may stand in for an item still loading. */
  loadSaveState(state: { items?: InventoryStack[]; ownedWeaponIds?: string[]; equippedMeleeId?: string; equippedRangedId?: string; equippedShieldId?: string | null; rangedEnabled?: boolean }): void {
    if (this.equippedMeleeId) releaseEquipmentDemand(this.equippedMeleeId, this)
    if (this.equippedShieldId) releaseEquipmentDemand(this.equippedShieldId, this)
    this.heldMeleeId = this.heldShieldId = null
    if (state.items) {
      this.items = state.items.map(i => ({ id: i.id, quantity: i.quantity || 1 }))
    } else if (state.ownedWeaponIds && state.ownedWeaponIds.length > 0) {
      this.items = state.ownedWeaponIds.map(id => ({ id, quantity: 1 }))
    }
    const merged = new Map<string, number>()
    for (const stack of this.items) {
      const id = stack.id
      merged.set(id, (merged.get(id) ?? 0) + stack.quantity)
    }
    this.items = [...merged].map(([id, quantity]) => ({ id, quantity }))

    this.items = this.items.filter(item => WEAPONS[item.id] || ARMORS[item.id])
    if (state.equippedMeleeId === '') {
      this.equippedMeleeId = ''
    } else if (state.equippedMeleeId && WEAPONS[state.equippedMeleeId]?.type === 'melee' && this.canEquipWeapon(state.equippedMeleeId)) {
      this.equippedMeleeId = state.equippedMeleeId
    } else if (!this.canEquipWeapon(this.equippedMeleeId)) {
      this.equippedMeleeId = this.items.find(item => WEAPONS[item.id]?.type === 'melee')?.id ?? ''
    }
    if (this.equippedMeleeId) acquireEquipmentDemand(this.equippedMeleeId, this)
    this.meleeEnabled = this.meleeEnabled && Boolean(this.equippedMeleeId)
    if (state.equippedRangedId && WEAPONS[state.equippedRangedId]?.type === 'ranged' && this.canEquipWeapon(state.equippedRangedId)) {
      this.equippedRangedId = state.equippedRangedId
    } else if (!this.canEquipWeapon(this.equippedRangedId)) {
      this.equippedRangedId = this.items.find(item => WEAPONS[item.id]?.type === 'ranged')?.id ?? ''
    }
    if (state.equippedShieldId && ARMORS[state.equippedShieldId]) {
      this.equippedShieldId = state.equippedShieldId
    } else if (state.equippedShieldId === null) {
      this.equippedShieldId = null
    }
    if (this.equippedShieldId) acquireEquipmentDemand(this.equippedShieldId, this)
    this.rangedEnabled = !this.equippedShieldId && Boolean(this.equippedRangedId) && (state.rangedEnabled ?? true)
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

  /** A pickup must not replace an allocated item, including a sheathed or still-loading one. */
  pickupDisposition(id: string): 'equip' | 'backpack' {
    if (this.items.some(item => item.id === id)) return 'backpack'
    const weapon = WEAPONS[id]
    if (weapon?.type === 'melee' && !this.equippedMeleeId) return 'equip'
    if (weapon?.type === 'ranged' && !this.equippedRangedId && !this.equippedShieldId) return 'equip'
    if (ARMORS[id]?.type === 'shield' && !this.equippedShieldId && !this.equippedRangedId) return 'equip'
    return 'backpack'
  }

  canEquipWeapon(id: string): boolean {
    const weapon = WEAPONS[id]
    const armor = ARMORS[id]
    if (!weapon && !armor) return false
    const hasItem = this.items.some(item => item.id === id)
    if (!hasItem) return false
    return true
  }

  protected removeOwnedItem(id: string): void {
    this.items = this.items.filter(item => item.id !== id)
    if (this.heldMeleeId === id) this.heldMeleeId = null
    if (this.heldShieldId === id) this.heldShieldId = null
    if (this.equippedMeleeId === id) {
      releaseEquipmentDemand(id, this)
      this.equippedMeleeId = ''
      this.meleeEnabled = false
    }
    if (this.equippedRangedId === id) { this.equippedRangedId = ''; this.rangedEnabled = false }
    if (this.equippedShieldId === id) {
      releaseEquipmentDemand(id, this)
      this.equippedShieldId = null
      this.shieldEnabled = false
    }
  }

  equipWeapon(id: string): boolean {
    if (!this.canEquipWeapon(id)) return false
    retryEquipmentNow(id, this)
    const weapon = WEAPONS[id], armor = ARMORS[id]

    if (weapon) {
      if (weapon.type === 'melee') {
        if (this.equippedMeleeId && this.equippedMeleeId !== id) {
          releaseEquipmentDemand(this.equippedMeleeId, this)
        }
        this.equippedMeleeId = id
        acquireEquipmentDemand(id, this)
        this.meleeEnabled = true
        return true
      } else if (weapon.type === 'ranged') {
        if (this.equippedShieldId) {
          releaseEquipmentDemand(this.equippedShieldId, this)
          this.equippedShieldId = null
        }
        this.equippedRangedId = id
        this.rangedEnabled = true
        return true
      }
    } else if (armor) {
      if (armor.type === 'shield') {
        if (this.equippedShieldId && this.equippedShieldId !== id) {
          releaseEquipmentDemand(this.equippedShieldId, this)
        }
        this.equippedShieldId = id
        acquireEquipmentDemand(id, this)
        this.shieldEnabled = true
        this.rangedEnabled = false
        return true
      }
    }
    return false
  }

  unequipWeapon(_id: string): boolean { return false }
  itemAvailability(id: string): string { return isEquipmentReady(id) ? '' : '模型載入中，暫時無法使用' }
  isAllocated(id: string): boolean { return this.isEquipped(id) }
  get supportsWeaponRelease(): boolean { return false }
  /** True when the shield really came off. */
  unequipShield(): boolean {
    if (this.equippedShieldId) releaseEquipmentDemand(this.equippedShieldId, this)
    this.equippedShieldId = this.heldShieldId = null
    return true
  }

  dispose(): void {
    releaseAllEquipmentDemands(this)
  }

  isEquipped(id: string): boolean {
    return (this.meleeEnabled && this.equippedMeleeId === id)
      || (this.rangedEnabled && this.equippedRangedId === id)
      || (this.shieldEnabled && this.equippedShieldId === id)
  }
}
