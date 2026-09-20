/**
 * BattleConfig.ts
 * Core domain types, validation, presets, and combat mapping rules for Custom Battle.
 */
import { AIType } from '../world/NPC'
import { WEAPONS } from '../rpg/WeaponDatabase'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { COMBAT_BALANCE, getRangedCombatKind, getRangedDamageMultiplier } from '../combat/CombatBalance'
import {
  UnitTier,
  UnitPresetId,
  VikingPresetId,
  RomanPresetId,
  VIKING_PRESET_IDS,
  ROMAN_PRESET_IDS,
} from './UnitPresetCatalog'

/** Production Custom Battle limit. This remains the only limit accepted from player UI/session data. */
export const MAX_CUSTOM_ARMY_SIZE = 200
/** DEV-only preset limit used by the fixed performance benchmark scenarios. */
export const MAX_BENCHMARK_ARMY_SIZE = 200

export type { UnitTier, UnitPresetId, VikingPresetId, RomanPresetId }
export type BattleUnitType = 'infantry' | 'archer' | 'cavalry' | 'horseArcher'

export interface UnitTierCounts {
  1: number
  2: number
  3: number
}

export type VikingArmyConfig = Partial<Record<VikingPresetId, UnitTierCounts>> & {
  readonly infantry?: UnitTierCounts
  readonly archer?: UnitTierCounts
  readonly cavalry?: UnitTierCounts
  readonly horseArcher?: UnitTierCounts
}

export type RomanArmyConfig = Partial<Record<RomanPresetId, UnitTierCounts>> & {
  readonly infantry?: UnitTierCounts
  readonly archer?: UnitTierCounts
  readonly cavalry?: UnitTierCounts
  readonly horseArcher?: UnitTierCounts
}
export type LegacyArmyConfig = Partial<Record<BattleUnitType, UnitTierCounts>>
export type ArmyConfig = VikingArmyConfig | RomanArmyConfig

export interface BattleRules {
  respawnEnabled: boolean
  includeCamps: boolean
}

export type BattleMode = 'formation' | 'scattered'

export type PlayerMeleeWeaponId =
  | 'rusty_dagger' | 'steel_sword' | 'runic_greatsword'
  | 'gladius_rusty' | 'gladius_standard' | 'centurion_blade'
  | 'hunting_spear' | 'steel_lance' | 'heavy_lance'
export type PlayerRangedWeaponId =
  | 'wooden_shortbow' | 'recurve_longbow' | 'elven_runebow'
  | 'pilum_basic' | 'pilum_standard' | 'legionary_pilum'
export type PlayerShieldId =
  | 'round_shield_t1' | 'round_shield_t2' | 'round_shield_t3'
  | 'scutum_t1' | 'scutum_t2' | 'scutum_t3'

export interface PlayerLoadoutConfig {
  meleeWeaponId: PlayerMeleeWeaponId
  rangedWeaponId: PlayerRangedWeaponId
  shieldId: PlayerShieldId | null
  startMounted: boolean
}

export const DEFAULT_PLAYER_LOADOUT: PlayerLoadoutConfig = {
  meleeWeaponId: 'steel_lance',
  rangedWeaponId: 'elven_runebow',
  shieldId: 'round_shield_t3',
  startMounted: true,
}

export const PLAYER_MELEE_WEAPON_IDS: readonly PlayerMeleeWeaponId[] = [
  'rusty_dagger', 'steel_sword', 'runic_greatsword',
  'gladius_rusty', 'gladius_standard', 'centurion_blade',
  'hunting_spear', 'steel_lance', 'heavy_lance',
]
export const PLAYER_RANGED_WEAPON_IDS: readonly PlayerRangedWeaponId[] = [
  'wooden_shortbow', 'recurve_longbow', 'elven_runebow',
  'pilum_basic', 'pilum_standard', 'legionary_pilum',
]
export const PLAYER_SHIELD_IDS: readonly PlayerShieldId[] = [
  'round_shield_t1', 'round_shield_t2', 'round_shield_t3',
  'scutum_t1', 'scutum_t2', 'scutum_t3',
]

