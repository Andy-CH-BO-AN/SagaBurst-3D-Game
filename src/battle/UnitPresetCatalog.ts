/**
 * UnitPresetCatalog.ts
 * Authoritative Catalog of Unit Presets (Archetypes) for Custom Battle.
 * Presets determine starting loadouts (melee weapon, ranged weapon, shield, mount).
 * Live combat behavior is determined strictly at runtime by current equipment, mount state, and CombatBalance.
 */
import type { CharacterFaction } from '../world/CharacterVisuals'
import { COMBAT_BALANCE } from '../combat/CombatBalance'

export type UnitTier = 1 | 2 | 3

export type VikingPresetId =
  | 'viking_berserker'
  | 'viking_spearman'
  | 'viking_archer'
  | 'viking_sword_cavalry'
  | 'viking_lancer'
  | 'viking_horse_archer'

export type RomanPresetId =
  | 'roman_heavy_infantry'
  | 'roman_spearman'
  | 'roman_archer'
  | 'roman_javelin_infantry'
  | 'roman_sword_cavalry'
  | 'roman_lancer'
  | 'roman_horse_archer'

export type UnitPresetId = VikingPresetId | RomanPresetId

export const VIKING_PRESET_IDS: readonly VikingPresetId[] = [
  'viking_berserker',
  'viking_spearman',
  'viking_archer',
  'viking_sword_cavalry',
  'viking_lancer',
  'viking_horse_archer',
]

export const ROMAN_PRESET_IDS: readonly RomanPresetId[] = [
  'roman_heavy_infantry',
  'roman_spearman',
  'roman_archer',
  'roman_javelin_infantry',
  'roman_sword_cavalry',
  'roman_lancer',
  'roman_horse_archer',
]

export type UnitPresetTrait =
  | 'berserker'
  | 'lance_anti_cavalry'
  | 'lance_charge'
  | 'shield_defense'
  | 'bow_fire'
  | 'javelin_throw'

export interface UnitLoadout {
  meleeWeaponId?: string | null
  rangedWeaponId?: string | null
  shieldId?: string | null
  mountId?: string | null
}

export interface UnitPreset {
  id: UnitPresetId
  faction: CharacterFaction
  nameZh: string
  nameEn: string
  description: string
  traits: readonly UnitPresetTrait[]
  tierLoadouts: Record<UnitTier, UnitLoadout>
}

