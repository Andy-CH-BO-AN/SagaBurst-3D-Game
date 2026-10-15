import { describe, expect, it } from 'vitest'
import {
  BattleConfig,
  PRESET_100V100,
  PRESET_10V10
} from '../../src/battle/BattleConfig'
import {
  BattleSpawner
} from '../../src/battle/BattleSpawner'
import { Faction } from '../../src/world/NPC'
import { TERRAIN_TREE_POSITIONS } from '../../src/world/Terrain'

describe('BattleSpawner Deterministic Scattered Battle', () => {

  it('ensures no actor spawns inside tree obstacles', () => {
    const plan = BattleSpawner.createSpawnPlan({ ...PRESET_100V100, mode: 'scattered' })
    const allActors = [{ x: plan.playerSpawn.x, z: plan.playerSpawn.z }, ...plan.npcSpecs]

    for (const actor of allActors) {
      for (const [tx, tz] of TERRAIN_TREE_POSITIONS) {
        const dist = Math.hypot(actor.x - tx, actor.z - tz)
        expect(dist).toBeGreaterThanOrEqual(3)
      }
    }
  })


  it('applies manual preset+tier squad assignments exactly', () => {
    const config: BattleConfig = {
      ...PRESET_10V10,
      commandGrouping: 'squad',
      squadAssignments: [
        { presetId: 'viking_berserker', tier: 1, squadId: 2, count: 4 },
        { presetId: 'viking_archer', tier: 2, squadId: 1, count: 2 },
        { presetId: 'viking_lancer', tier: 2, squadId: 1, count: 2 },
        { presetId: 'viking_horse_archer', tier: 3, squadId: 3, count: 2 },
      ],
    }
    const plan = BattleSpawner.createSpawnPlan(config)
    const allies = plan.npcSpecs.filter(spec => spec.faction === Faction.PLAYER)

    expect(allies.filter(spec => spec.squadId === 1)).toHaveLength(4)
    expect(allies.filter(spec => spec.squadId === 2)).toHaveLength(4)
    expect(allies.filter(spec => spec.squadId === 3)).toHaveLength(2)
    expect(allies.every(spec => spec.squadId !== undefined)).toBe(true)
    expect(
      allies.filter(spec => spec.presetId === 'viking_berserker' && spec.tier === 1)
        .every(spec => spec.squadId === 2),
    ).toBe(true)
  })

})