export interface BattleConfig {
  mode?: BattleMode
  spectator?: boolean
  playerFaction?: CharacterFaction
  playerHp?: number
  playerLoadout?: PlayerLoadoutConfig
  viking: VikingArmyConfig
  roman: RomanArmyConfig
  rules: BattleRules
}

export interface UnitCombatProfile {
  shieldId: string | null
  characterFaction: CharacterFaction
  aiType: AIType
  cavalry: boolean
  meleeWeaponId: string
  rangedWeaponId?: string
  baseMeleeDamage: number
  finalMeleeDamage: number
  rangedDamage?: number
  isUsingLance: boolean
  lanceMultiplier: number
}

export function attachArmyAliases(army: any, faction: CharacterFaction): any {
  if (!army || typeof army !== 'object') return army
  const isViking = faction === 'viking'
  const infKey = isViking ? 'viking_berserker' : 'roman_heavy_infantry'
  const archKey = isViking ? 'viking_archer' : (army.roman_javelin_infantry ? 'roman_javelin_infantry' : 'roman_archer')
  const cavKey = isViking ? 'viking_lancer' : 'roman_lancer'
  const haKey = isViking ? 'viking_horse_archer' : 'roman_horse_archer'

  // Ensure underlying preset buckets exist
  if (!army[infKey]) army[infKey] = { 1: 0, 2: 0, 3: 0 }
  if (!army[archKey]) army[archKey] = { 1: 0, 2: 0, 3: 0 }
  if (!army[cavKey]) army[cavKey] = { 1: 0, 2: 0, 3: 0 }
  if (!army[haKey]) army[haKey] = { 1: 0, 2: 0, 3: 0 }

  Object.defineProperties(army, {
    infantry: {
      get() { return this[infKey] },
      set(v) { this[infKey] = v },
      enumerable: false,
      configurable: true,
    },
    archer: {
      get() { return this[archKey] },
      set(v) { this[archKey] = v },
      enumerable: false,
      configurable: true,
    },
    cavalry: {
      get() { return this[cavKey] },
      set(v) { this[cavKey] = v },
      enumerable: false,
      configurable: true,
    },
    horseArcher: {
      get() { return this[haKey] },
      set(v) { this[haKey] = v },
      enumerable: false,
      configurable: true,
    },
  })
  return army
}

export function createEmptyVikingArmyConfig(): VikingArmyConfig {
  return attachArmyAliases({
    viking_berserker: { 1: 0, 2: 0, 3: 0 },
    viking_spearman: { 1: 0, 2: 0, 3: 0 },
    viking_archer: { 1: 0, 2: 0, 3: 0 },
    viking_sword_cavalry: { 1: 0, 2: 0, 3: 0 },
    viking_lancer: { 1: 0, 2: 0, 3: 0 },
    viking_horse_archer: { 1: 0, 2: 0, 3: 0 },
  }, 'viking')
}

export function createEmptyRomanArmyConfig(): RomanArmyConfig {
  return attachArmyAliases({
    roman_heavy_infantry: { 1: 0, 2: 0, 3: 0 },
    roman_spearman: { 1: 0, 2: 0, 3: 0 },
    roman_archer: { 1: 0, 2: 0, 3: 0 },
    roman_javelin_infantry: { 1: 0, 2: 0, 3: 0 },
    roman_sword_cavalry: { 1: 0, 2: 0, 3: 0 },
    roman_lancer: { 1: 0, 2: 0, 3: 0 },
    roman_horse_archer: { 1: 0, 2: 0, 3: 0 },
  }, 'roman')
}

export function createEmptyArmyConfig(faction?: CharacterFaction): any {
  if (faction === 'viking') return createEmptyVikingArmyConfig()
  if (faction === 'roman') return createEmptyRomanArmyConfig()
  return {
    infantry: { 1: 0, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 0, 2: 0, 3: 0 },
    horseArcher: { 1: 0, 2: 0, 3: 0 },
  }
}

export function createEmptyBattleConfig(): BattleConfig {
  return {
    mode: 'formation',
    spectator: false,
    playerFaction: 'viking',
    playerHp: COMBAT_BALANCE.hp.playerDefault,
    viking: createEmptyVikingArmyConfig(),
    roman: createEmptyRomanArmyConfig(),
    rules: {
      respawnEnabled: false,
      includeCamps: true,
    },
  }
}

