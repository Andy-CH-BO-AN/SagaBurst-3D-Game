/**
 * WeaponDatabase.ts
 * Centralized definition for weapons and inventory items.
 * Equipment tiers 1–5 are independent of ordinary NPC tiers.
 */
export type ItemType = 'melee' | 'ranged' | 'consumable'
export type WeaponAnimationKind = 'dagger' | 'sword' | 'axe' | 'greatsword' | 'lance' | 'bow' | 'pilum'
export type WeaponCombatKind = 'sword' | 'lance' | 'bow' | 'javelin'
export type WeaponTier = 1 | 2 | 3 | 4 | 5

export interface WeaponData {
  id: string
  name: string
  type: ItemType
  tier: WeaponTier
  combatKind: WeaponCombatKind
  damageMin: number
  damageMax: number
  // For melee: swingDuration in seconds; for bow: maxChargeTime in seconds
  speedOrCharge: number
  animationKind: WeaponAnimationKind
  /** Opt-in action duration; legacy melee keeps its existing animation cadence. */
  meleeCycleSeconds?: number
  /** Fixed physical shield impact, independent of hero/body damage multipliers. */
  shieldImpact?: number
  // For ranged weapons: projectile speed range [speedMin, speedMax]
  arrowSpeedMin?: number
  arrowSpeedMax?: number
  // Melee specific
  range?: number
  isLance?: boolean
  description: string
}

export const T4_RANGER_BOW_RANGED_ID = 'maki-ranger-bow-ranged' as const

/** Faction starter melee used by Rangers with ordinary humanoid attacks. */
export function defaultRangerMeleeWeaponId(faction: 'viking' | 'roman'): string {
  return faction === 'roman' ? 'centurion_blade' : 'viking_axe_t3'
}

const T4_POLEARM: Omit<WeaponData, 'id' | 'name'> = {
  type: 'melee', tier: 4, combatKind: 'lance', animationKind: 'lance',
  damageMin: 75, damageMax: 75, speedOrCharge: .42, meleeCycleSeconds: .42,
  range: 3.9, isLance: true,
  description: '徒步反騎兵傷害 ×2，高速騎乘衝鋒 ×3；騎乘命中盾面造成 60 點衝擊。',
}