export const UNIT_PRESETS: Record<UnitPresetId, UnitPreset> = {
  // ── Viking Presets ──
  viking_berserker: {
    id: 'viking_berserker',
    faction: 'viking',
    nameZh: '狂戰士',
    nameEn: 'Berserker',
    description: '諾德狂戰士，捨棄盾牌專注極致攻速與破壞力。',
    traits: ['berserker'],
    tierLoadouts: {
      1: { meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null, mountId: null },
      2: { meleeWeaponId: 'steel_sword', rangedWeaponId: null, shieldId: null, mountId: null },
      3: { meleeWeaponId: 'runic_greatsword', rangedWeaponId: null, shieldId: null, mountId: null },
    },
  },
  viking_spearman: {
    id: 'viking_spearman',
    faction: 'viking',
    nameZh: '槍兵',
    nameEn: 'Spearman',
    description: '徒步長槍兵，專精剋制騎兵。落馬騎兵亦能發揮反騎效果。',
    traits: ['lance_anti_cavalry'],
    tierLoadouts: {
      1: { meleeWeaponId: 'hunting_spear', rangedWeaponId: null, shieldId: null, mountId: null },
      2: { meleeWeaponId: 'steel_lance', rangedWeaponId: null, shieldId: null, mountId: null },
      3: { meleeWeaponId: 'heavy_lance', rangedWeaponId: null, shieldId: null, mountId: null },
    },
  },
  viking_archer: {
    id: 'viking_archer',
    faction: 'viking',
    nameZh: '弓兵',
    nameEn: 'Archer',
    description: '諾德長弓手，擅長長距離射擊，近身切換長劍。',
    traits: ['bow_fire'],
    tierLoadouts: {
      1: { meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'wooden_shortbow', shieldId: null, mountId: null },
      2: { meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null },
      3: { meleeWeaponId: 'runic_greatsword', rangedWeaponId: 'elven_runebow', shieldId: null, mountId: null },
    },
  },
  viking_sword_cavalry: {
    id: 'viking_sword_cavalry',
    faction: 'viking',
    nameZh: '刀騎兵',
    nameEn: 'Sword Cavalry',
    description: '持劍持盾的突擊輕騎兵，攻守均衡。',
    traits: ['shield_defense'],
    tierLoadouts: {
      1: { meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: 'round_shield_t1', mountId: 'horse' },
      2: { meleeWeaponId: 'steel_sword', rangedWeaponId: null, shieldId: 'round_shield_t2', mountId: 'horse' },
      3: { meleeWeaponId: 'runic_greatsword', rangedWeaponId: null, shieldId: 'round_shield_t3', mountId: 'horse' },
    },
  },
  viking_lancer: {
    id: 'viking_lancer',
    faction: 'viking',
    nameZh: '槍騎兵',
    nameEn: 'Lancer',
    description: '衝鋒長槍騎兵，高速時具強大貫穿力。',
    traits: ['lance_charge', 'lance_anti_cavalry'],
    tierLoadouts: {
      1: { meleeWeaponId: 'hunting_spear', rangedWeaponId: null, shieldId: null, mountId: 'horse' },
      2: { meleeWeaponId: 'steel_lance', rangedWeaponId: null, shieldId: null, mountId: 'horse' },
      3: { meleeWeaponId: 'heavy_lance', rangedWeaponId: null, shieldId: null, mountId: 'horse' },
    },
  },
  viking_horse_archer: {
    id: 'viking_horse_archer',
    faction: 'viking',
    nameZh: '弓騎兵',
    nameEn: 'Mounted Archer',
    description: '騎乘弓箭手，兼具高機動性與射擊能力。',
    traits: ['bow_fire'],
    tierLoadouts: {
      1: { meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'wooden_shortbow', shieldId: null, mountId: 'horse' },
      2: { meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: 'horse' },
      3: { meleeWeaponId: 'runic_greatsword', rangedWeaponId: 'elven_runebow', shieldId: null, mountId: 'horse' },
    },
  },

  // ── Roman Presets ──
  roman_heavy_infantry: {
    id: 'roman_heavy_infantry',
    faction: 'roman',
    nameZh: '重裝步兵',
    nameEn: 'Heavy Infantry',
    description: '羅馬軍團重裝步兵，持方盾與短劍，防禦力堅實。',
    traits: ['shield_defense'],
    tierLoadouts: {
      1: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: null, shieldId: 'scutum_t1', mountId: null },
      2: { meleeWeaponId: 'gladius_standard', rangedWeaponId: null, shieldId: 'scutum_t2', mountId: null },
      3: { meleeWeaponId: 'centurion_blade', rangedWeaponId: null, shieldId: 'scutum_t3', mountId: null },
    },
  },
  roman_spearman: {
    id: 'roman_spearman',
    faction: 'roman',
    nameZh: '槍兵',
    nameEn: 'Spearman',
    description: '羅馬長槍兵，專職陣線反騎與刺擊防守。',
    traits: ['lance_anti_cavalry'],
    tierLoadouts: {
      1: { meleeWeaponId: 'hunting_spear', rangedWeaponId: null, shieldId: null, mountId: null },
      2: { meleeWeaponId: 'steel_lance', rangedWeaponId: null, shieldId: null, mountId: null },
      3: { meleeWeaponId: 'heavy_lance', rangedWeaponId: null, shieldId: null, mountId: null },
    },
  },
  roman_archer: {
    id: 'roman_archer',
    faction: 'roman',
    nameZh: '弓兵',
    nameEn: 'Archer',
    description: '羅馬軍團弓箭手，提供長程遠程壓制火力。',
    traits: ['bow_fire'],
    tierLoadouts: {
      1: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'wooden_shortbow', shieldId: null, mountId: null },
      2: { meleeWeaponId: 'gladius_standard', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null },
      3: { meleeWeaponId: 'centurion_blade', rangedWeaponId: 'elven_runebow', shieldId: null, mountId: null },
    },
  },
  roman_javelin_infantry: {
    id: 'roman_javelin_infantry',
    faction: 'roman',
    nameZh: '標槍兵',
    nameEn: 'Javelin Infantry',
    description: '羅馬軍團標槍步兵，投擲重標槍破壞敵陣。',
    traits: ['javelin_throw'],
    tierLoadouts: {
      1: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'pilum_basic', shieldId: null, mountId: null },
      2: { meleeWeaponId: 'gladius_standard', rangedWeaponId: 'pilum_standard', shieldId: null, mountId: null },
      3: { meleeWeaponId: 'centurion_blade', rangedWeaponId: 'legionary_pilum', shieldId: null, mountId: null },
    },
  },
  roman_sword_cavalry: {
    id: 'roman_sword_cavalry',
    faction: 'roman',
    nameZh: '刀騎兵',
    nameEn: 'Sword Cavalry',
    description: '羅馬輔助劍騎兵，配備方盾與短劍。',
    traits: ['shield_defense'],
    tierLoadouts: {
      1: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: null, shieldId: 'scutum_t1', mountId: 'horse' },
      2: { meleeWeaponId: 'gladius_standard', rangedWeaponId: null, shieldId: 'scutum_t2', mountId: 'horse' },
      3: { meleeWeaponId: 'centurion_blade', rangedWeaponId: null, shieldId: 'scutum_t3', mountId: 'horse' },
    },
  },
  roman_lancer: {
    id: 'roman_lancer',
    faction: 'roman',
    nameZh: '槍騎兵',
    nameEn: 'Lancer',
    description: '羅馬重裝長槍騎兵，衝鋒威力驚人。',
    traits: ['lance_charge', 'lance_anti_cavalry'],
    tierLoadouts: {
      1: { meleeWeaponId: 'hunting_spear', rangedWeaponId: null, shieldId: null, mountId: 'horse' },
      2: { meleeWeaponId: 'steel_lance', rangedWeaponId: null, shieldId: null, mountId: 'horse' },
      3: { meleeWeaponId: 'heavy_lance', rangedWeaponId: null, shieldId: null, mountId: 'horse' },
    },
  },
  roman_horse_archer: {
    id: 'roman_horse_archer',
    faction: 'roman',
    nameZh: '弓騎兵',
    nameEn: 'Mounted Archer',
    description: '羅馬軍團騎射手，以弓箭進行游擊。',
    traits: ['bow_fire'],
    tierLoadouts: {
      1: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'wooden_shortbow', shieldId: null, mountId: 'horse' },
      2: { meleeWeaponId: 'gladius_standard', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: 'horse' },
      3: { meleeWeaponId: 'centurion_blade', rangedWeaponId: 'elven_runebow', shieldId: null, mountId: 'horse' },
    },
  },
}

