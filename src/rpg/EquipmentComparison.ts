import type { ArmorData } from './ArmorDatabase'
import type { WeaponData } from './WeaponDatabase'
import { weaponShieldImpact } from '../combat/ShieldImpact'

/** Player-language summaries of equipment; exact numbers are returned separately for a collapsed detail view. */
export type ComparableEquipment = WeaponData | ArmorData
export type EquipmentSlotKind = 'melee' | 'ranged' | 'shield'

export const equipmentSlotKind = (item: ComparableEquipment): EquipmentSlotKind => item.type === 'shield' ? 'shield' : item.type === 'ranged' ? 'ranged' : 'melee'

/** Short trait words shown on the main card. */
export function equipmentTraits(item: ComparableEquipment): string[] {
  if (item.type === 'shield') return item.shieldImpactMax >= 96 ? ['高防護'] : item.shieldImpactMax <= 48 ? ['防護較低'] : ['防護適中']
  const weapon = item as WeaponData
  if (weapon.type === 'ranged') {
    return [weapon.combatKind === 'javelin' ? '投擲武器' : '弓', weapon.speedOrCharge >= 1.5 ? '蓄力久、威力大' : weapon.speedOrCharge <= 1 ? '速射' : '蓄力適中']
  }
  const traits: string[] = []
  if (weapon.isLance) traits.push('長槍', '適合正面衝鋒')
  else traits.push(weapon.animationKind === 'axe' ? '斧' : weapon.animationKind === 'greatsword' ? '雙手劍' : weapon.animationKind === 'dagger' ? '短刃' : '劍')
  if ((weapon.range ?? 0) >= 3.5 && !weapon.isLance) traits.push('攻擊距離長')
  if (weapon.damageMax >= 80) traits.push('高傷害')
  return traits
}

/** Exact figures for the collapsed 詳細屬性 view. */
export function equipmentDetails(item: ComparableEquipment): string[] {
  if (item.type === 'shield') return [`衝擊耐久 ${item.shieldImpactMax}`]
  const weapon = item as WeaponData
  return weapon.type === 'ranged'
    ? [`傷害 ${weapon.damageMin}~${weapon.damageMax}`, `蓄力 ${weapon.speedOrCharge} 秒`]
    : [`傷害 ${weapon.damageMax}`, `揮速 ${weapon.speedOrCharge} 秒`, ...(weapon.range ? [`攻擊距離 ${weapon.range}`] : [])]
}

const pct = (value: number, base: number): number => base > 0 ? Math.round((value - base) / base * 100) : 0
const SIGNIFICANT = 5
const SHIELD_IMPACT_MARGIN = 2

export interface EquipmentComparison { relation: 'none' | 'same' | 'upgrade' | 'downgrade' | 'mixed'; lines: string[] }

/** Compare a candidate with what the same slot currently holds. A missing current item is not an upgrade claim. */
export function compareEquipment(candidate: ComparableEquipment, current: ComparableEquipment | null | undefined): EquipmentComparison {
  if (!current || equipmentSlotKind(candidate) !== equipmentSlotKind(current)) return { relation: 'none', lines: [] }
  if (candidate.id === current.id) return { relation: 'same', lines: ['目前裝備中'] }
  const lines: string[] = [], signs: number[] = []
  const note = (label: string, delta: number, better: 'high' | 'low' = 'high') => {
    if (Math.abs(delta) < SIGNIFICANT) return
    lines.push(`${label}${delta > 0 ? ' +' : ' '}${delta}%`)
    signs.push((delta > 0) === (better === 'high') ? 1 : -1)
  }
  if (candidate.type === 'shield' && current.type === 'shield') note('防護', pct(candidate.shieldImpactMax, current.shieldImpactMax))
  else if (candidate.type === 'ranged' && current.type === 'ranged') {
    note('傷害', pct(candidate.damageMax, current.damageMax))
    note('蓄力時間', pct(candidate.speedOrCharge, current.speedOrCharge), 'low')
  } else if (candidate.type === 'melee' && current.type === 'melee') {
    note('傷害', pct(candidate.damageMax, current.damageMax))
    note('出手時間', pct(candidate.speedOrCharge, current.speedOrCharge), 'low')
    const range = (candidate.range ?? 0) - (current.range ?? 0)
    if (range >= 0.5) { lines.push('攻擊距離較長'); signs.push(1) } else if (range <= -0.5) { lines.push('攻擊距離較短'); signs.push(-1) }
    // Effective shield-break impact comes from the combat rule itself (explicit value, axe tier, or default 1), on foot; never a percentage.
    // A lance's impact depends on being mounted, so lances are left to the disclosed note below.
    if (!candidate.isLance && !current.isLance) {
      const impact = weaponShieldImpact(candidate.id) - weaponShieldImpact(current.id)
      if (impact >= SHIELD_IMPACT_MARGIN) { lines.push('破盾衝擊較強'); signs.push(1) } else if (impact <= -SHIELD_IMPACT_MARGIN) { lines.push('破盾衝擊較弱'); signs.push(-1) }
    }
    // A lance's mounted-charge and anti-cavalry role is not in these numbers, so a lance↔non-lance swap is never called better or worse.
    if (Boolean(candidate.isLance) !== Boolean(current.isLance)) {
      lines.push(candidate.isLance ? '長槍的騎乘衝鋒特性未計入比較' : '目前長槍的騎乘衝鋒特性未計入比較')
      return { relation: 'mixed', lines }
    }
  }
  if (!lines.length) return { relation: 'same', lines: ['與目前裝備差異不大'] }
  const up = signs.includes(1), down = signs.includes(-1)
  return { relation: up && down ? 'mixed' : up ? 'upgrade' : 'downgrade', lines }
}
