/**
 * CustomBattle2.test.ts
 * Comprehensive test suite for Custom Battle 2.0 features:
 * - Ground Battle 300 vs 300 limits, free T1-T5 tiers, removal of T4 limit.
 * - Aerial Battle 50 vs 50 limits (49 AI + player or 50 AI spectator), xongkoro mounts, altitudes.
 * - Cavalry mount resolution: T1-T3 horse, T4 individual feline/corgi draw, T5 individual wildcat draw, seed repeatability.
 * - Squad-based formation rules: <= 5 squads rear rank, > 5 squads front 1-5 and rear 6-10.
 * - Dynamic rank placement: front rank, rear rank, and player do not overlap; mounted unit distance >= 4.0m.
 * - Aerial 50-eagle boundary limits: single squad of 50 and multi-squads 50 stay strictly inside map boundaries.
 * - Rejection of hidden ground units in aerial combat.
 * - Five maps deployment zones and safety clearances.
 * - Player-inclusive victory / defeat determination.
 * - Camp supply and horses verification.
 * - Squad shortcut key mappings.
 */
import { describe, expect, it } from 'vitest'
import {
  BattleConfig,
  createEmptyArmyConfig,
  validateBattleConfig,
} from '../../src/battle/BattleConfig'
import { BattleSpawner } from '../../src/battle/BattleSpawner'
import { SquadFormationPlanner } from '../../src/battle/SquadFormationPlanner'
import { AerialFormationPlanner } from '../../src/battle/AerialFormationPlanner'
import { BattleController } from '../../src/battle/BattleController'
import {
  squadShortcutKey,
  MAX_CUSTOM_BATTLE_COMMAND_SQUADS,
  MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE,
  CIVILIAN_SQUAD_ID,
  SquadId,
} from '../../src/battle/CommandTarget'
import {
  T4_RANDOM_MOUNTS,
  T5_RANDOM_MOUNTS,
  getCustomBattleMount,
} from '../../src/battle/T5HeroCatalog'
import { Faction, NPC } from '../../src/world/NPC'

function makeGroundConfig(vikingTotal: number, romanTotal: number = 10): BattleConfig {
  const vikingArmy = createEmptyArmyConfig()
  vikingArmy.infantry[1] = vikingTotal
  const romanArmy = createEmptyArmyConfig()
  romanArmy.infantry[1] = romanTotal

  return {
    battleType: 'ground',
    mapId: 'original',
    playerFaction: 'viking',
    spectator: false,
    rules: { respawnEnabled: false, includeCamps: false },
    playerLoadout: {
      meleeWeaponId: 'sword_t5',
      rangedWeaponId: 'bow_t5',
      shieldId: 'commander_shield_t5',
      startMounted: false,
    },
    viking: vikingArmy,
    roman: romanArmy,
  }
}

function makeAerialConfig(vikingTotal: number, romanTotal: number = 10, spectator = false): BattleConfig {
  const vikingArmy = createEmptyArmyConfig('viking')
  vikingArmy.viking_archer = { 1: 0, 2: 0, 3: vikingTotal, 4: 0, 5: 0 }
  const romanArmy = createEmptyArmyConfig('roman')
  romanArmy.roman_archer = { 1: 0, 2: 0, 3: romanTotal, 4: 0, 5: 0 }

  return {
    battleType: 'aerial',
    mapId: 'original',
    playerFaction: 'viking',
    spectator,
    rules: { respawnEnabled: false, includeCamps: false },
    playerLoadout: {
      meleeWeaponId: 'sword_t5',
      rangedWeaponId: 'bow_t5',
      shieldId: 'commander_shield_t5',
      startMounted: true,
      mountId: 'xongkoro',
    },
    viking: vikingArmy,
    roman: romanArmy,
  }
}

function createMockNpc(
  faction: Faction,
  dead: boolean = false,
  characterFaction: 'viking' | 'roman' = faction === Faction.ENEMY ? 'roman' : 'viking',
): NPC & { dead: boolean } {
  return {
    faction,
    characterFaction,
    dead,
  } as unknown as NPC & { dead: boolean }
}

