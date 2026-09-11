import { describe, it, expect } from 'vitest'
import { Faction, AIType } from '../src/world/NPC'
import {
  calculateArmyTotal,
  validateBattleConfig,
  getUnitCombatProfile,
  createEmptyArmyConfig,
  createEmptyBattleConfig,
  MAX_ARMY_SIZE,
  PRESET_10V10,
  PRESET_25V25,
  PRESET_50V50,
  PRESET_100V100,
  PRESET_SCENARIO_A,
  PRESET_SCENARIO_B,
  PRESET_SCENARIO_C,
  PRESET_SCENARIO_D,
  PRESET_DEVCOMBAT,
  BattleConfig,
} from '../src/battle/BattleConfig'

describe('BattleConfig Domain & Validation', () => {
  it('calculates army total correctly across unit types and tiers', () => {
    const army = createEmptyArmyConfig()
    army.infantry[1] = 5
    army.infantry[2] = 3
    army.archer[2] = 4
    army.cavalry[3] = 2
    army.horseArcher[3] = 1
    expect(calculateArmyTotal(army)).toBe(15)
  })

  it('validates army counts strictly within 1 to 100 bounds', () => {
    expect(MAX_ARMY_SIZE).toBe(100)

    const validConfig: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), infantry: { 1: 100, 2: 0, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 100, 2: 0, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    expect(validateBattleConfig(validConfig).valid).toBe(true)

    // Over 100 rejection (101 units)
    const overConfig: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), infantry: { 1: 101, 2: 0, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 10, 2: 0, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    const overResult = validateBattleConfig(overConfig)
    expect(overResult.valid).toBe(false)
    expect(overResult.errors.some(e => e.includes('exceeds'))).toBe(true)

    // Zero units rejection
    const zeroConfig: BattleConfig = {
      viking: createEmptyArmyConfig(),
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 10, 2: 0, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    const zeroResult = validateBattleConfig(zeroConfig)
    expect(zeroResult.valid).toBe(false)
    expect(zeroResult.errors.some(e => e.includes('at least 1'))).toBe(true)
  })

  it('rejects negative numbers and non-integers', () => {
    const invalidConfig: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), infantry: { 1: -5, 2: 0, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 2.5, 2: 0, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    const result = validateBattleConfig(invalidConfig)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('maps Viking Tier weapons and authoritative damage consistently', () => {
    const t1Inf = getUnitCombatProfile(Faction.PLAYER, 'infantry', 1)
    expect(t1Inf.aiType).toBe(AIType.MELEE)
    expect(t1Inf.cavalry).toBe(false)
    expect(t1Inf.meleeWeaponId).toBe('rusty_dagger')
    expect(t1Inf.finalMeleeDamage).toBe(12)

    const t2Inf = getUnitCombatProfile(Faction.PLAYER, 'infantry', 2)
    expect(t2Inf.meleeWeaponId).toBe('steel_sword')
    expect(t2Inf.finalMeleeDamage).toBe(25)

    const t3Inf = getUnitCombatProfile(Faction.PLAYER, 'infantry', 3)
    expect(t3Inf.meleeWeaponId).toBe('runic_greatsword')
    expect(t3Inf.finalMeleeDamage).toBe(45)

    const t1Bow = getUnitCombatProfile(Faction.PLAYER, 'archer', 1)
    expect(t1Bow.aiType).toBe(AIType.RANGED)
    expect(t1Bow.rangedWeaponId).toBe('wooden_shortbow')
    expect(t1Bow.rangedDamage).toBe(22)

    const t2Bow = getUnitCombatProfile(Faction.PLAYER, 'archer', 2)
    expect(t2Bow.rangedWeaponId).toBe('recurve_longbow')
    expect(t2Bow.rangedDamage).toBe(42)

    const t3Bow = getUnitCombatProfile(Faction.PLAYER, 'archer', 3)
    expect(t3Bow.rangedWeaponId).toBe('elven_runebow')
    expect(t3Bow.rangedDamage).toBe(75)
  })

  it('maps Roman Tier weapons and authoritative damage consistently', () => {
    const t1Inf = getUnitCombatProfile(Faction.ENEMY, 'infantry', 1)
    expect(t1Inf.meleeWeaponId).toBe('gladius_rusty')
    expect(t1Inf.finalMeleeDamage).toBe(12)

    const t2Inf = getUnitCombatProfile(Faction.ENEMY, 'infantry', 2)
    expect(t2Inf.meleeWeaponId).toBe('gladius_standard')
    expect(t2Inf.finalMeleeDamage).toBe(25)

    const t3Inf = getUnitCombatProfile(Faction.ENEMY, 'infantry', 3)
    expect(t3Inf.meleeWeaponId).toBe('centurion_blade')
    expect(t3Inf.finalMeleeDamage).toBe(45)

    const t1Pilum = getUnitCombatProfile(Faction.ENEMY, 'archer', 1)
    expect(t1Pilum.aiType).toBe(AIType.RANGED)
    expect(t1Pilum.rangedWeaponId).toBe('pilum_basic')
    expect(t1Pilum.rangedDamage).toBe(22)

    const t2Pilum = getUnitCombatProfile(Faction.ENEMY, 'archer', 2)
    expect(t2Pilum.rangedWeaponId).toBe('pilum_standard')
    expect(t2Pilum.rangedDamage).toBe(42)

    const t3Pilum = getUnitCombatProfile(Faction.ENEMY, 'archer', 3)
    expect(t3Pilum.rangedWeaponId).toBe('legionary_pilum')
    expect(t3Pilum.rangedDamage).toBe(75)
  })

  it('calculates Cavalry lance 1.5x damage tier scaling accurately', () => {
    const t1Cav = getUnitCombatProfile(Faction.PLAYER, 'cavalry', 1)
    expect(t1Cav.cavalry).toBe(true)
    expect(t1Cav.isUsingLance).toBe(true)
    expect(t1Cav.baseMeleeDamage).toBe(12)
    expect(t1Cav.finalMeleeDamage).toBe(18) // 12 * 1.5

    const t2Cav = getUnitCombatProfile(Faction.PLAYER, 'cavalry', 2)
    expect(t2Cav.baseMeleeDamage).toBe(25)
    expect(t2Cav.finalMeleeDamage).toBe(37.5) // 25 * 1.5

    const t3Cav = getUnitCombatProfile(Faction.PLAYER, 'cavalry', 3)
    expect(t3Cav.baseMeleeDamage).toBe(45)
    expect(t3Cav.finalMeleeDamage).toBe(67.5) // 45 * 1.5

    // Roman side identical scaling
    const t3RomanCav = getUnitCombatProfile(Faction.ENEMY, 'cavalry', 3)
    expect(t3RomanCav.finalMeleeDamage).toBe(67.5)
  })

  it('verifies Horse Archer mapping is RANGED + cavalry', () => {
    const vHorseArcher = getUnitCombatProfile(Faction.PLAYER, 'horseArcher', 3)
    expect(vHorseArcher.aiType).toBe(AIType.RANGED)
    expect(vHorseArcher.cavalry).toBe(true)
    expect(vHorseArcher.isUsingLance).toBe(false)
    expect(vHorseArcher.rangedWeaponId).toBe('elven_runebow')

    const rHorseArcher = getUnitCombatProfile(Faction.ENEMY, 'horseArcher', 3)
    expect(rHorseArcher.aiType).toBe(AIType.RANGED)
    expect(rHorseArcher.cavalry).toBe(true)
    expect(rHorseArcher.isUsingLance).toBe(false)
    expect(rHorseArcher.rangedWeaponId).toBe('legionary_pilum')
  })

  it('validates Presets conformity', () => {
    expect(validateBattleConfig(PRESET_10V10).valid).toBe(true)
    expect(calculateArmyTotal(PRESET_10V10.viking)).toBe(10)
    expect(calculateArmyTotal(PRESET_10V10.roman)).toBe(10)

    expect(validateBattleConfig(PRESET_25V25).valid).toBe(true)
    expect(calculateArmyTotal(PRESET_25V25.viking)).toBe(25)
    expect(calculateArmyTotal(PRESET_25V25.roman)).toBe(25)

    expect(validateBattleConfig(PRESET_50V50).valid).toBe(true)
    expect(calculateArmyTotal(PRESET_50V50.viking)).toBe(50)
    expect(calculateArmyTotal(PRESET_50V50.roman)).toBe(50)

    expect(validateBattleConfig(PRESET_100V100).valid).toBe(true)
    expect(calculateArmyTotal(PRESET_100V100.viking)).toBe(100)
    expect(calculateArmyTotal(PRESET_100V100.roman)).toBe(100)
    expect(PRESET_100V100.rules.includeCamps).toBe(true)

    // Developer Stress Scenarios A-D
    expect(validateBattleConfig(PRESET_SCENARIO_A).valid).toBe(true)
    expect(calculateArmyTotal(PRESET_SCENARIO_A.viking)).toBe(50)
    expect(calculateArmyTotal(PRESET_SCENARIO_A.roman)).toBe(50)

    expect(validateBattleConfig(PRESET_SCENARIO_B).valid).toBe(true)
    expect(calculateArmyTotal(PRESET_SCENARIO_B.viking)).toBe(100)
    expect(calculateArmyTotal(PRESET_SCENARIO_B.roman)).toBe(100)

    expect(validateBattleConfig(PRESET_SCENARIO_C).valid).toBe(true)
    expect(calculateArmyTotal(PRESET_SCENARIO_C.viking)).toBe(100)
    expect(calculateArmyTotal(PRESET_SCENARIO_C.roman)).toBe(100)

    expect(validateBattleConfig(PRESET_SCENARIO_D).valid).toBe(true)
    expect(calculateArmyTotal(PRESET_SCENARIO_D.viking)).toBe(100)
    expect(calculateArmyTotal(PRESET_SCENARIO_D.roman)).toBe(100)

    expect(validateBattleConfig(PRESET_DEVCOMBAT).valid).toBe(true)
    expect(calculateArmyTotal(PRESET_DEVCOMBAT.viking)).toBe(50)
    expect(calculateArmyTotal(PRESET_DEVCOMBAT.roman)).toBe(50)
    expect(PRESET_DEVCOMBAT.rules.includeCamps).toBe(false)
  })

  it('creates an empty 0 vs 0 battle configuration', () => {
    const empty = createEmptyBattleConfig()
    expect(calculateArmyTotal(empty.viking)).toBe(0)
    expect(calculateArmyTotal(empty.roman)).toBe(0)
    const result = validateBattleConfig(empty)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Viking army must have at least 1 unit'))).toBe(true)
    expect(result.errors.some(e => e.includes('Roman army must have at least 1 unit'))).toBe(true)
  })

  it('validates battle rules strictly for existence and boolean types', () => {
    const validConfig: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), infantry: { 1: 5, 2: 0, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 5, 2: 0, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    expect(validateBattleConfig(validConfig).valid).toBe(true)

    // Missing rules entirely (e.g. stale storage format)
    const noRules = {
      viking: validConfig.viking,
      roman: validConfig.roman,
    }
    const noRulesRes = validateBattleConfig(noRules)
    expect(noRulesRes.valid).toBe(false)
    expect(noRulesRes.errors.some(e => e.includes('battle rules'))).toBe(true)

    // Non-boolean respawnEnabled
    const badRespawn = {
      ...validConfig,
      rules: { respawnEnabled: 'yes', includeCamps: true },
    }
    const badRespawnRes = validateBattleConfig(badRespawn)
    expect(badRespawnRes.valid).toBe(false)
    expect(badRespawnRes.errors.some(e => e.includes('respawnEnabled must be a boolean'))).toBe(true)

    // Non-boolean includeCamps
    const badCamps = {
      ...validConfig,
      rules: { respawnEnabled: false, includeCamps: 123 },
    }
    const badCampsRes = validateBattleConfig(badCamps)
    expect(badCampsRes.valid).toBe(false)
    expect(badCampsRes.errors.some(e => e.includes('includeCamps must be a boolean'))).toBe(true)
  })
})
