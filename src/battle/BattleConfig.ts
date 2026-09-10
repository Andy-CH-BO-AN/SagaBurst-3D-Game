/**
 * BattleConfig.ts
 * Core domain types, validation, presets, and combat mapping rules for Custom Battle.
 */
import { Faction, AIType } from '../world/NPC'
import { WEAPONS } from '../rpg/WeaponDatabase'

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

export interface BattleConfig {
  viking: ArmyConfig
  roman: ArmyConfig
  rules: BattleRules
}

export interface UnitCombatProfile {
  faction: Faction
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
    viking: createEmptyArmyConfig(),
    roman: createEmptyArmyConfig(),
    rules: {
      respawnEnabled: false,
      includeCamps: true,
    },
  }
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

export function validateBattleConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Invalid config object'] }
  }

  const c = config as BattleConfig
  if (!c.viking || !c.roman) {
    return { valid: false, errors: ['Missing viking or roman army configuration'] }
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
        } else if (val > 50) {
          errors.push(`${sideName} ${cat} T${tier} exceeds maximum 50`)
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
  } else if (vikingTotal > 50) {
    errors.push(`Viking army total (${vikingTotal}) exceeds 50`)
  }

  if (romanTotal < 1) {
    errors.push('Roman army must have at least 1 unit')
  } else if (romanTotal > 50) {
    errors.push(`Roman army total (${romanTotal}) exceeds 50`)
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Returns combat profile and authoritative damage calculation for a given unit.
 */
export function getUnitCombatProfile(faction: Faction, unitType: BattleUnitType, tier: UnitTier): UnitCombatProfile {
  const aiType = (unitType === 'archer' || unitType === 'horseArcher') ? AIType.RANGED : AIType.MELEE
  const cavalry = (unitType === 'cavalry' || unitType === 'horseArcher')
  const isUsingLance = cavalry && aiType === AIType.MELEE
  const lanceMultiplier = isUsingLance ? 1.5 : 1.0

  let meleeWeaponId: string
  let rangedWeaponId: string | undefined

  if (isUsingLance) {
    meleeWeaponId = 'steel_lance'
  } else if (faction === Faction.PLAYER) {
    // Viking
    const meleeT = aiType === AIType.RANGED ? 1 : tier
    meleeWeaponId = meleeT === 1 ? 'rusty_dagger' : meleeT === 2 ? 'steel_sword' : 'runic_greatsword'
  } else {
    // Roman
    const meleeT = aiType === AIType.RANGED ? 1 : tier
    meleeWeaponId = meleeT === 1 ? 'gladius_rusty' : meleeT === 2 ? 'gladius_standard' : 'centurion_blade'
  }

  if (aiType === AIType.RANGED) {
    if (faction === Faction.PLAYER) {
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
    faction,
    aiType,
    cavalry,
    meleeWeaponId,
    rangedWeaponId,
    baseMeleeDamage,
    finalMeleeDamage,
    rangedDamage,
    isUsingLance,
    lanceMultiplier,
  }
}

// ── Presets ──

export const PRESET_10V10: BattleConfig = {
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

/** Developer performance scenario (?devcombat): 50v50 cavalry, no camps. */
export const PRESET_DEVCOMBAT: BattleConfig = {
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
  return JSON.parse(JSON.stringify(PRESET_10V10))
}