export function getUnitPreset(id: UnitPresetId): UnitPreset {
  const preset = UNIT_PRESETS[id]
  if (!preset) throw new Error(`Unknown UnitPresetId: ${id}`)
  return preset
}

export function getUnitPresetsForFaction(faction: CharacterFaction): UnitPreset[] {
  const ids = faction === 'viking' ? VIKING_PRESET_IDS : ROMAN_PRESET_IDS
  return ids.map(id => UNIT_PRESETS[id])
}

export function resolveUnitLoadout(presetId: UnitPresetId, tier: UnitTier): UnitLoadout {
  const preset = getUnitPreset(presetId)
  return preset.tierLoadouts[tier]
}

/**
 * Returns dynamic UI description for a trait, pulling authoritative gameplay values from CombatBalance.
 * Never hardcodes multipliers or distances.
 */
export function getTraitDescription(trait: UnitPresetTrait): string {
  switch (trait) {
    case 'berserker':
      return `諾德狂戰士（移速 ×${COMBAT_BALANCE.berserker.moveSpeedMultiplier}、傷害 ×${COMBAT_BALANCE.berserker.meleeDamageMultiplier}、攻擊頻率 ×${COMBAT_BALANCE.berserker.meleeAttackRateMultiplier}）`
    case 'lance_anti_cavalry':
      return `反騎兵刺擊（徒步長槍對騎兵傷害 ×${COMBAT_BALANCE.lance.unmountedVsMountedDamageMultiplier}）`
    case 'lance_charge':
      return `騎槍衝鋒貫穿（速度 > ${COMBAT_BALANCE.lance.mountedChargeSpeedThreshold} 時傷害 ×${COMBAT_BALANCE.lance.mountedChargeDamageMultiplier}）`
    case 'bow_fire':
      return `弓箭射擊（傷害 ×${COMBAT_BALANCE.bow.damageMultiplier}、射速 ×${COMBAT_BALANCE.bow.attackRateMultiplier}、徒步射程 ${COMBAT_BALANCE.bow.footAttackRange}m / 騎乘 ${COMBAT_BALANCE.bow.mountedAttackRange}m）`
    case 'javelin_throw':
      return `標槍投擲（傷害 ×${COMBAT_BALANCE.javelin.damageMultiplier}、射速 ×${COMBAT_BALANCE.javelin.attackRateMultiplier}、徒步射程 ${COMBAT_BALANCE.javelin.footAttackRange}m / 騎乘 ${COMBAT_BALANCE.javelin.mountedAttackRange}m）`
    case 'shield_defense':
      return '持盾防禦（大幅降低正面受到的近戰與遠程傷害）'
  }
}
