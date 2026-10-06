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
  shieldImpactMax: number
  description: string
}

export const ARMORS: Record<string, ArmorData> = {
  // ── Roman Scutums ──
  scutum_t1: {
    id: 'scutum_t1',
    name: '簡陋方盾 Basic Scutum',
    type: 'shield',
    tier: 1,
    shieldImpactMax: 7.5,
    description: '木製方盾。7.5 衝擊；僅實際命中盾面才格擋。',
  },
  scutum_t2: {
    id: 'scutum_t2',
    name: '軍團方盾 Legion Scutum',
    type: 'shield',
    tier: 2,
    shieldImpactMax: 15,
    description: '軍團方盾。15 衝擊；僅實際命中盾面才格擋。',
  },
  scutum_t3: {
    id: 'scutum_t3',
    name: '百夫長方盾 Centurion Scutum',
    type: 'shield',
    tier: 3,
    shieldImpactMax: 30,
    description: '百夫長方盾。30 衝擊；僅實際命中盾面才格擋。',
  },

  // ── Viking Round Shields ──
  round_shield_t1: {
    id: 'round_shield_t1',
    name: '簡陋圓盾 Basic Round Shield',
    type: 'shield',
    tier: 1,
    shieldImpactMax: 5,
    description: '木板圓盾。5 衝擊；僅實際命中盾面才格擋。',
  },
  round_shield_t2: {
    id: 'round_shield_t2',
    name: '鐵環圓盾 Iron-Rimmed Shield',
    type: 'shield',
    tier: 2,
    shieldImpactMax: 10,
    description: '鐵環圓盾。10 衝擊；僅實際命中盾面才格擋。',
  },
  round_shield_t3: {
    id: 'round_shield_t3',
    name: '狂戰士圓盾 Berserker Shield',
    type: 'shield',
    tier: 3,
    shieldImpactMax: 20,
    description: '精製圓盾。20 衝擊；僅實際命中盾面才格擋。',
  },
}

export function getArmorTierColor(tier: 1 | 2 | 3): string {
  switch (tier) {
    case 3: return '#ffaa00'
    case 2: return '#00aaff'
    case 1: default: return '#cccccc'
  }
}
