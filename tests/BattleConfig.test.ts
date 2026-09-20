import { describe, it, expect } from 'vitest'
import { AIType } from '../src/world/NPC'
import {
  calculateArmyTotal,
  validateBattleConfig,
  getUnitCombatProfile,
  createEmptyArmyConfig,
  createEmptyBattleConfig,
  MAX_CUSTOM_ARMY_SIZE,
  MAX_BENCHMARK_ARMY_SIZE,
  validateBenchmarkBattleConfig,
  PRESET_10V10,
  PRESET_25V25,
  PRESET_50V50,
  PRESET_100V100,
  PRESET_200V200,
  PRESET_SCENARIO_A,
  PRESET_SCENARIO_B,
  PRESET_SCENARIO_C,
  PRESET_SCENARIO_D,
  PRESET_DEVCOMBAT,
  PRESET_SCENARIO_G,
  PRESET_SCENARIO_H,
  PRESET_SCENARIO_I,
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

  it('validates Custom Battle army counts strictly within 1 to 200 bounds', () => {
    expect(MAX_CUSTOM_ARMY_SIZE).toBe(200)
    expect(MAX_BENCHMARK_ARMY_SIZE).toBe(200)

    const valid200v200: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), infantry: { 1: 200, 2: 0, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 200, 2: 0, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    expect(validateBattleConfig(valid200v200).valid).toBe(true)
    expect(validateBattleConfig({
      ...valid200v200,
      viking: { ...createEmptyArmyConfig(), infantry: { 1: 1, 2: 0, 3: 0 } },
    }).valid).toBe(true)
    expect(validateBattleConfig({
      ...valid200v200,
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 1, 2: 0, 3: 0 } },
    }).valid).toBe(true)

    const overViking: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), infantry: { 1: 201, 2: 0, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 200, 2: 0, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    expect(validateBattleConfig(overViking).valid).toBe(false)
    expect(validateBattleConfig({
      ...overViking,
      viking: { ...createEmptyArmyConfig(), infantry: { 1: 200, 2: 0, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 201, 2: 0, 3: 0 } },
    }).valid).toBe(false)
    expect(validateBattleConfig({
      ...overViking,
      viking: { ...createEmptyArmyConfig(), infantry: { 1: 200, 2: 1, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 200, 2: 0, 3: 0 } },
    }).valid).toBe(false)

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
    const t1Inf = getUnitCombatProfile('viking', 'infantry', 1)
    expect(t1Inf.aiType).toBe(AIType.MELEE)
    expect(t1Inf.cavalry).toBe(false)
    expect(t1Inf.meleeWeaponId).toBe('rusty_dagger')
    expect(t1Inf.finalMeleeDamage).toBe(12)

    const t2Inf = getUnitCombatProfile('viking', 'infantry', 2)
    expect(t2Inf.meleeWeaponId).toBe('steel_sword')
    expect(t2Inf.finalMeleeDamage).toBe(25)

    const t3Inf = getUnitCombatProfile('viking', 'infantry', 3)
    expect(t3Inf.meleeWeaponId).toBe('runic_greatsword')
    expect(t3Inf.finalMeleeDamage).toBe(45)

    const t1Bow = getUnitCombatProfile('viking', 'archer', 1)
    expect(t1Bow.aiType).toBe(AIType.RANGED)
    expect(t1Bow.rangedWeaponId).toBe('wooden_shortbow')
    expect(t1Bow.rangedDamage).toBe(22)

    const t2Bow = getUnitCombatProfile('viking', 'archer', 2)
    expect(t2Bow.rangedWeaponId).toBe('recurve_longbow')
    expect(t2Bow.rangedDamage).toBe(42)

    const t3Bow = getUnitCombatProfile('viking', 'archer', 3)
    expect(t3Bow.rangedWeaponId).toBe('elven_runebow')
    expect(t3Bow.rangedDamage).toBe(75)
  })

  it('maps Roman Tier weapons and authoritative damage consistently', () => {
    const t1Inf = getUnitCombatProfile('roman', 'infantry', 1)
    expect(t1Inf.meleeWeaponId).toBe('gladius_rusty')
    expect(t1Inf.finalMeleeDamage).toBe(12)

    const t2Inf = getUnitCombatProfile('roman', 'infantry', 2)
    expect(t2Inf.meleeWeaponId).toBe('gladius_standard')
    expect(t2Inf.finalMeleeDamage).toBe(25)

    const t3Inf = getUnitCombatProfile('roman', 'infantry', 3)
    expect(t3Inf.meleeWeaponId).toBe('centurion_blade')
    expect(t3Inf.finalMeleeDamage).toBe(45)

    const t1Pilum = getUnitCombatProfile('roman', 'archer', 1)
    expect(t1Pilum.aiType).toBe(AIType.RANGED)
    expect(t1Pilum.rangedWeaponId).toBe('pilum_basic')
    expect(t1Pilum.rangedDamage).toBe(22)

    const t2Pilum = getUnitCombatProfile('roman', 'archer', 2)
    expect(t2Pilum.rangedWeaponId).toBe('pilum_standard')
    expect(t2Pilum.rangedDamage).toBe(42)

    const t3Pilum = getUnitCombatProfile('roman', 'archer', 3)
    expect(t3Pilum.rangedWeaponId).toBe('legionary_pilum')
    expect(t3Pilum.rangedDamage).toBe(75)
  })

  it('verifies Cavalry lance T1-T3 tier base damage (30/45/60) without 1.5x multiplier', () => {
    const t1Cav = getUnitCombatProfile('viking', 'cavalry', 1)
    expect(t1Cav.cavalry).toBe(true)
    expect(t1Cav.isUsingLance).toBe(true)
    expect(t1Cav.meleeWeaponId).toBe('hunting_spear')
    expect(t1Cav.baseMeleeDamage).toBe(30)
    expect(t1Cav.finalMeleeDamage).toBe(30) // Base weapon damage, no 1.5x

    const t2Cav = getUnitCombatProfile('viking', 'cavalry', 2)
    expect(t2Cav.meleeWeaponId).toBe('steel_lance')
    expect(t2Cav.baseMeleeDamage).toBe(45)
    expect(t2Cav.finalMeleeDamage).toBe(45) // Base weapon damage, no 1.5x

    const t3Cav = getUnitCombatProfile('viking', 'cavalry', 3)
    expect(t3Cav.meleeWeaponId).toBe('heavy_lance')
    expect(t3Cav.baseMeleeDamage).toBe(60)
    expect(t3Cav.finalMeleeDamage).toBe(60) // Base weapon damage, no 1.5x

    // Roman side identical scaling
    const t3RomanCav = getUnitCombatProfile('roman', 'cavalry', 3)
    expect(t3RomanCav.meleeWeaponId).toBe('heavy_lance')
    expect(t3RomanCav.finalMeleeDamage).toBe(60)
  })

  it('verifies Horse Archer mapping is RANGED + cavalry', () => {
    const vHorseArcher = getUnitCombatProfile('viking', 'horseArcher', 3)
    expect(vHorseArcher.aiType).toBe(AIType.RANGED)
    expect(vHorseArcher.cavalry).toBe(true)
    expect(vHorseArcher.isUsingLance).toBe(false)
    expect(vHorseArcher.rangedWeaponId).toBe('elven_runebow')

    const rHorseArcher = getUnitCombatProfile('roman', 'horseArcher', 3)
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

    expect(validateBattleConfig(PRESET_200V200).valid).toBe(true)
    expect(calculateArmyTotal(PRESET_200V200.viking)).toBe(200)
    expect(calculateArmyTotal(PRESET_200V200.roman)).toBe(200)
    expect(PRESET_200V200.rules).toEqual({ respawnEnabled: false, includeCamps: true })
    expect(PRESET_200V200.spectator).toBeUndefined()
    for (const army of [PRESET_200V200.viking, PRESET_200V200.roman]) {
      expect(army.infantry[1] + army.infantry[2] + army.infantry[3]).toBe(60)
      expect(army.archer[1] + army.archer[2] + army.archer[3]).toBe(60)
      expect(army.cavalry[1] + army.cavalry[2] + army.cavalry[3]).toBe(40)
      expect(army.horseArcher[1] + army.horseArcher[2] + army.horseArcher[3]).toBe(40)
    }

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

    // 200v200 DEV presets use an explicit benchmark validator while production now also permits 200/side.
    for (const preset of [PRESET_SCENARIO_G, PRESET_SCENARIO_H, PRESET_SCENARIO_I]) {
      expect(validateBattleConfig(preset).valid).toBe(true)
      expect(validateBenchmarkBattleConfig(preset).valid).toBe(true)
      expect(calculateArmyTotal(preset.viking)).toBe(200)
      expect(calculateArmyTotal(preset.roman)).toBe(200)
    }
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

  it('validates battle mode correctly and maintains backward compatibility', () => {
    const baseConfig: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), infantry: { 1: 5, 2: 0, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 5, 2: 0, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }

    // Explicit formation mode is valid
    expect(validateBattleConfig({ ...baseConfig, mode: 'formation' }).valid).toBe(true)

    // Explicit scattered mode is valid
    expect(validateBattleConfig({ ...baseConfig, mode: 'scattered' }).valid).toBe(true)

    // Missing / undefined mode is valid (backward compatibility for old configs / sessionStorage)
    const withoutMode = { ...baseConfig }
    delete withoutMode.mode
    expect(validateBattleConfig(withoutMode).valid).toBe(true)

    // Invalid string mode is rejected
    const invalidMode = { ...baseConfig, mode: 'free-for-all' }
    const resInvalid = validateBattleConfig(invalidMode)
    expect(resInvalid.valid).toBe(false)
    expect(resInvalid.errors.some(e => e.includes('Invalid battle mode'))).toBe(true)

    // Invalid non-string mode is rejected
    const numberMode = { ...baseConfig, mode: 123 }
    const resNumber = validateBattleConfig(numberMode)
    expect(resNumber.valid).toBe(false)
    expect(resNumber.errors.some(e => e.includes('Invalid battle mode'))).toBe(true)

    // Default configs and presets default to formation mode
    expect(createEmptyBattleConfig().mode).toBe('formation')
    expect(PRESET_10V10.mode).toBe('formation')
    expect(PRESET_25V25.mode).toBe('formation')
    expect(PRESET_50V50.mode).toBe('formation')
    expect(PRESET_100V100.mode).toBe('formation')
    expect(PRESET_200V200.mode).toBe('formation')
  })
})