export function createDefaultPlayerLoadout(): PlayerLoadoutConfig {
  return { ...DEFAULT_PLAYER_LOADOUT }
}

export function normalizeArmyConfig(army: any, faction: CharacterFaction): Record<string, UnitTierCounts> {
  if (!army || typeof army !== 'object') return {}
  const normalized: Record<string, UnitTierCounts> = {}

  // Check for legacy unit type keys
  const legacyKeys = ['infantry', 'archer', 'cavalry', 'horseArcher'] as const
  for (const [key, value] of Object.entries(army)) {
    if (!value || typeof value !== 'object') continue
    const counts = value as UnitTierCounts

    if (legacyKeys.includes(key as any)) {
      let mappedPresetId: string
      if (faction === 'viking') {
        switch (key) {
          case 'infantry': mappedPresetId = 'viking_berserker'; break
          case 'archer': mappedPresetId = 'viking_archer'; break
          case 'cavalry': mappedPresetId = 'viking_lancer'; break
          case 'horseArcher': mappedPresetId = 'viking_horse_archer'; break
          default: mappedPresetId = key
        }
      } else {
        switch (key) {
          case 'infantry': mappedPresetId = 'roman_heavy_infantry'; break
          case 'archer': mappedPresetId = 'roman_javelin_infantry'; break
          case 'cavalry': mappedPresetId = 'roman_lancer'; break
          case 'horseArcher': mappedPresetId = 'roman_horse_archer'; break
          default: mappedPresetId = key
        }
      }
      normalized[mappedPresetId] = {
        1: (normalized[mappedPresetId]?.[1] || 0) + (counts[1] || 0),
        2: (normalized[mappedPresetId]?.[2] || 0) + (counts[2] || 0),
        3: (normalized[mappedPresetId]?.[3] || 0) + (counts[3] || 0),
      }
    } else {
      normalized[key] = {
        1: (normalized[key]?.[1] || 0) + (counts[1] || 0),
        2: (normalized[key]?.[2] || 0) + (counts[2] || 0),
        3: (normalized[key]?.[3] || 0) + (counts[3] || 0),
      }
    }
  }

  return normalized
}

export function calculateArmyTotal(army: any): number {
  if (!army || typeof army !== 'object') return 0
  let total = 0
  for (const key of Object.keys(army)) {
    const counts = army[key]
    if (counts && typeof counts === 'object') {
      total += (counts[1] || 0) + (counts[2] || 0) + (counts[3] || 0)
    }
  }
  return total
}

