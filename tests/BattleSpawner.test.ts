import { describe, it, expect } from 'vitest'
import { Faction, AIType } from '../src/world/NPC'
import {
  BattleSpawner,
  BattleSpawnPlan,
  BATTLE_FRONTLINE_Z,
  CAMP_HORSE_Z,
  CAMP_PICKUP_Z,
  VIKING_PLAYER_SPAWN,
  PLAYER_SAFE_CLEARANCE,
  SCATTER_TREE_EXCLUSION_RADIUS,
} from '../src/battle/BattleSpawner'
import { TERRAIN_TREE_POSITIONS } from '../src/world/Terrain'
import {
  BattleConfig,
  createEmptyArmyConfig,
  PRESET_10V10,
  PRESET_25V25,
  PRESET_50V50,
  PRESET_100V100,
  PRESET_DEVCOMBAT,
} from '../src/battle/BattleConfig'

function verifyPlanInvariants(plan: BattleSpawnPlan): void {
  // 1. Staging-band validation: armies start near the outer map region but stay in front of camps.
  for (const spec of plan.npcSpecs) {
    expect(Math.abs(spec.x)).toBeLessThanOrEqual(190)
    const absZ = Math.abs(spec.z)
    expect(absZ).toBeGreaterThanOrEqual(BATTLE_FRONTLINE_Z - 1)
    expect(absZ).toBeLessThan(CAMP_PICKUP_Z)

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
        if (dist < minObservedDist) minObservedDist = dist
        // No two units can spawn at duplicate coordinates or collide (min 2.0m spacing)
        expect(dist).toBeGreaterThanOrEqual(2.0)
      }
    }
  }
}

let minObservedDist = Infinity