describe('Custom Battle 2.0: Ground Battle Limits and Tiers', () => {
  it('allows up to 300 AI per faction and rejects 301', () => {
    const validConfig = makeGroundConfig(300, 300)
    expect(validateBattleConfig(validConfig).valid).toBe(true)

    const overViking = makeGroundConfig(301, 300)
    const resViking = validateBattleConfig(overViking)
    expect(resViking.valid).toBe(false)
    expect(resViking.errors.some(e => e.includes('300'))).toBe(true)

    const overRoman = makeGroundConfig(300, 301)
    const resRoman = validateBattleConfig(overRoman)
    expect(resRoman.valid).toBe(false)
    expect(resRoman.errors.some(e => e.includes('300'))).toBe(true)
  })

  it('allows arbitrary combinations of T1..T5 with no 3-unit limit on T4 and no limit on T5', () => {
    const config = makeGroundConfig(0, 50)
    const vikingArmy = createEmptyArmyConfig()
    vikingArmy.infantry[1] = 50
    vikingArmy.infantry[2] = 50
    vikingArmy.infantry[3] = 50
    vikingArmy.infantry[4] = 75 // More than old limit of 3!
    vikingArmy.infantry[5] = 75 // T5 allowed freely
    config.viking = vikingArmy
    // Total is 300
    const res = validateBattleConfig(config)
    expect(res.valid).toBe(true)

    // Plan spawn and check specs contain T4 and T5 heroes
    const plan = BattleSpawner.createSpawnPlan(config)
    const t4s = plan.npcSpecs.filter(s => s.characterFaction === 'viking' && s.tier === 4)
    const t5s = plan.npcSpecs.filter(s => s.characterFaction === 'viking' && s.tier === 5)
    expect(t4s.length).toBe(75)
    expect(t5s.length).toBe(75)

    // Verify T5 heroes use correct visual asset and combat profile
    expect(t5s[0].visualAssetId).toBe('viking-hero-t5')
    expect(t5s[0].combatProfileId).toBe('viking-commander')
  })
})

describe('Custom Battle 2.0: Aerial Battle Limits and Configuration', () => {
  it('allows 49 AI + 1 player (total 50) for participating player, and 50 AI for enemy', () => {
    const config = makeAerialConfig(49, 50, false)
    expect(validateBattleConfig(config).valid).toBe(true)

    // 50 AI + 1 player on player faction exceeds 50 participants (cap is 49 AI)
    const overConfig = makeAerialConfig(50, 50, false)
    const res = validateBattleConfig(overConfig)
    expect(res.valid).toBe(false)
    expect(res.errors.some(e => e.includes('exceeds 49'))).toBe(true)
  })

  it('allows 50 AI vs 50 AI when player is spectator', () => {
    const config = makeAerialConfig(50, 50, true)
    expect(validateBattleConfig(config).valid).toBe(true)

    // 51 AI rejected
    const overConfig = makeAerialConfig(51, 50, true)
    const res = validateBattleConfig(overConfig)
    expect(res.valid).toBe(false)
    expect(res.errors.some(e => e.includes('50'))).toBe(true)
  })

  it('rejects aerial config that includes non-archer units', () => {
    const config = makeAerialConfig(20, 20, false)
    config.viking.viking_berserker = { 1: 5, 2: 0, 3: 0, 4: 0, 5: 0 }
    const res = validateBattleConfig(config)
    expect(res.valid).toBe(false)
    expect(res.errors.some(e => e.includes('aerial battle cannot contain non-archer unit'))).toBe(true)
  })

  it('spawns all aerial units on xongkoro with safe altitudes between 35m and 55m', () => {
    const config = makeAerialConfig(20, 20, false)
    const plan = BattleSpawner.createSpawnPlan(config)

    expect(plan.npcSpecs.length).toBe(40)
    for (const spec of plan.npcSpecs) {
      expect(spec.cavalry).toBe(true)
      expect(spec.loadout?.mountId).toBe('xongkoro')
      expect(spec.spawnY).toBeGreaterThanOrEqual(35)
      expect(spec.spawnY).toBeLessThanOrEqual(55)
    }
  })

  it('keeps single 50-eagle squad strictly within playable map boundaries |Z| <= 270 and |X| <= 220', () => {
    const config = makeAerialConfig(49, 50, false)
    const plan = AerialFormationPlanner.planAerialBattle(config)

    expect(plan.npcSpecs.length).toBe(99)
    for (const spec of plan.npcSpecs) {
      expect(Math.abs(spec.z)).toBeLessThanOrEqual(270)
      expect(Math.abs(spec.x)).toBeLessThanOrEqual(220)
    }
    // Player within safe bounds
    expect(Math.abs(plan.playerSpawn.z)).toBeLessThanOrEqual(275)
    expect(plan.playerSpawn.y).toBe(35)
  })

  it('keeps multi-squad 50-eagle army strictly within playable map boundaries', () => {
    const config = makeAerialConfig(49, 50, false)
    config.commandGrouping = 'squad'
    config.squadAssignments = [
      { presetId: 'viking_archer', tier: 3, squadId: 1, count: 10 },
      { presetId: 'viking_archer', tier: 3, squadId: 2, count: 10 },
      { presetId: 'viking_archer', tier: 3, squadId: 3, count: 10 },
      { presetId: 'viking_archer', tier: 3, squadId: 4, count: 10 },
      { presetId: 'viking_archer', tier: 3, squadId: 5, count: 9 },
    ]
    const plan = AerialFormationPlanner.planAerialBattle(config)

    for (const spec of plan.npcSpecs) {
      expect(Math.abs(spec.z)).toBeLessThanOrEqual(270)
      expect(Math.abs(spec.x)).toBeLessThanOrEqual(220)
    }
  })
})