function validateBattleConfigWithArmyLimit(
  config: unknown,
  maxArmySize: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Invalid config object'] }
  }

  const c = config as BattleConfig

  if (c.mode !== undefined && c.mode !== 'formation' && c.mode !== 'scattered') {
    errors.push(`Invalid battle mode: ${String(c.mode)}`)
  }

  if (c.spectator !== undefined && typeof c.spectator !== 'boolean') {
    errors.push('spectator must be a boolean')
  }

  if (c.playerFaction !== undefined && c.playerFaction !== 'viking' && c.playerFaction !== 'roman') {
    errors.push(`Invalid player faction: ${String(c.playerFaction)}`)
  }

  if (c.playerHp !== undefined) {
    if (typeof c.playerHp !== 'number' || !Number.isInteger(c.playerHp) || c.playerHp < 1 || c.playerHp > 9999) {
      errors.push('playerHp must be an integer between 1 and 9999')
    }
  }

  if (c.playerLoadout !== undefined) {
    const loadout = c.playerLoadout
    if (!loadout || typeof loadout !== 'object') {
      errors.push('playerLoadout must be an object')
    } else {
      if (!(PLAYER_MELEE_WEAPON_IDS as readonly string[]).includes(loadout.meleeWeaponId)) errors.push(`Invalid player melee weapon: ${String(loadout.meleeWeaponId)}`)
      if (!(PLAYER_RANGED_WEAPON_IDS as readonly string[]).includes(loadout.rangedWeaponId)) errors.push(`Invalid player ranged weapon: ${String(loadout.rangedWeaponId)}`)
      if (loadout.shieldId !== null && !(PLAYER_SHIELD_IDS as readonly string[]).includes(loadout.shieldId)) errors.push(`Invalid player shield: ${String(loadout.shieldId)}`)
      if (typeof loadout.startMounted !== 'boolean') errors.push('playerLoadout.startMounted must be a boolean')
    }
  }

  if (!c.viking || !c.roman) {
    return { valid: false, errors: ['Missing viking or roman army configuration'] }
  }

  if (!c.rules || typeof c.rules !== 'object') {
    errors.push('Missing or invalid battle rules configuration')
  } else {
    if (typeof c.rules.respawnEnabled !== 'boolean') {
      errors.push('rules.respawnEnabled must be a boolean')
    }
    if (typeof c.rules.includeCamps !== 'boolean') {
      errors.push('rules.includeCamps must be a boolean')
    }
  }

  const checkArmy = (army: any, faction: CharacterFaction, sideName: string): number => {
    let sideTotal = 0
    const normalized = normalizeArmyConfig(army, faction)
    const allowedPresetIds = faction === 'viking' ? VIKING_PRESET_IDS : ROMAN_PRESET_IDS
    const forbiddenPresetIds = faction === 'viking' ? ROMAN_PRESET_IDS : VIKING_PRESET_IDS

    for (const key of Object.keys(army)) {
      if ((forbiddenPresetIds as readonly string[]).includes(key)) {
        errors.push(`${sideName} army cannot contain foreign faction preset: ${key}`)
      } else if (
        !(allowedPresetIds as readonly string[]).includes(key) &&
        !['infantry', 'archer', 'cavalry', 'horseArcher'].includes(key)
      ) {
        errors.push(`Invalid preset id: ${key} for ${sideName} army`)
      }
    }

    for (const [presetId, counts] of Object.entries(normalized)) {
      if (!counts || typeof counts !== 'object') {
        errors.push(`${sideName} missing unit preset ${presetId}`)
        continue
      }
      for (const tier of [1, 2, 3] as UnitTier[]) {
        const val = counts[tier]
        if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
          errors.push(`${sideName} ${presetId} T${tier} must be a non-negative integer`)
        } else if (val > maxArmySize) {
          errors.push(`${sideName} ${presetId} T${tier} exceeds maximum ${maxArmySize}`)
        } else {
          sideTotal += val
        }
      }
    }
    return sideTotal
  }

  const vikingTotal = checkArmy(c.viking, 'viking', 'Viking')
  const romanTotal = checkArmy(c.roman, 'roman', 'Roman')

  if (vikingTotal < 1) {
    errors.push('Viking army must have at least 1 unit')
  } else if (vikingTotal > maxArmySize) {
    errors.push(`Viking army total (${vikingTotal}) exceeds ${maxArmySize}`)
  }

  if (romanTotal < 1) {
    errors.push('Roman army must have at least 1 unit')
  } else if (romanTotal > maxArmySize) {
    errors.push(`Roman army total (${romanTotal}) exceeds ${maxArmySize}`)
  }

  return { valid: errors.length === 0, errors }
}

/** Validates untrusted production Custom Battle data using the production army limit. */
export function validateBattleConfig(config: unknown): { valid: boolean; errors: string[] } {
  return validateBattleConfigWithArmyLimit(config, MAX_CUSTOM_ARMY_SIZE)
}

/** Validates trusted, fixed DEV benchmark presets without changing production validation. */
export function validateBenchmarkBattleConfig(config: unknown): { valid: boolean; errors: string[] } {
  return validateBattleConfigWithArmyLimit(config, MAX_BENCHMARK_ARMY_SIZE)
}

/**
 * Returns combat profile and authoritative damage calculation for a given unit.
 * Backward-compatible adapter delegating to UnitPresetCatalog and CombatBalance.
 */
