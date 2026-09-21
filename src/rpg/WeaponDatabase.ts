/**
 * WeaponDatabase.ts
 * Centralized definition for weapons and inventory items.
 * Tier 1 (Common/Grey), Tier 2 (Rare/Blue), Tier 3 (Epic/Gold).
 */
export type ItemType = 'melee' | 'ranged' | 'consumable'
export type WeaponAnimationKind = 'dagger' | 'sword' | 'greatsword' | 'lance' | 'bow' | 'pilum'
export type WeaponCombatKind = 'sword' | 'lance' | 'bow' | 'javelin'

export interface WeaponData {
  id: string
  name: string
  type: ItemType
  tier: 1 | 2 | 3
  combatKind: WeaponCombatKind
  damageMin: number
  damageMax: number
  // For melee: swingDuration in seconds; for bow: maxChargeTime in seconds
  speedOrCharge: number
  animationKind: WeaponAnimationKind
  // For ranged weapons: projectile speed range [speedMin, speedMax]
  arrowSpeedMin?: number
  arrowSpeedMax?: number
  // Melee specific
  range?: number
  isLance?: boolean
  description: string
}

export const WEAPONS: Record<string, WeaponData> = {
  // ── Melee Weapons (Swords) ──
  rusty_dagger: {
    id: 'rusty_dagger',
    name: '風化長劍 Weathered Sword',
    type: 'melee',
    tier: 1,
    combatKind: 'sword',
    damageMin: 12,
    damageMax: 12,
    speedOrCharge: 0.35,
    animationKind: 'sword',
    range: 1.8,
    description: '沿用制式長劍外形，以風化鐵紋區分的普通武器。',
  },
  steel_sword: {
    id: 'steel_sword',
    name: '鋼鐵長劍 Steel Sword',
    type: 'melee',
    tier: 2,
    combatKind: 'sword',
    damageMin: 25,
    damageMax: 25,
    speedOrCharge: 0.35, // Standard baseline
    animationKind: 'sword',
    range: 1.8,
    description: '標準諾德鍛造鋼鐵長劍，手感均衡。',
  },
  runic_greatsword: {
    id: 'runic_greatsword',
    name: '符文長劍 Runic Sword',
    type: 'melee',
    tier: 3,
    combatKind: 'sword',
    damageMin: 45,
    damageMax: 45,
    speedOrCharge: 0.35,
    animationKind: 'sword',
    range: 1.8,
    description: '沿用制式長劍外形，以藍金符文區分的史詩武器。',
  },

  // ── Melee Weapons (Lances / Spears) ──
  hunting_spear: {
    id: 'hunting_spear',
    name: '獵用長矛 Hunting Spear',
    type: 'melee',
    tier: 1,
    combatKind: 'lance',
    damageMin: 30,
    damageMax: 30,
    speedOrCharge: 0.42,
    animationKind: 'lance',
    range: 3.9,
    isLance: true,
    description: '輕型長木桿鋼頭長矛，擁有長攻擊距離。徒步對騎兵造成2倍傷害，高速衝刺時能造成3倍貫穿傷害。',
  },
  steel_lance: {
    id: 'steel_lance',
    name: '騎兵長槍 Steel Lance',
    type: 'melee',
    tier: 2,
    combatKind: 'lance',
    damageMin: 45,
    damageMax: 45,
    speedOrCharge: 0.42,
    animationKind: 'lance',
    range: 3.9,
    isLance: true,
    description: '專為騎兵設計的長木桿鋼頭長槍，擁有極長攻擊距離。徒步對騎兵造成2倍傷害，高速衝刺時能造成3倍貫穿傷害。',
  },
  heavy_lance: {
    id: 'heavy_lance',
    name: '重裝騎士長槍 Heavy Lance',
    type: 'melee',
    tier: 3,
    combatKind: 'lance',
    damageMin: 60,
    damageMax: 60,
    speedOrCharge: 0.42,
    animationKind: 'lance',
    range: 3.9,
    isLance: true,
    description: '重型加固騎兵長槍，擁有極長攻擊距離與強大穿透力。徒步對騎兵造成2倍傷害，高速衝刺時能造成3倍貫穿傷害。',
  },

  // ── Ranged Bows ──
  wooden_shortbow: {
    id: 'wooden_shortbow',
    name: '木製短弓 Wooden Shortbow',
    type: 'ranged',
    tier: 1,
    combatKind: 'bow',
    damageMin: 8,
    damageMax: 22,
    speedOrCharge: 0.8, // Quick charge max
    animationKind: 'bow',
    arrowSpeedMin: 12,
    arrowSpeedMax: 45,
    description: '獵人使用的簡易木弓，拉弓快但傷害較低。',
  },
  recurve_longbow: {
    id: 'recurve_longbow',
    name: '反曲長弓 Recurve Longbow',
    type: 'ranged',
    tier: 2,
    combatKind: 'bow',
    damageMin: 15,
    damageMax: 42,
    speedOrCharge: 1.2, // Standard baseline
    animationKind: 'bow',
    arrowSpeedMin: 18,
    arrowSpeedMax: 55,
    description: '精心複合打造的反曲長弓，貫穿力適中。',
  },
  elven_runebow: {
    id: 'elven_runebow',
    name: '符文精靈弓 Elven Runebow',
    type: 'ranged',
    tier: 3,
    combatKind: 'bow',
    damageMin: 28,
    damageMax: 75,
    speedOrCharge: 1.8, // Long charge for massive damage
    animationKind: 'bow',
    arrowSpeedMin: 25,
    arrowSpeedMax: 65,
    description: '精靈工匠打造的符文弓，箭矢射速極快且帶有強大打擊力。',
  },

  // ── Roman Enemy Melee (Gladius) ──
  gladius_rusty: {
    id: 'gladius_rusty',
    name: '破舊短劍 Gladius Rusty',
    type: 'melee',
    tier: 1,
    combatKind: 'sword',
    damageMin: 12,
    damageMax: 12,
    speedOrCharge: 0.35,
    animationKind: 'sword',
    range: 1.8,
    description: '沿用制式短劍外形，以風化鐵紋區分的普通武器。',
  },
  gladius_standard: {
    id: 'gladius_standard',
    name: '標準短劍 Gladius Standard',
    type: 'melee',
    tier: 2,
    combatKind: 'sword',
    damageMin: 25,
    damageMax: 25,
    speedOrCharge: 0.35,
    animationKind: 'sword',
    range: 1.8,
    description: '制式羅馬軍團短劍，標準傷害。',
  },
  centurion_blade: {
    id: 'centurion_blade',
    name: '精鋼百夫長劍 Centurion Blade',
    type: 'melee',
    tier: 3,
    combatKind: 'sword',
    damageMin: 45,
    damageMax: 45,
    speedOrCharge: 0.35,
    animationKind: 'sword',
    range: 1.8,
    description: '沿用制式短劍外形，以金色百夫長紋區分的史詩武器。',
  },

  // ── Roman Ranged (Pilum / Javelin) ──
  pilum_basic: {
    id: 'pilum_basic',
    name: '簡易標槍 Pilum Basic',
    type: 'ranged',
    tier: 1,
    combatKind: 'javelin',
    damageMin: 8,
    damageMax: 22,
    speedOrCharge: 0.8,
    animationKind: 'pilum',
    arrowSpeedMin: 12,
    arrowSpeedMax: 18,
    description: '木製簡易標槍。',
  },
  pilum_standard: {
    id: 'pilum_standard',
    name: '標準標槍 Pilum Standard',
    type: 'ranged',
    tier: 2,
    combatKind: 'javelin',
    damageMin: 15,
    damageMax: 42,
    speedOrCharge: 1.2,
    animationKind: 'pilum',
    arrowSpeedMin: 14,
    arrowSpeedMax: 24,
    description: '軍團制式重標槍。',
  },
  legionary_pilum: {
    id: 'legionary_pilum',
    name: '強化軍團標槍 Legionary Pilum',
    type: 'ranged',
    tier: 3,
    combatKind: 'javelin',
    damageMin: 28,
    damageMax: 75,
    speedOrCharge: 1.8,
    animationKind: 'pilum',
    arrowSpeedMin: 16,
    arrowSpeedMax: 30,
    description: '帶有發光效果的精銳軍團標槍。',
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
