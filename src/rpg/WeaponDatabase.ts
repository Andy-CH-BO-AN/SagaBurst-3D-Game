/**
 * WeaponDatabase.ts
 * Centralized definition for weapons and inventory items.
 * Tier 1 (Common/Grey), Tier 2 (Rare/Blue), Tier 3 (Epic/Gold).
 */

export type ItemType = 'melee' | 'ranged' | 'consumable'

export interface WeaponData {
  id: string
  name: string
  type: ItemType
  tier: 1 | 2 | 3
  damageMin: number
  damageMax: number
  // For melee: swingDuration in seconds; for bow: maxChargeTime in seconds
  speedOrCharge: number
  // For bow: projectile speed range [speedMin, speedMax]
  arrowSpeedMin?: number
  arrowSpeedMax?: number
  description: string
}

export const WEAPONS: Record<string, WeaponData> = {
  // ── Melee Weapons ──
  rusty_dagger: {
    id: 'rusty_dagger',
    name: '生鏽小刀 Rusty Dagger',
    type: 'melee',
    tier: 1,
    damageMin: 12,
    damageMax: 12,
    speedOrCharge: 0.24, // Fast swing
    description: '生鏽短小的舊小刀，攻擊範圍短但揮速極快。',
  },
  steel_sword: {
    id: 'steel_sword',
    name: '鋼鐵長劍 Steel Sword',
    type: 'melee',
    tier: 2,
    damageMin: 25,
    damageMax: 25,
    speedOrCharge: 0.35, // Standard baseline
    description: '標準諾德鍛造鋼鐵長劍，手感均衡。',
  },
  runic_greatsword: {
    id: 'runic_greatsword',
    name: '精鋼戰刃 Runic Greatsword',
    type: 'melee',
    tier: 3,
    damageMin: 45,
    damageMax: 45,
    speedOrCharge: 0.45, // Slow heavy swing
    description: '附魔藍金紋路的重型精鋼戰刃，具備破甲高傷害。',
  },

  // ── Ranged Bows ──
  wooden_shortbow: {
    id: 'wooden_shortbow',
    name: '木製短弓 Wooden Shortbow',
    type: 'ranged',
    tier: 1,
    damageMin: 8,
    damageMax: 22,
    speedOrCharge: 0.8, // Quick charge max
    arrowSpeedMin: 12,
    arrowSpeedMax: 32,
    description: '獵人使用的簡易木弓，拉弓快但傷害較低。',
  },
  recurve_longbow: {
    id: 'recurve_longbow',
    name: '反曲長弓 Recurve Longbow',
    type: 'ranged',
    tier: 2,
    damageMin: 15,
    damageMax: 42,
    speedOrCharge: 1.2, // Standard baseline
    arrowSpeedMin: 18,
    arrowSpeedMax: 48,
    description: '精心複合打造的反曲長弓，貫穿力適中。',
  },
  elven_runebow: {
    id: 'elven_runebow',
    name: '符文精靈弓 Elven Runebow',
    type: 'ranged',
    tier: 3,
    damageMin: 28,
    damageMax: 75,
    speedOrCharge: 1.8, // Long charge for massive damage
    arrowSpeedMin: 25,
    arrowSpeedMax: 65,
    description: '精靈工匠打造的符文弓，箭矢射速極快且帶有強大打擊力。',
  },
}

export function getTierColor(tier: 1 | 2 | 3): string {
  switch (tier) {
    case 1: return '#a0a0a0' // Grey
    case 2: return '#3498db' // Blue
    case 3: return '#f1c40f' // Gold
  }
}

export function getTierBadge(tier: 1 | 2 | 3): string {
  switch (tier) {
    case 1: return '★ Tier 1 (普通)'
    case 2: return '★★ Tier 2 (稀有)'
    case 3: return '★★★ Tier 3 (史詩)'
  }
}
