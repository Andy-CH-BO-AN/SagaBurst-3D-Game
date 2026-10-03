import { InventoryManager } from '../rpg/InventoryManager'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import { cloneCareerProfile, getCareerPurchaseTier, type CareerProfile } from '../career/CareerProfile'
import { careerTownWeapon, isTownShopWeapon } from './TownRules'
export function canUseCareerEquipment(profile: CareerProfile, id: string): boolean {
  const item = WEAPONS[id] ?? ARMORS[id]
  return Boolean(item && item.tier <= getCareerPurchaseTier(profile.rank) && (Boolean(ARMORS[id]) || isTownShopWeapon(id))
    && (Boolean(ARMORS[id]) ? profile.ownedArmors : profile.ownedWeapons).includes(id))
}
/** Temporary hand state is separate from persisted preferences and ownership. */
export class TownEquipment extends InventoryManager {
  override meleeEnabled = false
  override rangedEnabled = false
  override shieldEnabled = false
  private readonly drawn = new Set<string>()
  constructor(private readonly read: () => CareerProfile, private readonly commit: (p: CareerProfile) => boolean) {
    super({ meleeWeaponId: careerTownWeapon(read()), rangedWeaponId: '', shieldId: null })
    this.loadSaveState({ items: [...read().ownedWeapons, ...read().ownedArmors].map(id => ({ id, quantity: 1 })) })
    this.rangedEnabled = false
  }
  private syncOwnership(): void {
    const profile = this.read()
    const existing = new Set(this.saveState.items.map(item => item.id))
    for (const id of new Set([...profile.ownedWeapons, ...profile.ownedArmors])) {
      if (!existing.has(id)) this.addWeapon(id)
    }
  }
  restoreForHostile(): void {
    this.syncOwnership()
    for (const id of Object.values(this.read().equipment ?? {})) {
      if (!id || !canUseCareerEquipment(this.read(), id) || !super.equipWeapon(id)) continue
      this.drawn.add(id)
      if (ARMORS[id]) this.shieldEnabled = true
      else if (WEAPONS[id].type === 'melee') this.meleeEnabled = true
      else this.rangedEnabled = true
    }
  }
  prepareForCombat(): void {
    this.restoreForHostile()
    if (this.meleeEnabled || this.rangedEnabled) return
    const fallback = [this.read().starterWeaponId, careerTownWeapon(this.read())]
      .find((id): id is string => Boolean(id && canUseCareerEquipment(this.read(), id)))
    if (!fallback || !super.equipWeapon(fallback)) return
    this.drawn.add(fallback)
    if (WEAPONS[fallback]?.type === 'ranged') this.rangedEnabled = true
    else this.meleeEnabled = true
  }
  sheathAll(): void {
    this.meleeEnabled = false
    this.rangedEnabled = false
    this.shieldEnabled = false
    this.drawn.clear()
  }
  override get inventoryStacks() { this.syncOwnership(); return super.inventoryStacks.filter(({ item }) => canUseCareerEquipment(this.read(), item.id)) }
  override isEquipped(id: string): boolean { return this.drawn.has(id) && super.isEquipped(id) }
  override equipWeapon(id: string): boolean {
    if (!canUseCareerEquipment(this.read(), id)) return false
    this.syncOwnership()
    const item = WEAPONS[id] ?? ARMORS[id], profile = cloneCareerProfile(this.read())
    const slot = Boolean(ARMORS[id]) ? 'shield' : item.type === 'ranged' ? 'ranged' : 'melee'
    profile.equipment = { ...profile.equipment, [slot]: id }
    if (slot === 'shield') delete profile.equipment.ranged
    if (slot === 'ranged') profile.equipment.shield = null
    if (!this.commit(profile) || !super.equipWeapon(id)) return false
    this.drawn.add(id)
    if (slot === 'melee') this.meleeEnabled = true
    if (slot === 'ranged') this.rangedEnabled = true
    if (slot === 'shield') this.shieldEnabled = true
    return true
  }
  override canEquipWeapon(id: string): boolean {
    return canUseCareerEquipment(this.read(), id) && super.canEquipWeapon(id)
  }
  override unequipShield(): void {
    const profile = cloneCareerProfile(this.read()); profile.equipment = { ...profile.equipment, shield: null }
    if (this.commit(profile)) { this.shieldEnabled = false; super.unequipShield() }
  }
}