describe('Custom Battle 2.0: Cavalry Mount Assignments and Seed Repeatability', () => {
  it('assigns standard horse to T1..T3, felines/corgi to T4, and wildcats to T5', () => {
    // T1..T3
    expect(getCustomBattleMount(1, 42)).toBe('horse')
    expect(getCustomBattleMount(2, 42)).toBe('horse')
    expect(getCustomBattleMount(3, 42)).toBe('horse')

    // T4
    const t4Mounts = new Set<string>()
    for (let seed = 0; seed < 100; seed++) {
      const mount = getCustomBattleMount(4, seed)
      expect(T4_RANDOM_MOUNTS).toContain(mount)
      t4Mounts.add(mount)
    }
    expect(t4Mounts.size).toBe(4)

    // T5
    const t5Mounts = new Set<string>()
    for (let seed = 0; seed < 100; seed++) {
      const mount = getCustomBattleMount(5, seed)
      expect(T5_RANDOM_MOUNTS).toContain(mount)
      t5Mounts.add(mount)
    }
    expect(t5Mounts.size).toBe(3)
  })

  it('allocates mounts per individual NPC within the same battle (multiple distinct mounts)', () => {
    const config = makeGroundConfig(0, 10)
    const vikingArmy = createEmptyArmyConfig()
    vikingArmy.cavalry[4] = 50
    vikingArmy.cavalry[5] = 50
    config.viking = vikingArmy
    config.seed = 99999

    const plan = BattleSpawner.createSpawnPlan(config)
    const t4Units = plan.npcSpecs.filter(s => s.characterFaction === 'viking' && s.tier === 4)
    const t5Units = plan.npcSpecs.filter(s => s.characterFaction === 'viking' && s.tier === 5)

    expect(t4Units.length).toBe(50)
    expect(t5Units.length).toBe(50)

    const t4MountsInBattle = new Set(t4Units.map(u => u.loadout?.mountId))
    const t5MountsInBattle = new Set(t5Units.map(u => u.loadout?.mountId))

    // 50 units should sample multiple distinct mounts from each pool
    expect(t4MountsInBattle.size).toBeGreaterThanOrEqual(3)
    expect(t5MountsInBattle.size).toBeGreaterThanOrEqual(2)
  })

  it('guarantees deterministic mount assignment on rematch with identical seed', () => {
    const seed = 12345678
    const config1 = makeGroundConfig(0, 10)
    const vikingArmy = createEmptyArmyConfig()
    vikingArmy.cavalry[4] = 10
    vikingArmy.cavalry[5] = 10
    config1.viking = vikingArmy
    config1.seed = seed

    const config2 = { ...config1 }

    const plan1 = BattleSpawner.createSpawnPlan(config1)
    const plan2 = BattleSpawner.createSpawnPlan(config2)

    const mounts1 = plan1.npcSpecs.map(s => s.loadout?.mountId)
    const mounts2 = plan2.npcSpecs.map(s => s.loadout?.mountId)
    expect(mounts1).toEqual(mounts2)
  })
})