export function getUnitCombatProfile(
  characterFaction: CharacterFaction,
  unitType: BattleUnitType,
  tier: UnitTier
): UnitCombatProfile {
  const aiType = (unitType === 'archer' || unitType === 'horseArcher') ? AIType.RANGED : AIType.MELEE
  const cavalry = (unitType === 'cavalry' || unitType === 'horseArcher')
  const isUsingLance = cavalry && aiType === AIType.MELEE
  const lanceMultiplier = 1.0

  let meleeWeaponId: string
  let rangedWeaponId: string | undefined

  if (isUsingLance) {
    meleeWeaponId = tier === 1 ? 'hunting_spear' : tier === 2 ? 'steel_lance' : 'heavy_lance'
  } else if (characterFaction === 'viking') {
    // Viking
    const meleeT = aiType === AIType.RANGED ? 1 : tier
    meleeWeaponId = meleeT === 1 ? 'rusty_dagger' : meleeT === 2 ? 'steel_sword' : 'runic_greatsword'
  } else {
    // Roman
    const meleeT = aiType === AIType.RANGED ? 1 : tier
    meleeWeaponId = meleeT === 1 ? 'gladius_rusty' : meleeT === 2 ? 'gladius_standard' : 'centurion_blade'
  }

  if (aiType === AIType.RANGED) {
    if (characterFaction === 'viking' || unitType === 'horseArcher') {
      rangedWeaponId = tier === 1 ? 'wooden_shortbow' : tier === 2 ? 'recurve_longbow' : 'elven_runebow'
    } else {
      rangedWeaponId = tier === 1 ? 'pilum_basic' : tier === 2 ? 'pilum_standard' : 'legionary_pilum'
    }
  }

  const baseMeleeDamage = WEAPONS[meleeWeaponId]?.damageMax ?? (isUsingLance ? (tier === 1 ? 30 : tier === 2 ? 45 : 60) : 12)
  const finalMeleeDamage = baseMeleeDamage * lanceMultiplier
  const baseRangedDamage = rangedWeaponId ? (WEAPONS[rangedWeaponId]?.damageMax ?? 22) : undefined
  const rangedWeapon = rangedWeaponId ? WEAPONS[rangedWeaponId] : undefined
  const rangedKind = getRangedCombatKind(rangedWeapon)
  const rangedDamage = baseRangedDamage !== undefined
    ? baseRangedDamage * getRangedDamageMultiplier(rangedKind)
    : undefined

  return {
    characterFaction,
    aiType,
    cavalry,
    meleeWeaponId,
    rangedWeaponId,
    baseMeleeDamage,
    finalMeleeDamage,
    shieldId: aiType === AIType.MELEE ? `${characterFaction === 'viking' ? 'round_shield' : 'scutum'}_t${tier}` : null,
    rangedDamage,
    isUsingLance,
    lanceMultiplier,
  }
}

// ── Presets ──

function definePreset(config: BattleConfig): BattleConfig {
  attachArmyAliases(config.viking, 'viking')
  attachArmyAliases(config.roman, 'roman')
  return config
}

export const PRESET_10V10: BattleConfig = definePreset({
  mode: 'formation',
  playerHp: COMBAT_BALANCE.hp.playerDefault,
  viking: {
    viking_berserker: { 1: 4, 2: 0, 3: 0 },
    viking_archer: { 1: 0, 2: 2, 3: 0 },
    viking_lancer: { 1: 0, 2: 2, 3: 0 },
    viking_horse_archer: { 1: 0, 2: 0, 3: 2 },
  },
  roman: {
    roman_heavy_infantry: { 1: 4, 2: 0, 3: 0 },
    roman_javelin_infantry: { 1: 0, 2: 2, 3: 0 },
    roman_lancer: { 1: 0, 2: 2, 3: 0 },
    roman_horse_archer: { 1: 0, 2: 0, 3: 2 },
  },
  rules: { respawnEnabled: false, includeCamps: true },
})

export const PRESET_25V25: BattleConfig = definePreset({
  mode: 'formation',
  playerHp: COMBAT_BALANCE.hp.playerDefault,
  viking: {
    viking_berserker: { 1: 4, 2: 4, 3: 0 },
    viking_archer: { 1: 3, 2: 3, 3: 0 },
    viking_lancer: { 1: 0, 2: 3, 3: 3 },
    viking_horse_archer: { 1: 0, 2: 2, 3: 3 },
  },
  roman: {
    roman_heavy_infantry: { 1: 4, 2: 4, 3: 0 },
    roman_javelin_infantry: { 1: 3, 2: 3, 3: 0 },
    roman_lancer: { 1: 0, 2: 3, 3: 3 },
    roman_horse_archer: { 1: 0, 2: 2, 3: 3 },
  },
  rules: { respawnEnabled: false, includeCamps: true },
})

