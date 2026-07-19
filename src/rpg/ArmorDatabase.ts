/**
 * ArmorDatabase.ts
 * Centralized definition for shields and armors.
 * Tier 1 (Common/Grey), Tier 2 (Rare/Blue), Tier 3 (Epic/Gold).
 */

export type ArmorType = 'shield'

export interface ArmorData {
  id: string
  name: string
  type: ArmorType
  tier: 1 | 2 | 3
  damageReduction: number // 0.05 = 5% reduction
  description: string
}

export const ARMORS: Record<string, ArmorData> = {
  // ── Roman Scutums ──
  scutum_t1: {
    id: 'scutum_t1',
    name: '簡陋方盾 Basic Scutum',
    type: 'shield',
    tier: 1,
    damageReduction: 0.05,
    description: '木製的簡陋方形盾牌，勉強能抵擋一些輕微攻擊。減傷 5%。',
  },
  scutum_t2: {
    id: 'scutum_t2',
    name: '軍團方盾 Legion Scutum',
    type: 'shield',
    tier: 2,
    damageReduction: 0.10,
    description: '標準配發的羅馬軍團長方盾，包覆蒙皮並加固邊緣。減傷 10%。',
  },
  scutum_t3: {
    id: 'scutum_t3',
    name: '百夫長方盾 Centurion Scutum',
    type: 'shield',
    tier: 3,
    damageReduction: 0.15,
    description: '精銳百夫長配發的重型鋼鐵方盾，帶有閃耀的金色紋飾。減傷 15%。',
  },

  // ── Viking Round Shields ──
  round_shield_t1: {
    id: 'round_shield_t1',
    name: '簡陋圓盾 Basic Round Shield',
    type: 'shield',
    tier: 1,
    damageReduction: 0.05,
    description: '粗糙木板拼接成的圓盾，防禦力有限。減傷 5%。',
  },
  round_shield_t2: {
    id: 'round_shield_t2',
    name: '鐵環圓盾 Iron-Rimmed Shield',
    type: 'shield',
    tier: 2,
    damageReduction: 0.10,
    description: '外圍包覆鐵環加固的維京圓盾，中央有鐵製盾凸。減傷 10%。',
  },
  round_shield_t3: {
    id: 'round_shield_t3',
    name: '狂戰士圓盾 Berserker Shield',
    type: 'shield',
    tier: 3,
    damageReduction: 0.15,
    description: '繪有猛獸圖騰的精鋼圓盾，極致的防禦工藝。減傷 15%。',
  },
}

export function getArmorTierColor(tier: 1 | 2 | 3): string {
  switch (tier) {
    case 3: return '#ffaa00'
    case 2: return '#00aaff'
    case 1: default: return '#cccccc'
  }
}
