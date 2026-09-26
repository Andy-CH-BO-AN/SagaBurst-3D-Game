/**
 * UnitPresetCatalog.ts
 * Authoritative Catalog of Unit Presets (Archetypes) for Custom Battle.
 * Presets determine starting loadouts (melee weapon, ranged weapon, shield, mount).
 * Live combat behavior is determined strictly at runtime by current equipment, mount state, and CombatBalance.
 */
import type { CharacterFaction } from '../world/CharacterVisuals'
import { COMBAT_BALANCE } from '../combat/CombatBalance'
import { ARMORS } from '../rpg/ArmorDatabase'

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
  secondaryMeleeWeaponId?: string | null
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
    nameZh: '維京資深戰士',
    nameEn: 'Viking Veteran',
    description: '經驗豐富的維京近戰步兵，平時持同階長斧與圓盾穩健作戰；聽到衝鋒號後會卸下盾牌，化身狂戰士投入近戰。',
    traits: ['shield_defense'],
    tierLoadouts: {
      1: { meleeWeaponId: 'viking_axe_t1', rangedWeaponId: null, shieldId: 'round_shield_t1', mountId: null },
      2: { meleeWeaponId: 'viking_axe_t2', rangedWeaponId: null, shieldId: 'round_shield_t2', mountId: null },
      3: { meleeWeaponId: 'viking_axe_t3', rangedWeaponId: null, shieldId: 'round_shield_t3', mountId: null },
    },
  },
  viking_spearman: {
    id: 'viking_spearman',
    faction: 'viking',
    nameZh: '槍兵',
    nameEn: 'Spearman',
    description: '徒步長槍兵，專精剋制騎兵，並攜帶同階長劍作為備用武器；聽到衝鋒號後會收起長槍、拔劍化身狂戰士。',
    traits: ['lance_anti_cavalry'],
    tierLoadouts: {
      1: { meleeWeaponId: 'hunting_spear', secondaryMeleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null, mountId: null },
      2: { meleeWeaponId: 'steel_lance', secondaryMeleeWeaponId: 'steel_sword', rangedWeaponId: null, shieldId: null, mountId: null },
      3: { meleeWeaponId: 'heavy_lance', secondaryMeleeWeaponId: 'runic_greatsword', rangedWeaponId: null, shieldId: null, mountId: null },
    },
  },
  viking_archer: {
    id: 'viking_archer',
    faction: 'viking',
    nameZh: '弓兵',
    nameEn: 'Archer',
    description: '諾德長弓手，擅長長距離射擊，近身以短匕自衛；聽到衝鋒號後會放下弓箭、拔出短匕，化身狂戰士衝入近戰。',
    traits: ['bow_fire'],
    tierLoadouts: {
      1: { meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'wooden_shortbow', shieldId: null, mountId: null },
      2: { meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null },
      3: { meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'elven_runebow', shieldId: null, mountId: null },
    },
  },
  viking_sword_cavalry: {
    id: 'viking_sword_cavalry',
    faction: 'viking',
    nameZh: '斧騎兵',
    nameEn: 'Axe Cavalry',
    description: '持長斧與圓盾的突擊輕騎兵，攻守均衡。',
    traits: ['shield_defense'],
    tierLoadouts: {
      1: { meleeWeaponId: 'viking_axe_t1', rangedWeaponId: null, shieldId: 'round_shield_t1', mountId: 'horse' },
      2: { meleeWeaponId: 'viking_axe_t2', rangedWeaponId: null, shieldId: 'round_shield_t2', mountId: 'horse' },
      3: { meleeWeaponId: 'viking_axe_t3', rangedWeaponId: null, shieldId: 'round_shield_t3', mountId: 'black-cat' },
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
      3: { meleeWeaponId: 'heavy_lance', rangedWeaponId: null, shieldId: null, mountId: 'black-cat' },
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
      2: { meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: 'horse' },
      3: { meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'elven_runebow', shieldId: null, mountId: 'black-cat' },
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
    description: '羅馬軍團弓箭手，提供長程遠程壓制火力，近身以短劍自衛。',
    traits: ['bow_fire'],
    tierLoadouts: {
      1: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'wooden_shortbow', shieldId: null, mountId: null },
      2: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null },
      3: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'elven_runebow', shieldId: null, mountId: null },
    },
  },
  roman_javelin_infantry: {
    id: 'roman_javelin_infantry',
    faction: 'roman',
    nameZh: '標槍兵',
    nameEn: 'Javelin Infantry',
    description: '羅馬軍團標槍步兵，投擲重標槍破壞敵陣，近身以短劍自衛。',
    traits: ['javelin_throw'],
    tierLoadouts: {
      1: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'pilum_basic', shieldId: null, mountId: null },
      2: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'pilum_standard', shieldId: null, mountId: null },
      3: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'legionary_pilum', shieldId: null, mountId: null },
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
      3: { meleeWeaponId: 'centurion_blade', rangedWeaponId: null, shieldId: 'scutum_t3', mountId: 'corgi' },
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
      3: { meleeWeaponId: 'heavy_lance', rangedWeaponId: null, shieldId: null, mountId: 'corgi' },
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
      2: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: 'horse' },
      3: { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'elven_runebow', shieldId: null, mountId: 'corgi' },
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
      return `持盾防禦（持盾受傷減免：T1 ${Math.round(ARMORS.round_shield_t1.damageReduction * 100)}%、T2 ${Math.round(ARMORS.round_shield_t2.damageReduction * 100)}%、T3 ${Math.round(ARMORS.round_shield_t3.damageReduction * 100)}%）`
  }
}
