import { describe, expect, it } from 'vitest'
import { AIType, Faction } from '../src/world/NPC'
import {
  PRESET_SCENARIO_G,
  PRESET_SCENARIO_H,
  PRESET_SCENARIO_I,
  calculateArmyTotal,
  validateBenchmarkBattleConfig,
} from '../src/battle/BattleConfig'
import {
  BattleSpawner,
  PLAYER_SAFE_CLEARANCE,
  PLAYER_SCATTERED_CLEARANCE,
  SCATTER_BOUND_MAX,
  SCATTER_BOUND_MIN,
  SCATTER_TREE_EXCLUSION_RADIUS,
  VIKING_PLAYER_SPAWN,
} from '../src/battle/BattleSpawner'
import { PLAYABLE_WORLD_BOUND, TERRAIN_TREE_POSITIONS } from '../src/world/Terrain'

const armyCount = (army: typeof PRESET_SCENARIO_G.viking, type: keyof typeof army): number =>
  army[type][1] + army[type][2] + army[type][3]

function expectFiniteAndInPlayableBounds(plan: ReturnType<typeof BattleSpawner.createSpawnPlan>): void {
  for (const actor of [plan.playerSpawn, ...plan.npcSpecs]) {
    expect(Number.isFinite(actor.x)).toBe(true)
    expect(Number.isFinite(actor.z)).toBe(true)
    expect(Math.abs(actor.x)).toBeLessThanOrEqual(PLAYABLE_WORLD_BOUND)
    expect(Math.abs(actor.z)).toBeLessThanOrEqual(PLAYABLE_WORLD_BOUND)
  }
}

function expectFriendlySpacing(plan: ReturnType<typeof BattleSpawner.createSpawnPlan>): void {
  for (const faction of [Faction.PLAYER, Faction.ENEMY]) {
    const units = plan.npcSpecs.filter((spec) => spec.faction === faction)
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        expect(Math.hypot(units[i].x - units[j].x, units[i].z - units[j].z)).toBeGreaterThanOrEqual(2)
      }
    }
  }
}

