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
import * as THREE from 'three'
import {
  BattleConfig,
  createEmptyArmyConfig,
  validateBattleConfig,
} from '../../src/battle/BattleConfig'
import { BattleSpawner } from '../../src/battle/BattleSpawner'
import { SquadFormationPlanner } from '../../src/battle/SquadFormationPlanner'
import { AerialFormationPlanner } from '../../src/battle/AerialFormationPlanner'
import { BattleController } from '../../src/battle/BattleController'
import { BattleSetupUI } from '../../src/ui/BattleSetupUI'
import { getCustomBattlePresetsForFaction, getUnitPresetsForFaction } from '../../src/battle/UnitPresetCatalog'
import { mountTypeFromId, MountType } from '../../src/world/Mount'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { ARMORS } from '../../src/rpg/ArmorDatabase'
import {
  squadShortcutKey,
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

    // Verify T4 and T5 heroes receive appropriate combat profiles
    expect(t4s[0].combatProfileId).toBe('varangian')
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

  it('spawns aerial units on xongkoro within safe altitudes and map boundaries', () => {
    const config = makeAerialConfig(49, 50, false)
    config.commandGrouping = 'squad'
    config.squadAssignments = [
      { presetId: 'viking_archer', tier: 3, squadId: 1, count: 10 },
      { presetId: 'viking_archer', tier: 3, squadId: 2, count: 10 },
      { presetId: 'viking_archer', tier: 3, squadId: 3, count: 10 },
      { presetId: 'viking_archer', tier: 3, squadId: 4, count: 10 },
      { presetId: 'viking_archer', tier: 3, squadId: 5, count: 9 },
    ]
    const plan = BattleSpawner.createSpawnPlan(config)
    expect(plan.npcSpecs.length).toBe(99)
    for (const spec of plan.npcSpecs) {
      expect(spec.cavalry).toBe(true)
      expect(spec.loadout?.mountId).toBe('xongkoro')
      expect(spec.spawnY).toBeGreaterThanOrEqual(35)
      expect(spec.spawnY).toBeLessThanOrEqual(55)
      expect(Math.abs(spec.z)).toBeLessThanOrEqual(270)
      expect(Math.abs(spec.x)).toBeLessThanOrEqual(220)
    }
    expect(Math.abs(plan.playerSpawn.z)).toBeLessThanOrEqual(275)
    expect(plan.playerSpawn.y).toBe(35)
  })
})