describe('Custom Battle 2.0: Squad Formation Layout Rules', () => {
  it('places <= 5 squads ALL in rear rank, leaving front rank completely empty', () => {
    for (const numSquads of [1, 3, 5]) {
      const config = makeGroundConfig(numSquads * 10, 10)
      config.commandGrouping = 'squad'
      config.squadAssignments = []
      for (let s = 1; s <= numSquads; s++) {
        config.squadAssignments.push({
          presetId: 'viking_berserker',
          tier: 1,
          squadId: s as SquadId,
          count: 10,
        })
      }

      const plan = SquadFormationPlanner.planCustomBattle(config)
      const vikingUnits = plan.npcSpecs.filter(u => u.characterFaction === 'viking')
      expect(vikingUnits.length).toBe(numSquads * 10)

      // In Viking deployment, South is Z > 0.
      // Rear rank is at the edge (Z >= 200).
      for (const unit of vikingUnits) {
        expect(unit.z).toBeGreaterThanOrEqual(200)
      }
    }
  })

  it('places squads 1-5 in front rank and squads 6-10 in rear rank when > 5 squads without overlap', () => {
    for (const numSquads of [6, 8, 10]) {
      const config = makeGroundConfig(numSquads * 10, 10)
      config.commandGrouping = 'squad'
      config.squadAssignments = []
      for (let s = 1; s <= numSquads; s++) {
        config.squadAssignments.push({
          presetId: 'viking_berserker',
          tier: 1,
          squadId: s as SquadId,
          count: 10,
        })
      }

      const plan = SquadFormationPlanner.planCustomBattle(config)
      const vikingUnits = plan.npcSpecs.filter(u => u.characterFaction === 'viking')
      expect(vikingUnits.length).toBe(numSquads * 10)

      const frontUnits = vikingUnits.filter(u => u.squadId! <= 5)
      const rearUnits = vikingUnits.filter(u => u.squadId! >= 6)

      expect(frontUnits.length).toBe(5 * 10)
      expect(rearUnits.length).toBe((numSquads - 5) * 10)

      const maxFrontZ = Math.max(...frontUnits.map(u => u.z))
      const minRearZ = Math.min(...rearUnits.map(u => u.z))

      // Crucial requirement: Front rank and rear rank NEVER overlap!
      // Between front and rear rank there is a clear inter-rank corridor.
      expect(minRearZ).toBeGreaterThan(maxFrontZ + 10)
    }
  })

  it('spawns player safely behind rear rank on own edge', () => {
    const config = makeGroundConfig(50, 50)
    const plan = SquadFormationPlanner.planCustomBattle(config)

    const vikingUnits = plan.npcSpecs.filter(u => u.characterFaction === 'viking')
    const maxZ = Math.max(...vikingUnits.map(u => u.z))
    // Player spawn must be behind the furthest rear row of their army
    expect(plan.playerSpawn.z).toBeGreaterThan(maxZ + 5)
  })

  it('maintains safe distance >= 4.0m between mounted units in 50-unit cavalry squads', () => {
    const config = makeGroundConfig(0, 10)
    const vikingArmy = createEmptyArmyConfig()
    vikingArmy.cavalry[3] = 50
    config.viking = vikingArmy

    const plan = SquadFormationPlanner.planCustomBattle(config)
    const cavalryUnits = plan.npcSpecs.filter(u => u.characterFaction === 'viking' && u.cavalry)

    expect(cavalryUnits.length).toBe(50)
    for (let i = 0; i < cavalryUnits.length; i++) {
      for (let j = i + 1; j < cavalryUnits.length; j++) {
        const dist = Math.hypot(cavalryUnits[i].x - cavalryUnits[j].x, cavalryUnits[i].z - cavalryUnits[j].z)
        expect(dist).toBeGreaterThanOrEqual(4.0)
      }
    }
  })

  it('ensures units and squads do not overlap on all five ground maps', () => {
    const maps = ['original', 'bridge', 'roman_town', 'snow', 'viking_town'] as const

    for (const mapId of maps) {
      const config = makeGroundConfig(50, 50)
      config.mapId = mapId
      const plan = SquadFormationPlanner.planCustomBattle(config)

      expect(plan.npcSpecs.length).toBe(100)

      // Check unit-to-unit spacing (no two units at the exact same location)
      const posSet = new Set<string>()
      for (const spec of plan.npcSpecs) {
        const key = `${spec.x.toFixed(1)},${spec.z.toFixed(1)}`
        expect(posSet.has(key)).toBe(false)
        posSet.add(key)
      }
    }
  })

  it('generates authentic camp pickups with valid weapon IDs and horses when includeCamps is enabled', () => {
    const config = makeGroundConfig(30, 30)
    config.rules.includeCamps = true
    config.mapId = 'original'

    const plan = SquadFormationPlanner.planCustomBattle(config)
    expect(plan.pickupSpecs.length).toBeGreaterThan(10)
    expect(plan.horseSpecs.length).toBe(10) // 5 per side

    // Verify weapon IDs are valid weapons from catalog
    const pickupIds = plan.pickupSpecs.map(p => p.weaponId).filter(Boolean)
    expect(pickupIds).toContain('wooden_shortbow')
    expect(pickupIds).toContain('steel_sword')
    expect(pickupIds).not.toContain('shortbow')
    expect(pickupIds).not.toContain('sword_iron')
  })
})

