/**
 * ArmorDatabase.ts
 * Centralized definition for shields and armors.
 * Shield quality tiers 1–5; legendary shields share the T5 weapon color.
 */

export type ArmorType = 'shield'

export interface ArmorData {
  id: string
  name: string
  type: ArmorType
  tier: 1 | 2 | 3 | 4 | 5
  shieldImpactMax: number
  description: string
}

export const ARMORS: Record<string, ArmorData> = {
  commander_shield_t5: {
    id: 'commander_shield_t5', name: "指揮官戰盾 Commander's War Shield", type: 'shield', tier: 5,
    shieldImpactMax: 96,
    description: '羅馬與維京 T5 共用實體盾牌。96 衝擊耐久；僅實際命中盾面才格擋。',
  },
  paladin_shield_t4: {
    id: 'paladin_shield_t4', name: "隊長戰盾 Captain's War Shield", type: 'shield', tier: 4,
    shieldImpactMax: 48,
    description: '羅馬與維京 T4 共用實體盾牌。48 衝擊耐久；僅實際命中盾面才格擋。',
  },
  // ── Roman Scutums ──
  scutum_t1: {
    id: 'scutum_t1',
    name: '木製方盾 Wooden Scutum',
    type: 'shield',
    tier: 1,
    shieldImpactMax: 7.5,
    description: '木製方盾。7.5 衝擊；僅實際命中盾面才格擋。',
  },
  scutum_t2: {
    id: 'scutum_t2',
    name: '軍團方盾 Legionary Scutum',
    type: 'shield',
    tier: 2,
    shieldImpactMax: 15,
    description: '軍團方盾。15 衝擊；僅實際命中盾面才格擋。',
  },
  scutum_t3: {
    id: 'scutum_t3',
    name: "百夫長方盾 Centurion's Scutum",
    type: 'shield',
    tier: 3,
    shieldImpactMax: 30,
    description: '百夫長方盾。30 衝擊；僅實際命中盾面才格擋。',
  },

  // ── Viking Round Shields ──
  round_shield_t1: {
    id: 'round_shield_t1',
    name: '木製圓盾 Wooden Round Shield',
    type: 'shield',
    tier: 1,
    shieldImpactMax: 5,
    description: '木板圓盾。5 衝擊；僅實際命中盾面才格擋。',
  },
  round_shield_t2: {
    id: 'round_shield_t2',
    name: '鐵邊圓盾 Iron-Rimmed Round Shield',
    type: 'shield',
    tier: 2,
    shieldImpactMax: 10,
    description: '鐵環圓盾。10 衝擊；僅實際命中盾面才格擋。',
  },
  round_shield_t3: {
    id: 'round_shield_t3',
    name: '近衛圓盾 Huscarl Round Shield',
    type: 'shield',
    tier: 3,
    shieldImpactMax: 20,
    description: '精製圓盾。20 衝擊；僅實際命中盾面才格擋。',
  },
}

export function getArmorTierColor(tier: 1 | 2 | 3 | 4): string {
  switch (tier) {
    case 4: return '#b27aff'
    case 3: return '#ffaa00'
    case 2: return '#00aaff'
    case 1: default: return '#cccccc'
  }
}