describe('Custom Battle 2.0: Cavalry Mount Assignments and Seed Repeatability', () => {
  it('assigns legal mounts across T1..T5 and allocates distinct mounts independently per NPC', () => {
    // T1..T3 receive standard horse
    expect(getCustomBattleMount(1, 0)).toBe('horse')
    expect(getCustomBattleMount(2, 0)).toBe('horse')
    expect(getCustomBattleMount(3, 0)).toBe('horse')

    // T4 and T5 assign legal mounts from their respective pools
    expect(T4_RANDOM_MOUNTS).toContain(getCustomBattleMount(4, 0))
    expect(T5_RANDOM_MOUNTS).toContain(getCustomBattleMount(5, 0))

    // Within a battle, T4 and T5 NPCs receive independent mount draws from their tier pools
    const config = makeGroundConfig(0, 10)
    const vikingArmy = createEmptyArmyConfig()
    vikingArmy.cavalry[4] = 20
    vikingArmy.cavalry[5] = 20
    config.viking = vikingArmy
    config.seed = 99999

    const plan = BattleSpawner.createSpawnPlan(config)
    const t4Units = plan.npcSpecs.filter(s => s.characterFaction === 'viking' && s.tier === 4)
    const t5Units = plan.npcSpecs.filter(s => s.characterFaction === 'viking' && s.tier === 5)

    expect(t4Units.length).toBe(20)
    expect(t5Units.length).toBe(20)

    for (const unit of t4Units) {
      expect(T4_RANDOM_MOUNTS).toContain(unit.loadout?.mountId)
    }
    for (const unit of t5Units) {
      expect(T5_RANDOM_MOUNTS).toContain(unit.loadout?.mountId)
    }

    const t4MountsInBattle = new Set(t4Units.map(u => u.loadout?.mountId))
    const t5MountsInBattle = new Set(t5Units.map(u => u.loadout?.mountId))

    expect(t4MountsInBattle.size).toBeGreaterThanOrEqual(2)
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
  it('places <= 5 squads in rear rank, > 5 squads across front and rear without overlap, and spawns player behind rear rank', () => {
    // Case 1: <= 5 squads
    const config5 = makeGroundConfig(50, 10)
    config5.commandGrouping = 'squad'
    config5.squadAssignments = Array.from({ length: 5 }, (_, i) => ({
      presetId: 'viking_berserker' as const, tier: 1 as const, squadId: (i + 1) as SquadId, count: 10,
    }))
    const plan5 = SquadFormationPlanner.planCustomBattle(config5)
    const vikingUnits5 = plan5.npcSpecs.filter(u => u.characterFaction === 'viking')
    expect(vikingUnits5.length).toBe(50)
    for (const unit of vikingUnits5) expect(unit.z).toBeGreaterThanOrEqual(200)

    // Case 2: > 5 squads (6 squads)
    const config6 = makeGroundConfig(60, 10)
    config6.commandGrouping = 'squad'
    config6.squadAssignments = Array.from({ length: 6 }, (_, i) => ({
      presetId: 'viking_berserker' as const, tier: 1 as const, squadId: (i + 1) as SquadId, count: 10,
    }))
    const plan6 = SquadFormationPlanner.planCustomBattle(config6)
    const vikingUnits6 = plan6.npcSpecs.filter(u => u.characterFaction === 'viking')
    const frontUnits = vikingUnits6.filter(u => u.squadId! <= 5)
    const rearUnits = vikingUnits6.filter(u => u.squadId! >= 6)
    expect(frontUnits.length).toBe(50)
    expect(rearUnits.length).toBe(10)
    const maxFrontZ = Math.max(...frontUnits.map(u => u.z))
    const minRearZ = Math.min(...rearUnits.map(u => u.z))
    expect(minRearZ).toBeGreaterThan(maxFrontZ + 10)

    // Player spawn behind furthest rear row
    const maxZ = Math.max(...vikingUnits6.map(u => u.z))
    expect(plan6.playerSpawn.z).toBeGreaterThan(maxZ + 5)
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

  it('generates authentic camp pickups with valid weapon IDs and horses when includeCamps is enabled', () => {
    const config = makeGroundConfig(30, 30)
    config.rules.includeCamps = true
    config.mapId = 'original'

    const plan = SquadFormationPlanner.planCustomBattle(config)
    expect(plan.pickupSpecs.length).toBeGreaterThan(0)
    expect(plan.horseSpecs.length).toBeGreaterThan(0)

    // Verify all generated equipment IDs are valid weapons/shields from catalog
    const pickupIds = plan.pickupSpecs.map(p => p.weaponId).filter((id): id is string => Boolean(id))
    expect(pickupIds.length).toBeGreaterThan(0)
    expect(pickupIds.every(id => id in WEAPONS || id in ARMORS)).toBe(true)
  })
})

describe('Custom Battle 2.0: Player-Inclusive Victory & Defeat Rules', () => {
  it('evaluates ongoing battle, victory, defeat, and draw states based on player and AI casualties', () => {
    const config = makeGroundConfig(10, 10)
    const controller = new BattleController(config)
    const player = { dead: false }
    const npcs = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller.initCounts(npcs, player)

    // 1. Friendly AI dies, player alive -> ongoing
    npcs[0].dead = true
    controller.update(npcs, player)
    expect(controller.getResult()).toBeNull()

    // 2. Enemy dies, player alive -> VIKING_VICTORY
    npcs[1].dead = true
    controller.update(npcs, player)
    expect(controller.getResult()).toBe('VIKING_VICTORY')

    // 3. Reset and test ROMAN_VICTORY when player and friendly AI die
    const controller2 = new BattleController(config)
    const player2 = { dead: false }
    const npcs2 = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller2.initCounts(npcs2, player2)
    npcs2[0].dead = true
    player2.dead = true
    controller2.update(npcs2, player2)
    expect(controller2.getResult()).toBe('ROMAN_VICTORY')

    // 4. Simultaneous wipeout -> DRAW
    const controller3 = new BattleController(config)
    const player3 = { dead: false }
    const npcs3 = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller3.initCounts(npcs3, player3)
    npcs3[0].dead = true
    npcs3[1].dead = true
    player3.dead = true
    controller3.update(npcs3, player3)
    expect(controller3.getResult()).toBe('DRAW')
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

describe('Custom Battle 2.0: Roman Player Squad Assignments and Shortcuts (P0)', () => {
  it('applies manual squad assignments to Roman army in ground and aerial battles', () => {
    const config = makeGroundConfig(20, 20)
    config.playerFaction = 'roman'
    config.commandGrouping = 'squad'
    config.squadAssignments = [
      { presetId: 'roman_heavy_infantry', tier: 1, squadId: 6, count: 10 },
      { presetId: 'roman_heavy_infantry', tier: 1, squadId: 10, count: 10 },
    ]
    const plan = SquadFormationPlanner.planCustomBattle(config)
    const romanSpecs = plan.npcSpecs.filter(s => s.characterFaction === 'roman')
    expect(romanSpecs.length).toBe(20)

    const squad6 = romanSpecs.filter(s => s.squadId === 6)
    const squad10 = romanSpecs.filter(s => s.squadId === 10)
    expect(squad6.length).toBe(10)
    expect(squad10.length).toBe(10)

    // Shortcut keys correspond: squad 6 -> '6', squad 10 -> '0'
    expect(squadShortcutKey(6)).toBe('6')
    expect(squadShortcutKey(10)).toBe('0')

    const vikingSpecs = plan.npcSpecs.filter(s => s.characterFaction === 'viking')
    expect(vikingSpecs.every(s => s.squadId === 1)).toBe(true)

    // Aerial
    const aerialConfig = makeAerialConfig(20, 20, false)
    aerialConfig.playerFaction = 'roman'
    aerialConfig.commandGrouping = 'squad'
    aerialConfig.squadAssignments = [
      { presetId: 'roman_archer', tier: 3, squadId: 6, count: 10 },
      { presetId: 'roman_archer', tier: 3, squadId: 10, count: 10 },
    ]
    const aerialPlan = AerialFormationPlanner.planAerialBattle(aerialConfig)
    const aerialRoman = aerialPlan.npcSpecs.filter(s => s.characterFaction === 'roman')
    expect(aerialRoman.length).toBe(20)
    expect(aerialRoman.filter(s => s.squadId === 6).length).toBe(10)
    expect(aerialRoman.filter(s => s.squadId === 10).length).toBe(10)
  })
})

describe('Custom Battle 2.0: Clearance and Collision Avoidance (P1)', () => {
  it('throws a descriptive error when all candidate coordinates in the deployment zone are blocked', () => {
    const config = makeGroundConfig(5, 5)
    // Create an obstacle covering the entire Viking deployment zone
    const hugeObstacle = {
      box: new THREE.Box3(
        new THREE.Vector3(-300, -10, 100),
        new THREE.Vector3(300, 50, 300),
      ),
      isBarricade: false,
    }
    expect(() => SquadFormationPlanner.planCustomBattle(config, [hugeObstacle])).toThrow(
      /Unable to find safe non-overlapping deployment position/
    )
  })

  it('safely deploys 300v300 with 50 cavalry per squad on Town map with obstacles without overlaps or errors', () => {
    const config: BattleConfig = {
      battleType: 'ground',
      mapId: 'roman_town',
      playerFaction: 'viking',
      spectator: false,
      rules: { respawnEnabled: false, includeCamps: false },
      playerLoadout: {
        meleeWeaponId: 'sword_t5',
        rangedWeaponId: 'bow_t5',
        shieldId: 'commander_shield_t5',
        startMounted: true,
        mountId: 'horse',
      },
      viking: {
        viking_lancer: { 1: 50, 2: 50, 3: 50, 4: 50, 5: 50 },
        viking_horse_archer: { 1: 50, 2: 0, 3: 0, 4: 0, 5: 0 },
      } as any,
      roman: {
        roman_lancer: { 1: 50, 2: 50, 3: 50, 4: 50, 5: 50 },
        roman_horse_archer: { 1: 50, 2: 0, 3: 0, 4: 0, 5: 0 },
      } as any,
    }
    // Town wall obstacle at South gate / wall (Z in [95, 105], X in [-100, 100])
    const townObstacles = [
      {
        box: new THREE.Box3(new THREE.Vector3(-100, -1, 95), new THREE.Vector3(100, 10, 105)),
        isBarricade: false,
      },
      {
        box: new THREE.Box3(new THREE.Vector3(-100, -1, -105), new THREE.Vector3(100, 10, -95)),
        isBarricade: false,
      },
    ]

    const plan = SquadFormationPlanner.planCustomBattle(config, townObstacles)
    expect(plan.npcSpecs.length).toBe(600)

    const invalid: string[] = []
    const cellSize = 5.0
    const grid = new Map<string, Array<{ index: number; x: number; z: number; radius: number }>>()

    for (let i = 0; i < plan.npcSpecs.length; i++) {
      const unit = plan.npcSpecs[i]
      if (!Number.isFinite(unit.x) || !Number.isFinite(unit.z)) {
        invalid.push(`non-finite coordinate at ${i}: x=${unit.x}, z=${unit.z}`)
        continue
      }
      const radius = unit.cavalry ? 2.1 : 1.1
      const cx = Math.floor(unit.x / cellSize)
      const cz = Math.floor(unit.z / cellSize)
      const key = `${cx},${cz}`
      const cell = grid.get(key)
      if (cell) {
        cell.push({ index: i, x: unit.x, z: unit.z, radius })
      } else {
        grid.set(key, [{ index: i, x: unit.x, z: unit.z, radius }])
      }

      // Check strictly outside town obstacles using actual collision footprint
      for (const obs of townObstacles) {
        const overlapX = unit.x + radius >= obs.box.min.x && unit.x - radius <= obs.box.max.x
        const overlapZ = unit.z + radius >= obs.box.min.z && unit.z - radius <= obs.box.max.z
        if (overlapX && overlapZ) {
          invalid.push(`inside wall ${i}: ${unit.x},${unit.z}`)
        }
      }
    }

    // Spatial hash neighbor queries for all 600 units
    for (let i = 0; i < plan.npcSpecs.length; i++) {
      const u1 = plan.npcSpecs[i]
      if (!Number.isFinite(u1.x) || !Number.isFinite(u1.z)) continue
      const r1 = u1.cavalry ? 2.1 : 1.1
      const cx = Math.floor(u1.x / cellSize)
      const cz = Math.floor(u1.z / cellSize)

      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const neighborCell = grid.get(`${cx + dx},${cz + dz}`)
          if (!neighborCell) continue
          for (const u2 of neighborCell) {
            if (u2.index <= i) continue
            const minDist = r1 + u2.radius
            const dist = Math.hypot(u1.x - u2.x, u1.z - u2.z)
            if (dist < minDist - 0.0001) {
              invalid.push(`overlap ${i}/${u2.index}: dist ${dist.toFixed(2)} < ${minDist.toFixed(2)}`)
            }
          }
        }
      }
    }

    expect(invalid).toEqual([])
  })
})

describe('Custom Battle 2.0: Battle Type Map Selection Persistence (P2)', () => {
  it('resets map to original in aerial mode and preserves ground map selection across mode toggles', () => {
    const config = makeGroundConfig(10, 10)
    config.mapId = 'roman_town'
    const ui = new BattleSetupUI(config)

    // Initial state: ground mode with roman_town
    expect(ui.getConfig().battleType ?? 'ground').toBe('ground')
    expect(ui.getConfig().mapId).toBe('roman_town')

    // Switch to Aerial
    ui.switchBattleType('aerial')
    expect(ui.getConfig().battleType).toBe('aerial')
    expect(ui.getConfig().mapId).toBe('original')

    // Switch back to Ground: restores roman_town
    ui.switchBattleType('ground')
    expect(ui.getConfig().battleType).toBe('ground')
    expect(ui.getConfig().mapId).toBe('roman_town')

    // Select snow map in ground mode
    ui.selectMap('snow')
    expect(ui.getConfig().mapId).toBe('snow')

    // Switch to Aerial again: forced to original
    ui.switchBattleType('aerial')
    expect(ui.getConfig().mapId).toBe('original')

    // Switch back to Ground: restores snow
    ui.switchBattleType('ground')
    expect(ui.getConfig().battleType).toBe('ground')
    expect(ui.getConfig().mapId).toBe('snow')
  })
})

describe('Custom Battle Heavy Cavalry', () => {
  const LANCES = ['hunting_spear', 'steel_lance', 'heavy_lance', 'spear_t4']
  const expected = {
    roman: {
      presetId: 'roman_heavy_cavalry', mountId: 'armored-horse', mountType: MountType.ARMORED_HORSE,
      shields: ['scutum_t1', 'scutum_t2', 'scutum_t3', 'roman_officer_shield_t4', 'byzantine_eagle_shield_t5'],
      t5: { weapon: 'byzantine_standard_lance_t5', combat: 'byzantine-cataphract' },
      t4: { combat: 'centurion' },
    },
    viking: {
      presetId: 'viking_heavy_cavalry', mountId: 'snow-leopard', mountType: MountType.SNOW_LEOPARD,
      shields: ['round_shield_t1', 'round_shield_t2', 'round_shield_t3', 'paladin_shield_t4', 'viking_berserker_shield_t5'],
      t5: { weapon: 'spear_t5', combat: 'ironblood-warlord' },
      t4: { combat: 'dragon-oathguard' },
    },
  } as const

  function heavyConfig(mode: 'formation' | 'scattered' = 'formation'): BattleConfig {
    const config = makeGroundConfig(0, 0)
    config.mode = mode
    config.roman = { ...config.roman, roman_heavy_cavalry: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } }
    config.viking = { ...config.viking, viking_heavy_cavalry: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } }
    return config
  }

  it('spawns heavy cavalry with exact loadouts, mounts and profiles, appearing only in custom battle roster', () => {
    const config = heavyConfig()
    expect(validateBattleConfig(config).valid).toBe(true)
    const plan = BattleSpawner.createSpawnPlan(config)
    for (const faction of ['roman', 'viking'] as const) {
      const want = expected[faction]
      for (const tier of [1, 2, 3, 4, 5] as const) {
        const specs = plan.npcSpecs.filter(spec => spec.presetId === want.presetId && spec.tier === tier)
        expect(specs.length).toBe(1)
        const [spec] = specs
        const hero = tier === 5 ? want.t5 : tier === 4 ? want.t4 : undefined
        expect(spec).toMatchObject({ characterFaction: faction, cavalry: true, combatProfileId: hero?.combat })
        expect(spec.loadout).toMatchObject({
          meleeWeaponId: tier === 5 ? want.t5.weapon : LANCES[tier - 1],
          shieldId: want.shields[tier - 1], rangedWeaponId: null, mountId: want.mountId,
        })
        expect(mountTypeFromId(spec.loadout?.mountId)).toBe(want.mountType)
      }
      const custom = getCustomBattlePresetsForFaction(faction).map(preset => preset.id)
      expect(custom).toContain(`${faction}_heavy_cavalry`)
      expect(getUnitPresetsForFaction(faction).map(preset => preset.id)).not.toContain(`${faction}_heavy_cavalry`)
    }
  })
})
