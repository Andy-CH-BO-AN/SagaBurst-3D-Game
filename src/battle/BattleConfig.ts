/**
 * BattleConfig.ts
 * Core domain types, validation, presets, and combat mapping rules for Custom Battle.
 */
import { AIType } from '../world/NPC'
import { WEAPONS } from '../rpg/WeaponDatabase'
import type { CharacterFaction } from '../world/CharacterVisuals'

/** Production Custom Battle limit. This remains the only limit accepted from player UI/session data. */
export const MAX_CUSTOM_ARMY_SIZE = 200
/** DEV-only preset limit used by the fixed performance benchmark scenarios. */
export const MAX_BENCHMARK_ARMY_SIZE = 200

export type UnitTier = 1 | 2 | 3
export type BattleUnitType = 'infantry' | 'archer' | 'cavalry' | 'horseArcher'

export interface UnitTierCounts {
  1: number
  2: number
  3: number
}

export interface ArmyConfig {
  infantry: UnitTierCounts
  archer: UnitTierCounts
  cavalry: UnitTierCounts
  horseArcher: UnitTierCounts
}

export interface BattleRules {
  respawnEnabled: boolean
  includeCamps: boolean
}

export type BattleMode = 'formation' | 'scattered'

export type PlayerMeleeWeaponId =
  | 'rusty_dagger' | 'steel_sword' | 'runic_greatsword'
  | 'gladius_rusty' | 'gladius_standard' | 'centurion_blade'
  | 'steel_lance'
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
  'gladius_rusty', 'gladius_standard', 'centurion_blade', 'steel_lance',
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
  playerLoadout?: PlayerLoadoutConfig
  viking: ArmyConfig
  roman: ArmyConfig
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

export function createEmptyArmyConfig(): ArmyConfig {
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
    viking: createEmptyArmyConfig(),
    roman: createEmptyArmyConfig(),
    rules: {
      respawnEnabled: false,
      includeCamps: true,
    },
  }
}

export function createDefaultPlayerLoadout(): PlayerLoadoutConfig {
  return { ...DEFAULT_PLAYER_LOADOUT }
}