export const WEAPONS: Record<string, WeaponData> = {
  sword_t5: {
    id: 'sword_t5', name: "指揮官長劍 Commander's Longsword", type: 'melee', tier: 5,
    combatKind: 'sword', animationKind: 'sword', damageMin: 80, damageMax: 80,
    speedOrCharge: .48, meleeCycleSeconds: .48, shieldImpact: 1, range: 1.8,
    description: '指揮官長劍；命中盾面造成 1 點固定衝擊。',
  },
  axe_t5: {
    id: 'axe_t5', name: "指揮官雙刃戰斧 Commander's Double-Bitted Axe", type: 'melee', tier: 5,
    combatKind: 'sword', animationKind: 'axe', damageMin: 80, damageMax: 80,
    speedOrCharge: .54, meleeCycleSeconds: .54, shieldImpact: 15, range: 1.8,
    description: '指揮官雙刃戰斧；命中盾面造成 15 點固定衝擊，無護甲穿透。',
  },
  spear_t5: {
    id: 'spear_t5', name: "指揮官戰矛 Commander's War Spear", type: 'melee', tier: 5,
    combatKind: 'lance', animationKind: 'lance', damageMin: 95, damageMax: 95,
    speedOrCharge: .42, meleeCycleSeconds: .42, range: 3.9, isLance: true,
    description: '徒步反騎兵傷害 ×2，高速騎乘衝鋒 ×3；騎乘命中盾面造成 80 點衝擊。',
  },
  spear_t4: { ...T4_POLEARM, id: 'spear_t4', name: "隊長戰矛 Captain's War Spear" },
  bow_t5: {
    id: 'bow_t5', name: "指揮官戰弓 Commander's War Bow", type: 'ranged', tier: 5,
    combatKind: 'bow', animationKind: 'bow', damageMin: 50, damageMax: 120,
    speedOrCharge: 1.8, arrowSpeedMin: 45, arrowSpeedMax: 120,
    description: '指揮官長弓；1.8 秒滿蓄力，沿用既有箭矢與騎射。',
  },
  paladin_sword_t4: {
    id: 'paladin_sword_t4', name: "隊長長劍 Captain's Longsword", type: 'melee', tier: 4,
    combatKind: 'sword', animationKind: 'sword', damageMin: 60, damageMax: 60,
    speedOrCharge: .48, meleeCycleSeconds: .48, shieldImpact: 1, range: 1.8,
    description: '羅馬與維京 T4 共用長劍；命中盾面造成 1 點固定衝擊。',
  },
  paladin_mace_t4: {
    id: 'paladin_mace_t4', name: "隊長雙刃戰斧 Captain's Double-Bitted Axe", type: 'melee', tier: 4,
    combatKind: 'sword', animationKind: 'axe', damageMin: 55, damageMax: 55,
    speedOrCharge: .54, meleeCycleSeconds: .54, shieldImpact: 12, range: 1.8,
    description: '羅馬與維京 T4 共用雙刃戰斧；可單手或雙手揮砍，命中盾面造成 12 點固定衝擊，無護甲穿透。',
  },
  // ── Melee Weapons (Swords) ──
  rusty_dagger: {
    id: 'rusty_dagger',
    name: '鏽蝕長劍 Rusted Longsword',
    type: 'melee',
    tier: 1,
    combatKind: 'sword',
    damageMin: 12,
    damageMax: 12,
    speedOrCharge: 0.35,
    animationKind: 'sword',
    range: 1.8,
    description: '窄刃、短護手與粗糙鏽鐵的風化長劍。',
  },
  steel_sword: {
    id: 'steel_sword',
    name: '精鋼長劍 Steel Longsword',
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
    name: '符文長劍 Runic Longsword',
    type: 'melee',
    tier: 3,
    combatKind: 'sword',
    damageMin: 45,
    damageMax: 45,
    speedOrCharge: 0.35,
    animationKind: 'sword',
    range: 1.8,
    description: '寬刃長劍搭配延展護手、藍色劍槽與雙面金色鑲紋。',
  },

  // Phase 1 axes retain the corresponding sword's combat values and animation.
  viking_axe_t1: {
    id: 'viking_axe_t1', name: '舊式丹麥長斧 Worn Dane Axe', type: 'melee', tier: 1,
    combatKind: 'sword', damageMin: 12, damageMax: 12, speedOrCharge: 0.35,
    animationKind: 'axe', range: 1.8,
    description: '長柄單刃丹麥斧，沿用同階長劍的近戰性能。',
  },
  viking_axe_t2: {
    id: 'viking_axe_t2', name: '精鋼丹麥長斧 Steel Dane Axe', type: 'melee', tier: 2,
    combatKind: 'sword', damageMin: 25, damageMax: 25, speedOrCharge: 0.35,
    animationKind: 'axe', range: 1.8,
    description: '精鋼長柄單刃丹麥斧，沿用同階長劍的近戰性能。',
  },
  viking_axe_t3: {
    id: 'viking_axe_t3', name: '符文丹麥長斧 Runic Dane Axe', type: 'melee', tier: 3,
    combatKind: 'sword', damageMin: 45, damageMax: 45, speedOrCharge: 0.35,
    animationKind: 'axe', range: 1.8,
    description: '符文長柄單刃丹麥斧，沿用同階長劍的近戰性能。',
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
    description: '輕型長木桿鋼頭長矛，擁有長攻擊距離。徒步對騎兵造成2倍傷害，高速衝刺時能造成3倍貫穿傷害。騎乘命中盾面扣 10 衝擊耐久；耐久不足時按比例穿透。',
  },
  steel_lance: {
    id: 'steel_lance',
    name: '精鋼戰矛 Steel-Tipped Spear',
    type: 'melee',
    tier: 2,
    combatKind: 'lance',
    damageMin: 45,
    damageMax: 45,
    speedOrCharge: 0.42,
    animationKind: 'lance',
    range: 3.9,
    isLance: true,
    description: '專為騎兵設計的長木桿鋼頭長槍，擁有極長攻擊距離。徒步對騎兵造成2倍傷害，高速衝刺時能造成3倍貫穿傷害。騎乘命中盾面扣 20 衝擊耐久；耐久不足時按比例穿透。',
  },
  heavy_lance: {
    id: 'heavy_lance',
    name: '重型戰矛 Heavy War Spear',
    type: 'melee',
    tier: 3,
    combatKind: 'lance',
    damageMin: 60,
    damageMax: 60,
    speedOrCharge: 0.42,
    animationKind: 'lance',
    range: 3.9,
    isLance: true,
    description: '重型加固騎兵長槍，擁有極長攻擊距離與強大穿透力。徒步對騎兵造成2倍傷害，高速衝刺時能造成3倍貫穿傷害。騎乘命中盾面扣 40 衝擊耐久；耐久不足時按比例穿透。',
  },

  // ── Ranged Bows ──
  wooden_shortbow: {
    id: 'wooden_shortbow',
    name: '獵用短弓 Hunting Shortbow',
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
    name: '符文戰弓 Runic War Bow',
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
  [T4_RANGER_BOW_RANGED_ID]: {
    id: T4_RANGER_BOW_RANGED_ID,
    name: '遊俠戰弓 Ranger War Bow',
    type: 'ranged',
    tier: 4,
    combatKind: 'bow',
    damageMin: 40,
    damageMax: 100,
    speedOrCharge: 1.8,
    animationKind: 'bow',
    arrowSpeedMin: 40,
    arrowSpeedMax: 110,
    description: '遊俠使用的長弓，可作為遠程武器裝備。',
  },

  // ── Roman Enemy Melee (Gladius) ──
  gladius_rusty: {
    id: 'gladius_rusty',
    name: '破舊羅馬短劍 Worn Gladius',
    type: 'melee',
    tier: 1,
    combatKind: 'sword',
    damageMin: 12,
    damageMax: 12,
    speedOrCharge: 0.35,
    animationKind: 'sword',
    range: 1.8,
    description: '窄刃與簡陋護手的風化羅馬短劍。',
  },
  gladius_standard: {
    id: 'gladius_standard',
    name: '軍團短劍 Legionary Gladius',
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
    name: "百夫長短劍 Centurion's Gladius",
    type: 'melee',
    tier: 3,
    combatKind: 'sword',
    damageMin: 45,
    damageMax: 45,
    speedOrCharge: 0.35,
    animationKind: 'sword',
    range: 1.8,
    description: '加寬葉形劍刃，搭配金色護手與雙面百夫長鑲紋。',
  },

  // ── Roman Ranged (Pilum / Javelin) ──
  pilum_basic: {
    id: 'pilum_basic',
    name: '輕型標槍 Light Pilum',
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
    name: '軍團標槍 Legionary Pilum',
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
    name: "精銳軍團標槍 Veteran's Pilum",
    type: 'ranged',
    tier: 3,
    combatKind: 'javelin',
    damageMin: 28,
    damageMax: 75,
    speedOrCharge: 1.8,
    animationKind: 'pilum',
    arrowSpeedMin: 16,
    arrowSpeedMax: 30,
    description: '深色木桿、拋光長鐵頸與金色箍環的精銳軍團標槍。',
  },
}

export function getTierColor(tier: WeaponTier): string {
  switch (tier) {
    case 1: return '#a0a0a0' // Grey
    case 2: return '#3498db' // Blue
    case 3: return '#f1c40f' // Gold
    case 4: return '#b27aff' // Purple
    case 5: return '#ff823d'
  }
}

export function getTierBadge(tier: WeaponTier): string {
  switch (tier) {
    case 1: return '★ Tier 1 (普通)'
    case 2: return '★★ Tier 2 (稀有)'
    case 3: return '★★★ Tier 3 (史詩)'
    case 4: return '★★★★ Tier 4 (英雄)'
    case 5: return '★★★★★ Tier 5 (傳奇)'
  }
}