describe('BattleSpawner Deterministic Formation', () => {
  it('places the player and camps behind the outer army staging band', () => {
    expect(VIKING_PLAYER_SPAWN.z).toBeGreaterThan(BATTLE_FRONTLINE_Z)
    expect(CAMP_PICKUP_Z).toBeGreaterThan(VIKING_PLAYER_SPAWN.z)
    expect(CAMP_HORSE_Z).toBeGreaterThan(CAMP_PICKUP_Z)
    expect(CAMP_HORSE_Z).toBeLessThan(180)
  })

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

  it('generates non-overlapping coordinates in bounds for PRESET_100V100', () => {
    const plan = BattleSpawner.createSpawnPlan(PRESET_100V100)
    expect(plan.npcSpecs.length).toBe(200)
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

  it('handles Extreme Composition: 100 Infantry per side within X/Z bounds', () => {
    const config: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), infantry: { 1: 100, 2: 0, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), infantry: { 1: 100, 2: 0, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    const plan = BattleSpawner.createSpawnPlan(config)
    expect(plan.npcSpecs.length).toBe(200)
    verifyPlanInvariants(plan)
  })

  it('handles Extreme Composition: 100 Archer per side within X/Z bounds', () => {
    const config: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), archer: { 1: 0, 2: 100, 3: 0 } },
      roman: { ...createEmptyArmyConfig(), archer: { 1: 0, 2: 100, 3: 0 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    const plan = BattleSpawner.createSpawnPlan(config)
    expect(plan.npcSpecs.length).toBe(200)
    verifyPlanInvariants(plan)
  })

  it('handles Extreme Composition: 100 Cavalry per side within bounded wings', () => {
    const config: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), cavalry: { 1: 0, 2: 0, 3: 100 } },
      roman: { ...createEmptyArmyConfig(), cavalry: { 1: 0, 2: 0, 3: 100 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    const plan = BattleSpawner.createSpawnPlan(config)
    expect(plan.npcSpecs.length).toBe(200)
    verifyPlanInvariants(plan)
  })

  it('handles Extreme Composition: 100 Horse Archer per side within bounded wings', () => {
    const config: BattleConfig = {
      viking: { ...createEmptyArmyConfig(), horseArcher: { 1: 0, 2: 0, 3: 100 } },
      roman: { ...createEmptyArmyConfig(), horseArcher: { 1: 0, 2: 0, 3: 100 } },
      rules: { respawnEnabled: false, includeCamps: true },
    }
    const plan = BattleSpawner.createSpawnPlan(config)
    expect(plan.npcSpecs.length).toBe(200)
    verifyPlanInvariants(plan)
  })

  it('positions Camp Pickups and Camp Horses cleanly behind staging area', () => {
    const plan = BattleSpawner.createSpawnPlan(PRESET_10V10)

    const vikingPickups = plan.pickupSpecs.filter(p => p.z > 0)
    const romanPickups = plan.pickupSpecs.filter(p => p.z < 0)
    expect(vikingPickups.every(p => p.z === CAMP_PICKUP_Z)).toBe(true)
    expect(romanPickups.every(p => p.z === -CAMP_PICKUP_Z)).toBe(true)

    const vikingHorses = plan.horseSpecs.filter(h => h.z > 0)
    const romanHorses = plan.horseSpecs.filter(h => h.z < 0)
    expect(vikingHorses.length).toBe(5)
    expect(romanHorses.length).toBe(5)
    expect(vikingHorses.every(h => h.z === CAMP_HORSE_Z)).toBe(true)
    expect(romanHorses.every(h => h.z === -CAMP_HORSE_Z)).toBe(true)
  })

  it('ensures all Viking NPC spawn positions maintain safe clearance from Player spawn in 100v100 and 100 Infantry', () => {
    const configs = [
      PRESET_100V100,
      {
        viking: { ...createEmptyArmyConfig(), infantry: { 1: 100, 2: 0, 3: 0 } },
        roman: { ...createEmptyArmyConfig(), infantry: { 1: 100, 2: 0, 3: 0 } },
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

  it('reports minimum observed friendly spawn distance', () => {
    console.log(`[SPAWN METRICS] Global minimum friendly spawn distance: ${minObservedDist.toFixed(4)}m`)
    expect(minObservedDist).toBeGreaterThanOrEqual(2.0)
  })

  it('assigns playerSpawn to VIKING_PLAYER_SPAWN in formation mode', () => {
    const plan = BattleSpawner.createSpawnPlan(PRESET_10V10)
    expect(plan.playerSpawn).toEqual({ x: VIKING_PLAYER_SPAWN.x, z: VIKING_PLAYER_SPAWN.z })
  })
})

describe('BattleSpawner Deterministic Scattered Battle', () => {
  it('generates exact actor counts: 10v10 (20 NPCs + 1 player) and 100v100 (200 NPCs + 1 player)', () => {
    const scattered10: BattleConfig = { ...PRESET_10V10, mode: 'scattered' }
    const plan10 = BattleSpawner.createSpawnPlan(scattered10)
    expect(plan10.npcSpecs.length).toBe(20)
    expect(plan10.npcSpecs.filter(n => n.faction === Faction.PLAYER).length).toBe(10)
    expect(plan10.npcSpecs.filter(n => n.faction === Faction.ENEMY).length).toBe(10)
    expect(plan10.playerSpawn).toBeDefined()

    const scattered100: BattleConfig = { ...PRESET_100V100, mode: 'scattered' }
    const plan100 = BattleSpawner.createSpawnPlan(scattered100)
    expect(plan100.npcSpecs.length).toBe(200)
    expect(plan100.npcSpecs.filter(n => n.faction === Faction.PLAYER).length).toBe(100)
    expect(plan100.npcSpecs.filter(n => n.faction === Faction.ENEMY).length).toBe(100)
    expect(plan100.playerSpawn).toBeDefined()

    // Composition match
    const vInfantry = plan100.npcSpecs.filter(n => n.faction === Faction.PLAYER && n.aiType === AIType.MELEE && !n.cavalry)
    expect(vInfantry.length).toBe(30) // T1:10 + T2:10 + T3:10
    const vArcher = plan100.npcSpecs.filter(n => n.faction === Faction.PLAYER && n.aiType === AIType.RANGED && !n.cavalry)
    expect(vArcher.length).toBe(30)
    const vCavalry = plan100.npcSpecs.filter(n => n.faction === Faction.PLAYER && n.aiType === AIType.MELEE && n.cavalry)
    expect(vCavalry.length).toBe(20)
    const vHorseArcher = plan100.npcSpecs.filter(n => n.faction === Faction.PLAYER && n.aiType === AIType.RANGED && n.cavalry)
    expect(vHorseArcher.length).toBe(20)
  })

  it('keeps all Scattered NPC and Player spawns strictly within bounds [-140, 140]', () => {
    const scatteredConfigs = [
      { ...PRESET_10V10, mode: 'scattered' as const },
      { ...PRESET_50V50, mode: 'scattered' as const },
      { ...PRESET_100V100, mode: 'scattered' as const },
    ]

    for (const config of scatteredConfigs) {
      const plan = BattleSpawner.createSpawnPlan(config)
      expect(plan.playerSpawn.x).toBeGreaterThanOrEqual(-140)
      expect(plan.playerSpawn.x).toBeLessThanOrEqual(140)
      expect(plan.playerSpawn.z).toBeGreaterThanOrEqual(-140)
      expect(plan.playerSpawn.z).toBeLessThanOrEqual(140)

      for (const npc of plan.npcSpecs) {
        expect(npc.x).toBeGreaterThanOrEqual(-140)
        expect(npc.x).toBeLessThanOrEqual(140)
        expect(npc.z).toBeGreaterThanOrEqual(-140)
        expect(npc.z).toBeLessThanOrEqual(140)
      }
    }
  })

  it('ensures no actor spawns inside tree obstacles', () => {
    const plan = BattleSpawner.createSpawnPlan({ ...PRESET_100V100, mode: 'scattered' })
    const allActors = [{ x: plan.playerSpawn.x, z: plan.playerSpawn.z }, ...plan.npcSpecs]

    for (const actor of allActors) {
      for (const [tx, tz] of TERRAIN_TREE_POSITIONS) {
        const dist = Math.hypot(actor.x - tx, actor.z - tz)
        expect(dist).toBeGreaterThanOrEqual(SCATTER_TREE_EXCLUSION_RADIUS)
      }
    }
  })

  it('guarantees global NPC spacing >= 2.0m across all NPC pairs (including cross-faction)', () => {
    const plan = BattleSpawner.createSpawnPlan({ ...PRESET_100V100, mode: 'scattered' })
    const npcs = plan.npcSpecs

    for (let i = 0; i < npcs.length; i++) {
      for (let j = i + 1; j < npcs.length; j++) {
        const dist = Math.hypot(npcs[i].x - npcs[j].x, npcs[i].z - npcs[j].z)
        expect(dist).toBeGreaterThanOrEqual(2.0)
      }
    }
  })

  it('guarantees Player clearance >= 5.0m from every NPC', () => {
    const configs = [
      { ...PRESET_10V10, mode: 'scattered' as const },
      { ...PRESET_50V50, mode: 'scattered' as const },
      { ...PRESET_100V100, mode: 'scattered' as const },
    ]

    for (const config of configs) {
      const plan = BattleSpawner.createSpawnPlan(config)
      const p = plan.playerSpawn

      for (const npc of plan.npcSpecs) {
        const dist = Math.hypot(p.x - npc.x, p.z - npc.z)
        expect(dist).toBeGreaterThanOrEqual(5.0)
      }
    }
  })

  it('places Player at a scattered location distinct from formation VIKING_PLAYER_SPAWN', () => {
    const plan = BattleSpawner.createSpawnPlan({ ...PRESET_10V10, mode: 'scattered' })
    const isFormationSpawn = plan.playerSpawn.x === VIKING_PLAYER_SPAWN.x && plan.playerSpawn.z === VIKING_PLAYER_SPAWN.z
    expect(isFormationSpawn).toBe(false)
  })

  it('is strictly deterministic: identical configs yield identical plans including playerSpawn and npcSpecs', () => {
    const config: BattleConfig = { ...PRESET_100V100, mode: 'scattered' }
    const planA = BattleSpawner.createSpawnPlan(config)
    const planB = BattleSpawner.createSpawnPlan(config)

    expect(planA).toEqual(planB)
    expect(planA.playerSpawn).toEqual(planB.playerSpawn)
    expect(planA.npcSpecs).toEqual(planB.npcSpecs)
  })

  it('produces true mixed distribution without faction clustering', () => {
    const plan = BattleSpawner.createSpawnPlan({ ...PRESET_50V50, mode: 'scattered' })

    const viking = plan.npcSpecs.filter(n => n.faction === Faction.PLAYER)
    const roman = plan.npcSpecs.filter(n => n.faction === Faction.ENEMY)

    // Both factions must have units in +Z and -Z
    const vikingZPos = viking.filter(v => v.z > 0).length
    const vikingZNeg = viking.filter(v => v.z < 0).length
    const romanZPos = roman.filter(r => r.z > 0).length
    const romanZNeg = roman.filter(r => r.z < 0).length

    expect(vikingZPos).toBeGreaterThan(5)
    expect(vikingZNeg).toBeGreaterThan(5)
    expect(romanZPos).toBeGreaterThan(5)
    expect(romanZNeg).toBeGreaterThan(5)

    // Both factions must cross multiple quadrants
    const countQuadrants = (units: typeof viking) => {
      const q = [0, 0, 0, 0] // ++, -+, --, +-
      for (const u of units) {
        if (u.x >= 0 && u.z >= 0) q[0]++
        else if (u.x < 0 && u.z >= 0) q[1]++
        else if (u.x < 0 && u.z < 0) q[2]++
        else q[3]++
      }
      return q
    }

    const vQ = countQuadrants(viking)
    const rQ = countQuadrants(roman)

    // All 4 quadrants must have units of each faction in a 50v50
    for (let i = 0; i < 4; i++) {
      expect(vQ[i]).toBeGreaterThan(0)
      expect(rQ[i]).toBeGreaterThan(0)
    }
  })

  it('retains camps and spare horses when includeCamps is true in scattered mode', () => {
    const plan = BattleSpawner.createSpawnPlan({ ...PRESET_10V10, mode: 'scattered' })
    expect(plan.pickupSpecs.length).toBeGreaterThanOrEqual(20)
    expect(plan.horseSpecs.length).toBe(10)
    expect(plan.pickupSpecs.some(p => p.z === CAMP_PICKUP_Z)).toBe(true)
    expect(plan.pickupSpecs.some(p => p.z === -CAMP_PICKUP_Z)).toBe(true)
  })
})