export const PRESET_50V50: BattleConfig = definePreset({
  mode: 'formation',
  playerHp: COMBAT_BALANCE.hp.playerDefault,
  viking: {
    viking_berserker: { 1: 5, 2: 5, 3: 5 },
    viking_archer: { 1: 5, 2: 5, 3: 5 },
    viking_lancer: { 1: 3, 2: 4, 3: 3 },
    viking_horse_archer: { 1: 3, 2: 4, 3: 3 },
  },
  roman: {
    roman_heavy_infantry: { 1: 5, 2: 5, 3: 5 },
    roman_javelin_infantry: { 1: 5, 2: 5, 3: 5 },
    roman_lancer: { 1: 3, 2: 4, 3: 3 },
    roman_horse_archer: { 1: 3, 2: 4, 3: 3 },
  },
  rules: { respawnEnabled: false, includeCamps: true },
})

export const PRESET_100V100: BattleConfig = definePreset({
  mode: 'formation',
  playerHp: COMBAT_BALANCE.hp.playerDefault,
  viking: {
    viking_berserker: { 1: 10, 2: 10, 3: 10 },
    viking_archer: { 1: 10, 2: 10, 3: 10 },
    viking_lancer: { 1: 5, 2: 10, 3: 5 },
    viking_horse_archer: { 1: 5, 2: 10, 3: 5 },
  },
  roman: {
    roman_heavy_infantry: { 1: 10, 2: 10, 3: 10 },
    roman_javelin_infantry: { 1: 10, 2: 10, 3: 10 },
    roman_lancer: { 1: 5, 2: 10, 3: 5 },
    roman_horse_archer: { 1: 5, 2: 10, 3: 5 },
  },
  rules: { respawnEnabled: false, includeCamps: true },
})

/** Standard Custom Battle preset: 200v200 mixed army with normal player gameplay rules. */
export const PRESET_200V200: BattleConfig = definePreset({
  mode: 'formation',
  playerHp: COMBAT_BALANCE.hp.playerDefault,
  viking: {
    viking_berserker: { 1: 20, 2: 24, 3: 16 },
    viking_archer: { 1: 20, 2: 24, 3: 16 },
    viking_lancer: { 1: 12, 2: 16, 3: 12 },
    viking_horse_archer: { 1: 12, 2: 16, 3: 12 },
  },
  roman: {
    roman_heavy_infantry: { 1: 20, 2: 24, 3: 16 },
    roman_javelin_infantry: { 1: 20, 2: 24, 3: 16 },
    roman_lancer: { 1: 12, 2: 16, 3: 12 },
    roman_horse_archer: { 1: 12, 2: 16, 3: 12 },
  },
  rules: { respawnEnabled: false, includeCamps: true },
})

