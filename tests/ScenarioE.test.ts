import { describe, it, expect } from 'vitest'
import {
  PRESET_SCENARIO_E,
  validateBattleConfig,
  getUnitCombatProfile,
} from '../src/battle/BattleConfig'
import {
  BattleSpawner,
  SCATTER_BOUND_MIN,
  SCATTER_BOUND_MAX,
} from '../src/battle/BattleSpawner'
import { shouldCreateStartingHorse } from '../src/Game'
import { AIType } from '../src/world/NPC'

describe('Scenario E: 100v100 All-Melee Cavalry Scattered Battle', () => {
  it('passes BattleConfig validation and conforms to strict 100v100 melee cavalry specifications', () => {
    const validation = validateBattleConfig(PRESET_SCENARIO_E)
    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])

    expect(PRESET_SCENARIO_E.mode).toBe('scattered')
    expect(PRESET_SCENARIO_E.spectator).toBe(true)
    expect(PRESET_SCENARIO_E.rules.respawnEnabled).toBe(false)
    expect(PRESET_SCENARIO_E.rules.includeCamps).toBe(false)

    // Viking army composition
    const v = PRESET_SCENARIO_E.viking
    expect(v.infantry[1] + v.infantry[2] + v.infantry[3]).toBe(0)
    expect(v.archer[1] + v.archer[2] + v.archer[3]).toBe(0)
    expect(v.horseArcher[1] + v.horseArcher[2] + v.horseArcher[3]).toBe(0)
    const vCavalryTotal = v.cavalry[1] + v.cavalry[2] + v.cavalry[3]
    expect(vCavalryTotal).toBe(100)
    expect(v.cavalry[1]).toBe(30)
    expect(v.cavalry[2]).toBe(40)
    expect(v.cavalry[3]).toBe(30)

    // Roman army composition
    const r = PRESET_SCENARIO_E.roman
    expect(r.infantry[1] + r.infantry[2] + r.infantry[3]).toBe(0)
    expect(r.archer[1] + r.archer[2] + r.archer[3]).toBe(0)
    expect(r.horseArcher[1] + r.horseArcher[2] + r.horseArcher[3]).toBe(0)
    const rCavalryTotal = r.cavalry[1] + r.cavalry[2] + r.cavalry[3]
    expect(rCavalryTotal).toBe(100)
    expect(r.cavalry[1]).toBe(30)
    expect(r.cavalry[2]).toBe(40)
    expect(r.cavalry[3]).toBe(30)

    // Verify combat profiles are strictly melee cavalry (lance, no ranged weapon)
    for (const tier of [1, 2, 3] as const) {
      const vProfile = getUnitCombatProfile('viking', 'cavalry', tier)
      expect(vProfile.aiType).toBe(AIType.MELEE)
      expect(vProfile.cavalry).toBe(true)
      expect(vProfile.isUsingLance).toBe(true)
      expect(vProfile.rangedWeaponId).toBeUndefined()

      const rProfile = getUnitCombatProfile('roman', 'cavalry', tier)
      expect(rProfile.aiType).toBe(AIType.MELEE)
      expect(rProfile.cavalry).toBe(true)
      expect(rProfile.isUsingLance).toBe(true)
      expect(rProfile.rangedWeaponId).toBeUndefined()
    }
  })

  it('generates a 200-cavalry deterministic scattered spawn plan without player mount', () => {
    // Player does not get starting horse in spectator mode
    expect(shouldCreateStartingHorse(PRESET_SCENARIO_E)).toBe(false)

    const plan1 = BattleSpawner.createSpawnPlan(PRESET_SCENARIO_E)
    const plan2 = BattleSpawner.createSpawnPlan(PRESET_SCENARIO_E)

    // Exactly 200 NPCs
    expect(plan1.npcSpecs.length).toBe(200)

    // All must be cavalry and melee
    let vikingCount = 0
    let romanCount = 0
    for (const spec of plan1.npcSpecs) {
      expect(spec.cavalry).toBe(true)
      expect(spec.aiType).toBe(AIType.MELEE)
      expect(spec.x).toBeGreaterThanOrEqual(SCATTER_BOUND_MIN)
      expect(spec.x).toBeLessThanOrEqual(SCATTER_BOUND_MAX)
      expect(spec.z).toBeGreaterThanOrEqual(SCATTER_BOUND_MIN)
      expect(spec.z).toBeLessThanOrEqual(SCATTER_BOUND_MAX)
      if (spec.characterFaction === 'viking') vikingCount++
      if (spec.characterFaction === 'roman') romanCount++
    }

    expect(vikingCount).toBe(100)
    expect(romanCount).toBe(100)

    // Deterministic repeatability
    expect(plan1.npcSpecs).toEqual(plan2.npcSpecs)
  })
})