describe('Custom Battle 2.0: Player-Inclusive Victory & Defeat Rules', () => {
  it('keeps battle ongoing when friendly AI are all eliminated but player is still alive', () => {
    const config = makeGroundConfig(10, 10)
    const controller = new BattleController(config)
    const player = { dead: false }
    const npcs = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller.initCounts(npcs, player)

    // Friendly AI dies, player alive, enemy alive
    npcs[0].dead = true
    controller.update(npcs, player)

    expect(controller.getResult()).toBeNull()
  })

  it('keeps battle ongoing when player dies but friendly AI are still alive', () => {
    const config = makeGroundConfig(10, 10)
    const controller = new BattleController(config)
    const player = { dead: true }
    const npcs = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller.initCounts(npcs, { dead: false })

    controller.update(npcs, player)
    expect(controller.getResult()).toBeNull()
  })

  it('determines ROMAN_VICTORY when player dies and all friendly Viking AI die', () => {
    const config = makeGroundConfig(10, 10)
    const controller = new BattleController(config)
    const player = { dead: false }
    const npcs = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller.initCounts(npcs, player)

    // Both Viking AI and player die, Roman alive
    npcs[0].dead = true
    player.dead = true
    controller.update(npcs, player)

    expect(controller.getResult()).toBe('ROMAN_VICTORY')
  })

  it('determines VIKING_VICTORY when enemy Romans are wiped and player or Viking AI is alive', () => {
    const config = makeGroundConfig(10, 10)
    const controller = new BattleController(config)
    const player = { dead: false }
    const npcs = [
      createMockNpc(Faction.PLAYER, true, 'viking'), // Viking AI dead
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller.initCounts(npcs, player)

    // Roman eliminated, player still alive
    npcs[1].dead = true
    controller.update(npcs, player)

    expect(controller.getResult()).toBe('VIKING_VICTORY')
  })

  it('determines DRAW when both sides are wiped out simultaneously including player', () => {
    const config = makeGroundConfig(10, 10)
    const controller = new BattleController(config)
    const player = { dead: false }
    const npcs = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller.initCounts(npcs, player)

    npcs[0].dead = true
    npcs[1].dead = true
    player.dead = true
    controller.update(npcs, player)

    expect(controller.getResult()).toBe('DRAW')
  })

  it('does not include player in counts or victory logic when spectator mode is active', () => {
    const config = makeGroundConfig(10, 10)
    config.spectator = true
    const controller = new BattleController(config)
    const player = { dead: false }
    const npcs = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller.initCounts(npcs, player)

    // In spectator mode, Viking AI dying should immediately trigger Roman victory
    npcs[0].dead = true
    controller.update(npcs, player)

    expect(controller.getResult()).toBe('ROMAN_VICTORY')
  })
})

describe('Custom Battle 2.0: Command Target Shortcuts and Limits', () => {
  it('maps squad shortcuts 1..9 to keys 1..9, and squad 10 to key 0', () => {
    for (let id = 1; id <= 9; id++) {
      expect(squadShortcutKey(id as SquadId)).toBe(String(id))
    }
    expect(squadShortcutKey(10)).toBe('0')
  })

  it('preserves Career civilian shortcut mapping to key 0', () => {
    expect(squadShortcutKey(CIVILIAN_SQUAD_ID)).toBe('0')
  })

  it('enforces 10 squads max and 50 units per squad limits', () => {
    expect(MAX_CUSTOM_BATTLE_COMMAND_SQUADS).toBe(10)
    expect(MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE).toBe(50)
  })
})