describe('Scenario G/H/I: 200v200 DEV benchmark presets', () => {
  it('defines Scenario G as symmetric 200v200 infantry formation without horses', () => {
    expect(validateBenchmarkBattleConfig(PRESET_SCENARIO_G).valid).toBe(true)
    expect(PRESET_SCENARIO_G.mode).toBe('formation')
    expect(PRESET_SCENARIO_G.spectator).toBe(true)
    for (const army of [PRESET_SCENARIO_G.viking, PRESET_SCENARIO_G.roman]) {
      expect(calculateArmyTotal(army)).toBe(200)
      expect(armyCount(army, 'infantry')).toBe(200)
      expect(armyCount(army, 'archer')).toBe(0)
      expect(armyCount(army, 'cavalry')).toBe(0)
      expect(armyCount(army, 'horseArcher')).toBe(0)
      expect(army.infantry).toEqual({ 1: 80, 2: 80, 3: 40 })
    }
  })

  it('defines Scenario H as symmetric 200v200 mixed formation with 160 horses', () => {
    expect(validateBenchmarkBattleConfig(PRESET_SCENARIO_H).valid).toBe(true)
    expect(PRESET_SCENARIO_H.mode).toBe('formation')
    expect(PRESET_SCENARIO_H.spectator).toBe(true)
    expect(PRESET_SCENARIO_H.rules).toEqual({ respawnEnabled: false, includeCamps: false })
    for (const army of [PRESET_SCENARIO_H.viking, PRESET_SCENARIO_H.roman]) {
      expect(calculateArmyTotal(army)).toBe(200)
      expect(armyCount(army, 'infantry')).toBe(60)
      expect(armyCount(army, 'archer')).toBe(60)
      expect(armyCount(army, 'cavalry')).toBe(40)
      expect(armyCount(army, 'horseArcher')).toBe(40)
    }
  })

  it('defines Scenario I as symmetric scattered 200v200 mounted stress with 400 horses', () => {
    expect(validateBenchmarkBattleConfig(PRESET_SCENARIO_I).valid).toBe(true)
    expect(PRESET_SCENARIO_I.mode).toBe('scattered')
    expect(PRESET_SCENARIO_I.spectator).toBe(true)
    expect(PRESET_SCENARIO_I.rules).toEqual({ respawnEnabled: false, includeCamps: false })
    for (const army of [PRESET_SCENARIO_I.viking, PRESET_SCENARIO_I.roman]) {
      expect(calculateArmyTotal(army)).toBe(200)
      expect(armyCount(army, 'cavalry')).toBe(100)
      expect(armyCount(army, 'horseArcher')).toBe(100)
    }
  })

  it.each([
    ['G', PRESET_SCENARIO_G],
    ['H', PRESET_SCENARIO_H],
  ] as const)('builds Scenario %s formation plans with 400 finite, bounded and safely spaced NPCs', (_name, config) => {
    const plan = BattleSpawner.createSpawnPlan(config)
    expect(plan.npcSpecs).toHaveLength(400)
    expect(plan.npcSpecs.filter((spec) => spec.characterFaction === 'viking')).toHaveLength(200)
    expect(plan.npcSpecs.filter((spec) => spec.characterFaction === 'roman')).toHaveLength(200)
    expect(plan.pickupSpecs).toHaveLength(0)
    expect(plan.horseSpecs).toHaveLength(0)
    expectFiniteAndInPlayableBounds(plan)
    expectFriendlySpacing(plan)

    for (const unit of plan.npcSpecs.filter((spec) => spec.faction === Faction.PLAYER)) {
      expect(Math.hypot(unit.x - VIKING_PLAYER_SPAWN.x, unit.z - VIKING_PLAYER_SPAWN.z)).toBeGreaterThanOrEqual(PLAYER_SAFE_CLEARANCE)
    }
  })

  it('builds Scenario H with the intended 160 mounted NPCs', () => {
    const plan = BattleSpawner.createSpawnPlan(PRESET_SCENARIO_H)
    expect(plan.npcSpecs.filter((spec) => spec.cavalry)).toHaveLength(160)
    expect(plan.npcSpecs.filter((spec) => spec.aiType === AIType.MELEE && !spec.cavalry)).toHaveLength(120)
    expect(plan.npcSpecs.filter((spec) => spec.aiType === AIType.RANGED && !spec.cavalry)).toHaveLength(120)
  })

  it('builds Scenario I without slot exhaustion and preserves scattered bounds, tree exclusion, player clearance and spacing', () => {
    const plan = BattleSpawner.createSpawnPlan(PRESET_SCENARIO_I)
    expect(plan.npcSpecs).toHaveLength(400)
    expect(plan.npcSpecs.filter((spec) => spec.characterFaction === 'viking')).toHaveLength(200)
    expect(plan.npcSpecs.filter((spec) => spec.characterFaction === 'roman')).toHaveLength(200)
    expect(plan.npcSpecs.filter((spec) => spec.cavalry)).toHaveLength(400)
    expect(plan.npcSpecs.filter((spec) => spec.aiType === AIType.MELEE)).toHaveLength(200)
    expect(plan.npcSpecs.filter((spec) => spec.aiType === AIType.RANGED)).toHaveLength(200)
    expect(plan.pickupSpecs).toHaveLength(0)
    expect(plan.horseSpecs).toHaveLength(0)
    expectFiniteAndInPlayableBounds(plan)

    for (const actor of [plan.playerSpawn, ...plan.npcSpecs]) {
      expect(actor.x).toBeGreaterThanOrEqual(SCATTER_BOUND_MIN)
      expect(actor.x).toBeLessThanOrEqual(SCATTER_BOUND_MAX)
      expect(actor.z).toBeGreaterThanOrEqual(SCATTER_BOUND_MIN)
      expect(actor.z).toBeLessThanOrEqual(SCATTER_BOUND_MAX)
      for (const [treeX, treeZ] of TERRAIN_TREE_POSITIONS) {
        expect(Math.hypot(actor.x - treeX, actor.z - treeZ)).toBeGreaterThanOrEqual(SCATTER_TREE_EXCLUSION_RADIUS)
      }
    }

    for (const npc of plan.npcSpecs) {
      expect(Math.hypot(npc.x - plan.playerSpawn.x, npc.z - plan.playerSpawn.z)).toBeGreaterThanOrEqual(PLAYER_SCATTERED_CLEARANCE)
    }
    expectFriendlySpacing(plan)
  })
})