/** Developer performance scenario A: 50v50 Infantry */
export const PRESET_SCENARIO_A: BattleConfig = definePreset({
  mode: 'formation',
  viking: {
    viking_berserker: { 1: 20, 2: 20, 3: 10 },
  },
  roman: {
    roman_heavy_infantry: { 1: 20, 2: 20, 3: 10 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
})

/** Developer performance scenario B: 100v100 Infantry */
export const PRESET_SCENARIO_B: BattleConfig = definePreset({
  mode: 'formation',
  viking: {
    viking_berserker: { 1: 40, 2: 40, 3: 20 },
  },
  roman: {
    roman_heavy_infantry: { 1: 40, 2: 40, 3: 20 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
})

/** Developer performance scenario C: 100v100 Mixed */
export const PRESET_SCENARIO_C: BattleConfig = PRESET_100V100

/** Developer performance scenario D: 100v100 Cavalry / Horse Archer (50 Cavalry + 50 Horse Archer) */
export const PRESET_SCENARIO_D: BattleConfig = definePreset({
  mode: 'formation',
  viking: {
    viking_lancer: { 1: 15, 2: 20, 3: 15 },
    viking_horse_archer: { 1: 15, 2: 20, 3: 15 },
  },
  roman: {
    roman_lancer: { 1: 15, 2: 20, 3: 15 },
    roman_horse_archer: { 1: 15, 2: 20, 3: 15 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
})

/** Developer performance scenario E: 100v100 All-Melee Cavalry, Scattered Battle, Initial Spectator */
export const PRESET_SCENARIO_E: BattleConfig = definePreset({
  mode: 'scattered',
  spectator: true,
  viking: {
    viking_lancer: { 1: 30, 2: 40, 3: 30 },
  },
  roman: {
    roman_lancer: { 1: 30, 2: 40, 3: 30 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
})

/** Developer performance scenario F: 100v100 Mixed Cavalry Stress (50 Melee Cavalry + 50 Horse Archer per faction), Scattered Battle, Initial Spectator */
export const PRESET_SCENARIO_F: BattleConfig = definePreset({
  mode: 'scattered',
  spectator: true,
  viking: {
    viking_lancer: { 1: 15, 2: 20, 3: 15 },
    viking_horse_archer: { 1: 15, 2: 20, 3: 15 },
  },
  roman: {
    roman_lancer: { 1: 15, 2: 20, 3: 15 },
    roman_horse_archer: { 1: 15, 2: 20, 3: 15 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
})

/** Developer performance scenario G: 200v200 Infantry. */
export const PRESET_SCENARIO_G: BattleConfig = definePreset({
  mode: 'formation',
  spectator: true,
  viking: {
    viking_berserker: { 1: 80, 2: 80, 3: 40 },
  },
  roman: {
    roman_heavy_infantry: { 1: 80, 2: 80, 3: 40 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
})

/** Developer performance scenario H: 200v200 Mixed, Formation, Initial Spectator. */
export const PRESET_SCENARIO_H: BattleConfig = definePreset({
  mode: 'formation',
  spectator: true,
  viking: {
    viking_berserker: { 1: 20, 2: 24, 3: 16 },
    viking_archer: { 1: 20, 2: 24, 3: 16 },
    viking_lancer: { 1: 12, 2: 16, 3: 12 },
    viking_horse_archer: { 1: 12, 2: 16, 3: 12 },
  },
  roman: {
    roman_heavy_infantry: { 1: 20, 2: 24, 3: 16 },
    roman_javelin_infantry: { 1: 20, 2: 24, 3: 16 },
    roman_lancer: { 1: 12, 2: 16, 3: 12 },
    roman_horse_archer: { 1: 12, 2: 16, 3: 12 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
})

/** Developer performance scenario I: 200v200 Cavalry / Horse Archer stress, Scattered, Initial Spectator. */
export const PRESET_SCENARIO_I: BattleConfig = definePreset({
  mode: 'scattered',
  spectator: true,
  viking: {
    viking_lancer: { 1: 30, 2: 40, 3: 30 },
    viking_horse_archer: { 1: 30, 2: 40, 3: 30 },
  },
  roman: {
    roman_lancer: { 1: 30, 2: 40, 3: 30 },
    roman_horse_archer: { 1: 30, 2: 40, 3: 30 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
})

/** Developer performance scenario (?devcombat): 50v50 cavalry, no camps. */
export const PRESET_DEVCOMBAT: BattleConfig = definePreset({
  mode: 'formation',
  viking: {
    viking_lancer: { 1: 0, 2: 0, 3: 25 },
    viking_horse_archer: { 1: 0, 2: 0, 3: 25 },
  },
  roman: {
    roman_lancer: { 1: 0, 2: 0, 3: 25 },
    roman_horse_archer: { 1: 0, 2: 0, 3: 25 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
})

export function getDefaultBattleConfig(): BattleConfig {
  const config: BattleConfig = JSON.parse(JSON.stringify(PRESET_10V10))
  config.playerFaction = 'viking'
  config.playerHp = COMBAT_BALANCE.hp.playerDefault
  config.playerLoadout = createDefaultPlayerLoadout()
  return config
}
