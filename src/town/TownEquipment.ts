import { availableCareerItem, canAllocateCareerItemToPlayer, careerItemTotal, normalizeCareerInventory } from '../career/CareerInventory'
import { InventoryManager } from '../rpg/InventoryManager'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import { cloneCareerProfile, getCareerPurchaseTier, type CareerProfile } from '../career/CareerProfile'
import { careerTownWeapon, isTownShopWeapon } from './TownRules'
export function canUseCareerEquipment(profile: CareerProfile, id: string): boolean {
  const item = WEAPONS[id] ?? ARMORS[id]
  return Boolean(item && item.tier <= getCareerPurchaseTier(profile.rank) && (Boolean(ARMORS[id]) || isTownShopWeapon(id))
    && canAllocateCareerItemToPlayer(profile, id))
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
  syncOwnership(): void {
    const profile = this.read()
    const owned = new Set([...profile.ownedWeapons, ...profile.ownedArmors])
    for (const { id } of this.saveState.items) {
      if (owned.has(id)) continue
      this.removeOwnedItem(id)
      this.drawn.delete(id)
    }
    const existing = new Set(this.saveState.items.map(item => item.id))
    for (const id of owned) {
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
    const fallback = [this.read().starterWeaponId, careerTownWeapon(this.read()), ...this.read().ownedWeapons]
      .find((id): id is string => Boolean(id && canUseCareerEquipment(this.read(), id)))
    if (fallback) this.equipWeapon(fallback)
  }
  sheathAll(): void {
    this.meleeEnabled = false
    this.rangedEnabled = false
    this.shieldEnabled = false
    this.drawn.clear()
  }
  override get inventoryStacks() { this.syncOwnership(); return super.inventoryStacks.filter(({ item }) => { const data = WEAPONS[item.id] ?? ARMORS[item.id]; return data && data.tier <= getCareerPurchaseTier(this.read().rank) }).map(stack => ({ ...stack, quantity: careerItemTotal(this.read(), stack.item.id) })) }
  override isEquipped(id: string): boolean { return this.drawn.has(id) && super.isEquipped(id) }
  override isAllocated(id: string): boolean { return Object.values(this.read().equipment ?? {}).includes(id) }
  override itemAvailability(id: string): string { return `總持有 ${careerItemTotal(this.read(), id)} · 可用 ${availableCareerItem(this.read(), id)}` }
  override equipWeapon(id: string): boolean {
    if (!canUseCareerEquipment(this.read(), id)) return false
    this.syncOwnership()
    const item = WEAPONS[id] ?? ARMORS[id], profile = cloneCareerProfile(this.read())
    normalizeCareerInventory(profile)
    const slot = Boolean(ARMORS[id]) ? 'shield' : item.type === 'ranged' ? 'ranged' : 'melee'
    profile.equipment = { ...profile.equipment, [slot]: id }
    if (slot === 'shield') delete profile.equipment.ranged
    if (slot === 'ranged') profile.equipment.shield = null
    if (!this.commit(profile)) return false
    super.equipWeapon(id)
    this.drawn.add(id)
    if (slot === 'melee') this.meleeEnabled = true
    if (slot === 'ranged') { this.rangedEnabled = true; this.shieldEnabled = false }
    if (slot === 'shield') this.shieldEnabled = true
    return true
  }
  override get supportsWeaponRelease(): boolean { return true }
  override unequipWeapon(id: string): boolean {
    const profile = cloneCareerProfile(this.read())
    normalizeCareerInventory(profile)
    const slot = (['melee', 'ranged', 'shield'] as const).find(slot => profile.equipment?.[slot] === id)
    if (!slot) return false
    delete profile.equipment![slot]
    if (!this.commit(profile)) return false
    this.drawn.delete(id)
    this.removeOwnedItem(id)
    this.syncOwnership()
    return true
  }
  override canEquipWeapon(id: string): boolean {
    return canUseCareerEquipment(this.read(), id) && super.canEquipWeapon(id)
  }
  override unequipShield(): void {
    const profile = cloneCareerProfile(this.read()); normalizeCareerInventory(profile); profile.equipment = { ...profile.equipment, shield: null }
    if (this.commit(profile)) { this.shieldEnabled = false; super.unequipShield() }
  }
}
