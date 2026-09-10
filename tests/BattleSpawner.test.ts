import { describe, it, expect } from 'vitest'
import { Faction, AIType } from '../src/world/NPC'
import { BattleSpawner, BattleSpawnPlan, VIKING_PLAYER_SPAWN, PLAYER_SAFE_CLEARANCE } from '../src/battle/BattleSpawner'
import {
  BattleConfig,
  createEmptyArmyConfig,
  PRESET_10V10,
  PRESET_25V25,
  PRESET_50V50,
  PRESET_DEVCOMBAT,
} from '../src/battle/BattleConfig'

function verifyPlanInvariants(plan: BattleSpawnPlan): void {
  // 1. Dual-axis bounds validation
  for (const spec of plan.npcSpecs) {
    expect(Math.abs(spec.x)).toBeLessThanOrEqual(35)
    const absZ = Math.abs(spec.z)
    expect(absZ).toBeGreaterThanOrEqual(68)
    expect(absZ).toBeLessThanOrEqual(82)

    // Ensure staging area never invades camp area (|Z| >= 83)
    expect(absZ).toBeLessThan(84)

    // Directional sign check
    if (spec.faction === Faction.PLAYER) {
      expect(spec.z).toBeGreaterThan(0)
    } else {
      expect(spec.z).toBeLessThan(0)
    }

    // Respawn disabled
    expect(spec.respawnEnabled).toBe(false)
  }

  // 2. Strict non-overlapping distance check within each faction
  for (const faction of [Faction.PLAYER, Faction.ENEMY]) {
    const factionUnits = plan.npcSpecs.filter(u => u.faction === faction)
    for (let i = 0; i < factionUnits.length; i++) {
      for (let j = i + 1; j < factionUnits.length; j++) {
        const u1 = factionUnits[i]
        const u2 = factionUnits[j]
        const dx = u1.x - u2.x
        const dz = u1.z - u2.z
        const dist = Math.hypot(dx, dz)
        // No two units can spawn at duplicate coordinates or collide (min 2.0m spacing)
        expect(dist).toBeGreaterThanOrEqual(2.0)
      }
    }
  }
}

describe('BattleSpawner Deterministic Formation', () => {
  it('generates non-overlapping coordinates in bounds for PRESET_10V10', () => {
    const plan = BattleSpawner.createSpawnPlan(PRESET_10V10)
    expect(plan.npcSpecs.length).toBe(20)
    verifyPlanInvariants(plan)

    // Camps are included in 10v10
    expect(plan.pickupSpecs.length).toBeGreaterThanOrEqual(20)
    expect(plan.horseSpecs.length).toBe(10) // 5 per side
  })

  it('generates non-overlapping coordinates in bounds for PRESET_25V25', () => {
    const plan = BattleSpawner.createSpawnPlan(PRESET_25V25)
    expect(plan.npcSpecs.length).toBe(50)
    verifyPlanInvariants(plan)
  })

  it('generates non-overlapping coordinates in bounds for PRESET_50V50', () => {
    const plan = BattleSpawner.createSpawnPlan(PRESET_50V50)
    expect(plan.npcSpecs.length).toBe(100)
    verifyPlanInvariants(plan)
  })

  it('generates clean devcombat performance scenario without camps or spare horses', () => {
    const plan = BattleSpawner.createSpawnPlan(PRESET_DEVCOMBAT)
    expect(plan.npcSpecs.length).toBe(100)
    verifyPlanInvariants(plan)

    // Devcombat must NOT spawn camps or spare horses
    expect(plan.pickupSpecs.length).toBe(0)
    expect(plan.horseSpecs.length).toBe(0)

    // All units must be cavalry/mounted
    expect(plan.npcSpecs.every(s => s.cavalry)).toBe(true)
  })

  it('handles Extreme Composition: 50 Infantry per side within X/Z bounds', () => {
    const config: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), infantry: { 1: 50, 2: 0, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 50, 2: 0, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    const plan = BattleSpawner.createSpawnPlan(config)
    expect(plan.npcSpecs.length).toBe(100)
    verifyPlanInvariants(plan)
  })

  it('handles Extreme Composition: 50 Archer per side within X/Z bounds', () => {
    const config: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), archer: { 1: 0, 2: 50, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), archer: { 1: 0, 2: 50, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    const plan = BattleSpawner.createSpawnPlan(config)
    expect(plan.npcSpecs.length).toBe(100)
    verifyPlanInvariants(plan)
  })

  it('handles Extreme Composition: 50 Cavalry per side within bounded wings', () => {
    const config: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), cavalry: { 1: 0, 2: 0, 3: 50 } },
      roman: { ...createEmptyArmyConfig(), cavalry: { 1: 0, 2: 0, 3: 50 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    const plan = BattleSpawner.createSpawnPlan(config)
    expect(plan.npcSpecs.length).toBe(100)
    verifyPlanInvariants(plan)
  })

  it('handles Extreme Composition: 50 Horse Archer per side within bounded wings', () => {
    const config: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), horseArcher: { 1: 0, 2: 0, 3: 50 } },
      roman: { ...createEmptyArmyConfig(), horseArcher: { 1: 0, 2: 0, 3: 50 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    const plan = BattleSpawner.createSpawnPlan(config)
    expect(plan.npcSpecs.length).toBe(100)
    verifyPlanInvariants(plan)
  })

  it('positions Camp Pickups and Camp Horses cleanly behind staging area', () => {
    const plan = BattleSpawner.createSpawnPlan(PRESET_10V10)

    const vikingPickups = plan.pickupSpecs.filter(p => p.z > 0)
    const romanPickups = plan.pickupSpecs.filter(p => p.z < 0)
    expect(vikingPickups.every(p => p.z === 84)).toBe(true)
    expect(romanPickups.every(p => p.z === -84)).toBe(true)

    const vikingHorses = plan.horseSpecs.filter(h => h.z > 0)
    const romanHorses = plan.horseSpecs.filter(h => h.z < 0)
    expect(vikingHorses.length).toBe(5)
    expect(romanHorses.length).toBe(5)
    expect(vikingHorses.every(h => h.z === 88)).toBe(true)
    expect(romanHorses.every(h => h.z === -88)).toBe(true)
  })

  it('ensures all Viking NPC spawn positions maintain safe clearance from Player spawn in 50v50 and 50 Infantry', () => {
    const configs = [
      PRESET_50V50,
      {
        viking: { ...createEmptyArmyConfig(), infantry: { 1: 50, 2: 0, 3: 0 } },
        roman: { ...createEmptyArmyConfig(), infantry: { 1: 50, 2: 0, 3: 0 } },
        rules: { respawnEnabled: false, includeCamps: true },
      },
    ]

    for (const config of configs) {
      const plan = BattleSpawner.createSpawnPlan(config)
      const vikingUnits = plan.npcSpecs.filter(s => s.faction === Faction.PLAYER)

      for (const unit of vikingUnits) {
        const dist = Math.hypot(unit.x - VIKING_PLAYER_SPAWN.x, unit.z - VIKING_PLAYER_SPAWN.z)
        expect(dist).toBeGreaterThanOrEqual(PLAYER_SAFE_CLEARANCE)
      }
    }
  })
})