export function calculateArmyTotal(army: ArmyConfig): number {
  if (!army) return 0
  let total = 0
  const categories: BattleUnitType[] = ['infantry', 'archer', 'cavalry', 'horseArcher']
  for (const cat of categories) {
    const counts = army[cat]
    if (counts) {
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

  const checkArmy = (army: ArmyConfig, sideName: string): number => {
    let sideTotal = 0
    const categories: BattleUnitType[] = ['infantry', 'archer', 'cavalry', 'horseArcher']
    for (const cat of categories) {
      const counts = army[cat]
      if (!counts || typeof counts !== 'object') {
        errors.push(`${sideName} missing unit type ${cat}`)
        continue
      }
      for (const tier of [1, 2, 3] as UnitTier[]) {
        const val = counts[tier]
        if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
          errors.push(`${sideName} ${cat} T${tier} must be a non-negative integer`)
        } else if (val > maxArmySize) {
          errors.push(`${sideName} ${cat} T${tier} exceeds maximum ${maxArmySize}`)
        } else {
          sideTotal += val
        }
      }
    }
    return sideTotal
  }

  const vikingTotal = checkArmy(c.viking, 'Viking')
  const romanTotal = checkArmy(c.roman, 'Roman')

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
 */
export function getUnitCombatProfile(
  characterFaction: CharacterFaction,
  unitType: BattleUnitType,
  tier: UnitTier
): UnitCombatProfile {
  const aiType = (unitType === 'archer' || unitType === 'horseArcher') ? AIType.RANGED : AIType.MELEE
  const cavalry = (unitType === 'cavalry' || unitType === 'horseArcher')
  const isUsingLance = cavalry && aiType === AIType.MELEE
  const lanceMultiplier = isUsingLance ? 1.5 : 1.0

  let meleeWeaponId: string
  let rangedWeaponId: string | undefined

  if (isUsingLance) {
    meleeWeaponId = 'steel_lance'
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
    if (characterFaction === 'viking') {
      rangedWeaponId = tier === 1 ? 'wooden_shortbow' : tier === 2 ? 'recurve_longbow' : 'elven_runebow'
    } else {
      rangedWeaponId = tier === 1 ? 'pilum_basic' : tier === 2 ? 'pilum_standard' : 'legionary_pilum'
    }
  }

  const baseMeleeDamage = isUsingLance
    ? (tier === 1 ? 12 : tier === 2 ? 25 : 45)
    : (WEAPONS[meleeWeaponId]?.damageMax ?? 12)
  const finalMeleeDamage = baseMeleeDamage * lanceMultiplier
  const rangedDamage = rangedWeaponId ? (WEAPONS[rangedWeaponId]?.damageMax ?? 22) : undefined

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

export const PRESET_10V10: BattleConfig = {
  mode: 'formation',
  viking: {
    infantry: { 1: 4, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 2, 3: 0 },
    cavalry: { 1: 0, 2: 2, 3: 0 },
    horseArcher: { 1: 0, 2: 0, 3: 2 },
  },
  roman: {
    infantry: { 1: 4, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 2, 3: 0 },
    cavalry: { 1: 0, 2: 2, 3: 0 },
    horseArcher: { 1: 0, 2: 0, 3: 2 },
  },
  rules: { respawnEnabled: false, includeCamps: true },
}

export const PRESET_25V25: BattleConfig = {
  mode: 'formation',
  viking: {
    infantry: { 1: 4, 2: 4, 3: 0 },
    archer: { 1: 3, 2: 3, 3: 0 },
    cavalry: { 1: 0, 2: 3, 3: 3 },
    horseArcher: { 1: 0, 2: 2, 3: 3 },
  },
  roman: {
    infantry: { 1: 4, 2: 4, 3: 0 },
    archer: { 1: 3, 2: 3, 3: 0 },
    cavalry: { 1: 0, 2: 3, 3: 3 },
    horseArcher: { 1: 0, 2: 2, 3: 3 },
  },
  rules: { respawnEnabled: false, includeCamps: true },
}

export const PRESET_50V50: BattleConfig = {
  mode: 'formation',
  viking: {
    infantry: { 1: 5, 2: 5, 3: 5 },
    archer: { 1: 5, 2: 5, 3: 5 },
    cavalry: { 1: 3, 2: 4, 3: 3 },
    horseArcher: { 1: 3, 2: 4, 3: 3 },
  },
  roman: {
    infantry: { 1: 5, 2: 5, 3: 5 },
    archer: { 1: 5, 2: 5, 3: 5 },
    cavalry: { 1: 3, 2: 4, 3: 3 },
    horseArcher: { 1: 3, 2: 4, 3: 3 },
  },
  rules: { respawnEnabled: false, includeCamps: true },
}

export const PRESET_100V100: BattleConfig = {
  mode: 'formation',
  viking: {
    infantry: { 1: 10, 2: 10, 3: 10 },
    archer: { 1: 10, 2: 10, 3: 10 },
    cavalry: { 1: 5, 2: 10, 3: 5 },
    horseArcher: { 1: 5, 2: 10, 3: 5 },
  },
  roman: {
    infantry: { 1: 10, 2: 10, 3: 10 },
    archer: { 1: 10, 2: 10, 3: 10 },
    cavalry: { 1: 5, 2: 10, 3: 5 },
    horseArcher: { 1: 5, 2: 10, 3: 5 },
  },
  rules: { respawnEnabled: false, includeCamps: true },
}

/** Standard Custom Battle preset: 200v200 mixed army with normal player gameplay rules. */
export const PRESET_200V200: BattleConfig = {
  mode: 'formation',
  viking: {
    infantry: { 1: 20, 2: 24, 3: 16 },
    archer: { 1: 20, 2: 24, 3: 16 },
    cavalry: { 1: 12, 2: 16, 3: 12 },
    horseArcher: { 1: 12, 2: 16, 3: 12 },
  },
  roman: {
    infantry: { 1: 20, 2: 24, 3: 16 },
    archer: { 1: 20, 2: 24, 3: 16 },
    cavalry: { 1: 12, 2: 16, 3: 12 },
    horseArcher: { 1: 12, 2: 16, 3: 12 },
  },
  rules: { respawnEnabled: false, includeCamps: true },
}

/** Developer performance scenario A: 50v50 Infantry */
export const PRESET_SCENARIO_A: BattleConfig = {
  mode: 'formation',
  viking: {
    infantry: { 1: 20, 2: 20, 3: 10 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 0, 2: 0, 3: 0 },
    horseArcher: { 1: 0, 2: 0, 3: 0 },
  },
  roman: {
    infantry: { 1: 20, 2: 20, 3: 10 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 0, 2: 0, 3: 0 },
    horseArcher: { 1: 0, 2: 0, 3: 0 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
}

/** Developer performance scenario B: 100v100 Infantry */
export const PRESET_SCENARIO_B: BattleConfig = {
  mode: 'formation',
  viking: {
    infantry: { 1: 40, 2: 40, 3: 20 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 0, 2: 0, 3: 0 },
    horseArcher: { 1: 0, 2: 0, 3: 0 },
  },
  roman: {
    infantry: { 1: 40, 2: 40, 3: 20 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 0, 2: 0, 3: 0 },
    horseArcher: { 1: 0, 2: 0, 3: 0 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
}

/** Developer performance scenario C: 100v100 Mixed */
export const PRESET_SCENARIO_C: BattleConfig = PRESET_100V100

/** Developer performance scenario D: 100v100 Cavalry / Horse Archer (50 Cavalry + 50 Horse Archer) */
export const PRESET_SCENARIO_D: BattleConfig = {
  mode: 'formation',
  viking: {
    infantry: { 1: 0, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 15, 2: 20, 3: 15 },
    horseArcher: { 1: 15, 2: 20, 3: 15 },
  },
  roman: {
    infantry: { 1: 0, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 15, 2: 20, 3: 15 },
    horseArcher: { 1: 15, 2: 20, 3: 15 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
}

/** Developer performance scenario E: 100v100 All-Melee Cavalry, Scattered Battle, Initial Spectator */
export const PRESET_SCENARIO_E: BattleConfig = {
  mode: 'scattered',
  spectator: true,
  viking: {
    infantry: { 1: 0, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 30, 2: 40, 3: 30 },
    horseArcher: { 1: 0, 2: 0, 3: 0 },
  },
  roman: {
    infantry: { 1: 0, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 30, 2: 40, 3: 30 },
    horseArcher: { 1: 0, 2: 0, 3: 0 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
}

/** Developer performance scenario F: 100v100 Mixed Cavalry Stress (50 Melee Cavalry + 50 Horse Archer per faction), Scattered Battle, Initial Spectator */
export const PRESET_SCENARIO_F: BattleConfig = {
  mode: 'scattered',
  spectator: true,
  viking: {
    infantry: { 1: 0, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 15, 2: 20, 3: 15 },
    horseArcher: { 1: 15, 2: 20, 3: 15 },
  },
  roman: {
    infantry: { 1: 0, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 15, 2: 20, 3: 15 },
    horseArcher: { 1: 15, 2: 20, 3: 15 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
}

/** Developer performance scenario G: 200v200 Infantry. */
export const PRESET_SCENARIO_G: BattleConfig = {
  mode: 'formation',
  spectator: true,
  viking: {
    infantry: { 1: 80, 2: 80, 3: 40 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 0, 2: 0, 3: 0 },
    horseArcher: { 1: 0, 2: 0, 3: 0 },
  },
  roman: {
    infantry: { 1: 80, 2: 80, 3: 40 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 0, 2: 0, 3: 0 },
    horseArcher: { 1: 0, 2: 0, 3: 0 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
}

/** Developer performance scenario H: 200v200 Mixed, Formation, Initial Spectator. */
export const PRESET_SCENARIO_H: BattleConfig = {
  mode: 'formation',
  spectator: true,
  viking: {
    infantry: { 1: 20, 2: 24, 3: 16 },
    archer: { 1: 20, 2: 24, 3: 16 },
    cavalry: { 1: 12, 2: 16, 3: 12 },
    horseArcher: { 1: 12, 2: 16, 3: 12 },
  },
  roman: {
    infantry: { 1: 20, 2: 24, 3: 16 },
    archer: { 1: 20, 2: 24, 3: 16 },
    cavalry: { 1: 12, 2: 16, 3: 12 },
    horseArcher: { 1: 12, 2: 16, 3: 12 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
}

/** Developer performance scenario I: 200v200 Cavalry / Horse Archer stress, Scattered, Initial Spectator. */
export const PRESET_SCENARIO_I: BattleConfig = {
  mode: 'scattered',
  spectator: true,
  viking: {
    infantry: { 1: 0, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 30, 2: 40, 3: 30 },
    horseArcher: { 1: 30, 2: 40, 3: 30 },
  },
  roman: {
    infantry: { 1: 0, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 30, 2: 40, 3: 30 },
    horseArcher: { 1: 30, 2: 40, 3: 30 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
}

/** Developer performance scenario (?devcombat): 50v50 cavalry, no camps. */
export const PRESET_DEVCOMBAT: BattleConfig = {
  mode: 'formation',
  viking: {
    infantry: { 1: 0, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 0, 2: 0, 3: 25 },
    horseArcher: { 1: 0, 2: 0, 3: 25 },
  },
  roman: {
    infantry: { 1: 0, 2: 0, 3: 0 },
    archer: { 1: 0, 2: 0, 3: 0 },
    cavalry: { 1: 0, 2: 0, 3: 25 },
    horseArcher: { 1: 0, 2: 0, 3: 25 },
  },
  rules: { respawnEnabled: false, includeCamps: false },
}

export function getDefaultBattleConfig(): BattleConfig {
  const config: BattleConfig = JSON.parse(JSON.stringify(PRESET_10V10))
  config.playerFaction = 'viking'
  config.playerLoadout = createDefaultPlayerLoadout()
  return config
}
