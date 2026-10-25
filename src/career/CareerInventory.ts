import { allocatedTownEquipment, validateTownEquipment } from './CareerTownEquipmentState'
import type { CareerProfile, CareerMountId } from './CareerProfile'
import type { PersonalSquadMemberType } from './CareerPersonalSquad'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { defaultRangerMeleeWeaponId, T4_RANGER_BOW_RANGED_ID, WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import { PLAYER_MOUNT_IDS, type PlayerMountId } from '../battle/BattleConfig'
import { defaultPersonalRecruitmentChoice, resolvePersonalRecruitment } from './CareerRecruitmentCatalog'

/** Concurrent canonical ownership, including assigned, reserve and unavailable eagles. */
export const MAX_PLAYER_OWNED_XONGKORO = 3

export interface CareerInventory { version: 1; quantities: Record<string, number> }
export interface PersonalEquipment { melee: string | null; ranged: string | null; shield: string | null; mount: PlayerMountId | null }
export type PersonalEquipmentSlot = keyof PersonalEquipment
export function canonicalInventoryId(id: string): string {
  return ['horse-t1', 'horse-t2', 'horse-t3'].includes(id) ? 'horse' : id
}
export function isTradableCareerItem(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(WEAPONS, id) || Object.prototype.hasOwnProperty.call(ARMORS, id) || (PLAYER_MOUNT_IDS as readonly string[]).includes(id)
}
export function initialPersonalEquipment(type: PersonalSquadMemberType, faction: CareerProfile['faction']): PersonalEquipment {
  return resolvePersonalRecruitment(faction, defaultPersonalRecruitmentChoice(type, faction))!.equipment
}
/** Pre-inventory hires had T2 Soldier and T3 Captain gear; migration must preserve that grant. */
export function legacyPersonalEquipment(type: PersonalSquadMemberType, faction: CareerProfile['faction']): PersonalEquipment {
  return personalEquipmentAtTier(type, faction, type === 'soldier' ? 2 : type === 'captain' ? 3 : 2)
}
function personalEquipmentAtTier(type: PersonalSquadMemberType, faction: CareerProfile['faction'], weaponTier: 1 | 2 | 3): PersonalEquipment {
  if (type === 'ranger') return { melee: defaultRangerMeleeWeaponId(faction), ranged: T4_RANGER_BOW_RANGED_ID, shield: null, mount: 'horse' }
  const presetId = `${faction}_${type === 'soldier' ? faction === 'roman' ? 'heavy_infantry' : 'berserker' : 'sword_cavalry'}` as UnitPresetId
  const loadouts = UNIT_PRESETS[presetId].tierLoadouts
  // Legacy grants keep their original shields and mounts.
  return { melee: loadouts[weaponTier].meleeWeaponId ?? null, ranged: null,
    shield: loadouts[type === 'soldier' ? 2 : 3].shieldId ?? null, mount: type === 'soldier' ? null : 'horse' }
}
/** Legacy ownership is read only until the first transaction or load normalizes it. */
export function careerItemTotals(profile: CareerProfile): Record<string, number> {
  if (profile.inventory) return profile.inventory.quantities
  const ids = [...profile.ownedArmors, ...profile.ownedMounts,
    ...(profile.ownedHorseTiers?.length ? ['horse'] : [])].map(canonicalInventoryId).filter(isTradableCareerItem)
  const totals: Record<string, number> = Object.fromEntries([...new Set(ids)].map(id => [id, 1]))
  for (const id of new Set(profile.ownedWeapons)) {
    if (!isTradableCareerItem(id)) continue
    const canonical = canonicalInventoryId(id)
    totals[canonical] = (totals[canonical] ?? 0) + 1
  }
  return totals
}
export function careerItemTotal(profile: CareerProfile, id: string): number { return careerItemTotals(profile)[canonicalInventoryId(id)] ?? 0 }
export function careerItemAllocated(profile: CareerProfile, rawId: string): number {
  const id = canonicalInventoryId(rawId)
  let count = Object.values(profile.equipment ?? {}).filter(value => value === id).length
  if (profile.selectedMountId && canonicalInventoryId(profile.selectedMountId) === id) count++
  for (const member of profile.personalSquad?.members ?? []) {
    if (!member.equipment) continue
    count += Object.values(member.equipment).filter(value => value === id).length
  }
  return count + allocatedTownEquipment(profile, id)
}
export function availableCareerItem(profile: CareerProfile, id: string): number {
  return Math.max(0, careerItemTotal(profile, id) - careerItemAllocated(profile, id))
}
export function playerHasAllocation(profile: CareerProfile, rawId: string): boolean {
  const id = canonicalInventoryId(rawId)
  return Object.values(profile.equipment ?? {}).includes(id)
    || Boolean(profile.selectedMountId && canonicalInventoryId(profile.selectedMountId) === id)
}
export function canAllocateCareerItemToPlayer(profile: CareerProfile, id: string): boolean {
  return careerItemTotal(profile, id) > 0 && (playerHasAllocation(profile, id) || availableCareerItem(profile, id) > 0)
}
/** Compatibility ownership arrays are projections, never an independent quantity source. */
export function syncCareerOwnership(profile: CareerProfile): void {
  const ids = Object.keys(profile.inventory!.quantities).filter(id => profile.inventory!.quantities[id] > 0)
  profile.ownedWeapons = ids.filter(id => Boolean(WEAPONS[id]))
  profile.ownedArmors = ids.filter(id => Boolean(ARMORS[id]))
  profile.ownedMounts = ids.filter(id => (PLAYER_MOUNT_IDS as readonly string[]).includes(id)) as PlayerMountId[]
  if (!profile.ownedMounts.includes('horse')) delete profile.ownedHorseTiers
}
export function addCareerItem(profile: CareerProfile, id: string, delta: number): void {
  normalizeCareerInventory(profile)
  const canonical = canonicalInventoryId(id)
  if (!isTradableCareerItem(canonical)) throw new Error('Invalid inventory item')
  const count = (profile.inventory!.quantities[canonical] ?? 0) + delta
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid inventory quantity')
  if (count < careerItemAllocated(profile, canonical)) throw new Error('Allocated inventory item')
  if (count) profile.inventory!.quantities[canonical] = count
  else delete profile.inventory!.quantities[canonical]
  syncCareerOwnership(profile)
}
export function validPersonalEquipment(_type: PersonalSquadMemberType, equipment: PersonalEquipment): boolean {
  if (Object.values(equipment).some(id => id !== null && typeof id !== 'string')) return false
  return Boolean((equipment.melee || equipment.ranged)
    && (!equipment.melee || isTradableCareerItem(equipment.melee) && WEAPONS[equipment.melee]?.type === 'melee')
    && (!equipment.ranged || isTradableCareerItem(equipment.ranged) && WEAPONS[equipment.ranged]?.type === 'ranged')
    && (!equipment.shield || ARMORS[equipment.shield]?.type === 'shield')
    && (!equipment.mount || (PLAYER_MOUNT_IDS as readonly string[]).includes(equipment.mount)))
}
/** Mutates only a newly parsed/staged profile. The marker prevents repeated recruitment grants. */
export function normalizeCareerInventory(profile: CareerProfile): void {
  validateTownEquipment(profile)
  const legacy = !profile.inventory
  const totals: Record<string, number> = {}
  const grant = (id: string) => {
    const count = (totals[id] ?? 0) + 1
    if (!Number.isSafeInteger(count)) throw new Error('Invalid inventory quantity')
    totals[id] = count
  }
  if (profile.inventory?.version !== undefined && profile.inventory.version !== 1) throw new Error('Invalid inventory version')
  for (const [id, count] of Object.entries(careerItemTotals(profile))) {
    if (!isTradableCareerItem(id) || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid inventory')
    const canonical = canonicalInventoryId(id)
    const merged = (totals[canonical] ?? 0) + count
    if (!Number.isSafeInteger(merged)) throw new Error('Invalid inventory quantity')
    if (merged) totals[canonical] = merged
  }
  if (profile.selectedMountId) profile.selectedMountId = canonicalInventoryId(profile.selectedMountId) as CareerMountId
  if (legacy) {
    const inferPlayerWeapon = profile.equipment === undefined
    const equipment = { ...profile.equipment }
    for (const slot of ['melee', 'ranged', 'shield'] as const) {
      const id = equipment[slot]
      if (id && (!totals[id] || (slot === 'shield' ? !ARMORS[id] : WEAPONS[id]?.type !== slot))) delete equipment[slot]
    }
    if (equipment.ranged) equipment.shield = null
    if (inferPlayerWeapon && !equipment.melee && !equipment.ranged) {
      const fallback = [profile.starterWeaponId, ...profile.ownedWeapons].map(id => id && canonicalInventoryId(id))
        .find(id => id && totals[id] && isTradableCareerItem(id))
      if (fallback) equipment[WEAPONS[fallback].type === 'ranged' ? 'ranged' : 'melee'] = fallback
    }
    profile.equipment = equipment
    if (profile.selectedMountId && !totals[profile.selectedMountId]) delete profile.selectedMountId
  }
  for (const member of profile.personalSquad?.members ?? []) {
    const characterFaction = member.characterFaction ?? profile.faction
    if (!member.equipment) {
      if (!legacy) throw new Error('Missing member equipment')
      member.equipment = legacyPersonalEquipment(member.type, characterFaction)
      for (const id of Object.values(member.equipment)) if (id) grant(id)
    }
    if (member.type === 'ranger' && member.rangerEquipmentVersion !== 1 && member.initialEquipmentVersion !== 1) {
      // Old HR Rangers owned their mount but materialized both weapons only at runtime.
      // Grant missing default slots as real copies; preserve all legitimate saved choices.
      const equipment = { ...member.equipment }
      if (!equipment.melee) {
        equipment.melee = defaultRangerMeleeWeaponId(characterFaction)
        grant(equipment.melee)
      }
      if (!equipment.ranged && !equipment.shield) {
        equipment.ranged = T4_RANGER_BOW_RANGED_ID
        grant(equipment.ranged)
      }
      member.equipment = equipment
      // Persisted receipt also distinguishes later intentional unequips from legacy gaps.
      member.rangerEquipmentVersion = 1
    }
    if (!validPersonalEquipment(member.type, member.equipment)) throw new Error('Invalid member equipment')
  }
  profile.inventory = { version: 1, quantities: totals }
  const player = profile.equipment ?? {}
  if (player.melee && (!isTradableCareerItem(player.melee) || WEAPONS[player.melee]?.type !== 'melee')
    || player.ranged && (!isTradableCareerItem(player.ranged) || WEAPONS[player.ranged]?.type !== 'ranged')
    || player.shield && !ARMORS[player.shield] || player.ranged && player.shield) throw new Error('Invalid player equipment')
  for (const id of [...Object.values(player), profile.selectedMountId]) {
    if (id && !totals[id]) throw new Error('Unowned player equipment')
  }
  for (const member of profile.personalSquad?.members ?? []) for (const id of Object.values(member.equipment!)) {
    if (id && !totals[id]) throw new Error('Unowned member equipment')
  }
  for (const state of Object.values(profile.townEquipment ?? {})) for (const refs of Object.values(state?.actors ?? {})) for (const ref of Object.values(refs)) {
    if (ref?.source === 'inventory' && !totals[ref.itemId]) throw new Error('Unowned town equipment')
  }
  for (const id of Object.keys(totals)) if (careerItemAllocated(profile, id) > totals[id]) throw new Error('Overallocated item')
  syncCareerOwnership(profile)
}
