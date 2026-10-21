import { ARMORS } from './ArmorDatabase'
import { WEAPONS, type WeaponTier } from './WeaponDatabase'

export type EquipmentCategory = 'melee' | 'ranged' | 'armor'
export const EQUIPMENT_CATEGORIES = [
  ['melee', '近戰 Melee'], ['ranged', '遠程 Ranged'], ['armor', '防具 Armor'],
] as const
interface EquipmentEntry { id: string; tier: WeaponTier }
export interface EquipmentSection<T> { tier: WeaponTier; items: T[] }

/** Presentation order only: sword, gladius, axe, mace, spear; bow, pilum;
 * scutum, round shield, captain shield. IDs break ties independently of labels/prices. */
function equipmentKindOrder(item: EquipmentEntry): number {
  if (ARMORS[item.id]) return item.id.startsWith('scutum_') ? 0 : item.id.startsWith('round_shield_') ? 1 : 2
  const weapon = WEAPONS[item.id]
  if (weapon.type === 'ranged') return weapon.combatKind === 'bow' ? 0 : 1
  if (weapon.combatKind === 'lance') return 4
  if (item.id === 'paladin_mace_t4') return 3
  if (weapon.animationKind === 'axe') return 2
  return item.id.startsWith('gladius_') || item.id === 'centurion_blade' ? 1 : 0
}

/** Shared by shop and Inventory; preserves caller records and never changes ownership. */
export function equipmentSections<T extends EquipmentEntry>(items: readonly T[], category: EquipmentCategory): EquipmentSection<T>[] {
  const sorted = items.filter(item => category === 'armor' ? ARMORS[item.id]?.type === 'shield'
    : WEAPONS[item.id]?.type === category)
    .sort((a, b) => a.tier - b.tier || equipmentKindOrder(a) - equipmentKindOrder(b)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const sections: EquipmentSection<T>[] = []
  for (const item of sorted) {
    let section = sections.at(-1)
    if (section?.tier !== item.tier) { section = { tier: item.tier, items: [] }; sections.push(section) }
    section.items.push(item)
  }
  return sections
}
