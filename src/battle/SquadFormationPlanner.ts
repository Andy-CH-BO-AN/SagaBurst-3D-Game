/**
 * SquadFormationPlanner.ts
 * Squad-based deployment planner for Custom Battle 2.0.
 *
 * Implements:
 * 1. Front Rank (squads 1-5) and Rear Rank (squads 6-10) partitioning.
 * 2. When total squads <= 5, ALL squads deploy in the Rear Rank.
 * 3. Horizontal side-by-side squad blocks, centered at X = 0.
 * 4. Distinct deployment zones at opposite map edges for 5 maps.
 * 5. Deterministic random mount selection for T4/T5 cavalry.
 * 6. Rectangular squad formations with obstacle avoidance.
 */
import { AIType } from '../world/NPC'
import {
  BattleConfig,
  CustomBattleMapId,
  CUSTOM_BATTLE_UNIT_TIERS,
  ArmyConfig,
  normalizeArmyConfig,
  UnitTier,
} from './BattleConfig'
import { T4_UNIT_PROFILES, resolveT4UnitLoadout } from './T4HeroCatalog'
import { getT5ProfileForFaction, resolveT5UnitLoadout, getCustomBattleMount } from './T5HeroCatalog'
import type { HeroCombatProfileId } from './HeroCombatProfile'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { CharacterTier, HeroArchetype } from '../combat/CharacterIdentity'
import {
  UNIT_PRESETS,
  resolveUnitLoadout,
  type BaseUnitTier,
  type UnitLoadout,
  type UnitPresetId,
} from './UnitPresetCatalog'
import {
  MAX_CUSTOM_BATTLE_COMMAND_SQUADS,
  MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE,
  type SquadAssignment,
  type SquadId,
} from './CommandTarget'
import {
  NpcSpawnSpec,
  BattleSpawnPlan,
  CampPickupSpec,
  CampHorseSpec,
  allegianceFor,
  CAMP_PICKUP_Z,
  CAMP_HORSE_Z,
} from './BattleSpawner'
import { TERRAIN_TREE_POSITIONS, type ObstacleData } from '../world/Terrain'

export function createMulberry32(seed: number = 0x5a6ab7) {
  let s = seed >>> 0
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface MapDeploymentZone {
  vikingRearZ: number
  vikingFrontZ: number
  vikingPlayerZ: number
  romanRearZ: number
  romanFrontZ: number
  romanPlayerZ: number
  boundsX: number
}

export function getMapDeploymentZones(mapId: CustomBattleMapId = 'original'): MapDeploymentZone {
  switch (mapId) {
    case 'bridge':
      // South Bank (Viking) and North Bank (Roman), well clear of the river (|z| <= 24)
      return {
        vikingRearZ: 125,
        vikingFrontZ: 95,
        vikingPlayerZ: 145,
        romanRearZ: -125,
        romanFrontZ: -95,
        romanPlayerZ: -145,
        boundsX: 110,
      }
    case 'roman_town':
    case 'viking_town':
      // Outside city walls (walls are at z = -115 and z = +100), facing gates
      return {
        vikingRearZ: 210,
        vikingFrontZ: 170,
        vikingPlayerZ: 235,
        romanRearZ: -210,
        romanFrontZ: -170,
        romanPlayerZ: -235,
        boundsX: 160,
      }
    case 'snow':
    case 'original':
    default:
      return {
        vikingRearZ: 140,
        vikingFrontZ: 115,
        vikingPlayerZ: 155,
        romanRearZ: -140,
        romanFrontZ: -115,
        romanPlayerZ: -155,
        boundsX: 140,
      }
  }
}

export interface PlannedUnitInstance {
  presetId: UnitPresetId
  presetName: string
  tier: UnitTier
  cavalry: boolean
  aiType: AIType
  loadout: UnitLoadout
  characterTier?: CharacterTier
  heroArchetype?: HeroArchetype
  visualAssetId?: HeroAssetId
  combatProfileId?: HeroCombatProfileId
  specialCombatProfile?: 'maki-ranger'
  squadId: SquadId
}

export interface SquadGroup {
  squadId: SquadId
  units: PlannedUnitInstance[]
}

export interface SquadRankPartition {
  frontRank: SquadGroup[]
  rearRank: SquadGroup[]
}

/**
 * Partitions active squads into Front Rank and Rear Rank.
 * Rule:
 * - If total active squads <= 5: all squads go into Rear Rank (Front Rank is empty).
 * - If total active squads > 5: squads 1..5 go to Front Rank, squads 6..10 go to Rear Rank.
 */
export function partitionSquadRanks(activeSquads: SquadGroup[]): SquadRankPartition {
  const sorted = [...activeSquads].sort((a, b) => a.squadId - b.squadId)
  if (sorted.length <= 5) {
    return {
      frontRank: [],
      rearRank: sorted,
    }
  }
  return {
    frontRank: sorted.filter(s => s.squadId <= 5),
    rearRank: sorted.filter(s => s.squadId > 5),
  }
}

export class SquadFormationPlanner {
  /**
   * Plans a complete squad-based formation for custom battle.
   */
  static planCustomBattle(config: BattleConfig, obstacles?: ObstacleData[]): BattleSpawnPlan {
    const seed = config.seed ?? 0x5a6ab7
    const prng = createMulberry32(seed)
    const mode = config.mode ?? 'formation'
    const mapId = config.mapId ?? 'original'
    const zones = getMapDeploymentZones(mapId)

    const playerFaction = config.playerFaction ?? 'viking'
    const isVikingPlayer = playerFaction === 'viking'

    // 1. Expand and partition Viking squads
    const vikingUnits = this._expandFactionUnits(
      config.viking,
      'viking',
      prng,
      isVikingPlayer ? config.squadAssignments : undefined,
    )
    const vikingSquads = this._groupIntoSquads(vikingUnits)
    const vikingPartition = partitionSquadRanks(vikingSquads)

    // 2. Expand and partition Roman squads
    const romanUnits = this._expandFactionUnits(
      config.roman,
      'roman',
      prng,
      !isVikingPlayer ? config.squadAssignments : undefined,
    )
    const romanSquads = this._groupIntoSquads(romanUnits)
    const romanPartition = partitionSquadRanks(romanSquads)

    // 3. Generate NPC spawn specs
    const npcSpecs: NpcSpawnSpec[] = []
    const respawn = config.rules.respawnEnabled ?? false

    // Deploy Viking (South side, facing North / -Z)
    this._deployFactionRank(
      vikingPartition.frontRank,
      zones.vikingFrontZ,
      'viking',
      config,
      mode,
      npcSpecs,
      respawn,
      obstacles,
      zones.boundsX,
    )
    this._deployFactionRank(
      vikingPartition.rearRank,
      zones.vikingRearZ,
      'viking',
      config,
      mode,
      npcSpecs,
      respawn,
      obstacles,
      zones.boundsX,
    )

    // Deploy Roman (North side, facing South / +Z)
    this._deployFactionRank(
      romanPartition.frontRank,
      zones.romanFrontZ,
      'roman',
      config,
      mode,
      npcSpecs,
      respawn,
      obstacles,
      zones.boundsX,
    )
    this._deployFactionRank(
      romanPartition.rearRank,
      zones.romanRearZ,
      'roman',
      config,
      mode,
      npcSpecs,
      respawn,
      obstacles,
      zones.boundsX,
    )

    // Player spawn (behind rear rank on friendly side)
    const playerSpawn = {
      x: 0,
      z: isVikingPlayer ? zones.vikingPlayerZ : zones.romanPlayerZ,
    }

    // Camps / pick-ups
    const pickupSpecs: CampPickupSpec[] = []
    const horseSpecs: CampHorseSpec[] = []
    if (config.rules.includeCamps && mapId === 'original') {
      pickupSpecs.push(
        { weaponId: 'sword_iron', x: -15, z: isVikingPlayer ? CAMP_PICKUP_Z : -CAMP_PICKUP_Z },
        { weaponId: 'shortbow', x: 0, z: isVikingPlayer ? CAMP_PICKUP_Z : -CAMP_PICKUP_Z, isArrowPack: true, arrowQuantity: 30 },
        { weaponId: 'spear_basic', x: 15, z: isVikingPlayer ? CAMP_PICKUP_Z : -CAMP_PICKUP_Z },
      )
      horseSpecs.push(
        { x: -10, z: isVikingPlayer ? CAMP_HORSE_Z : -CAMP_HORSE_Z, stableKey: `${playerFaction}:camp:left` },
        { x: 10, z: isVikingPlayer ? CAMP_HORSE_Z : -CAMP_HORSE_Z, stableKey: `${playerFaction}:camp:right` },
      )
    }

    return {
      playerSpawn,
      npcSpecs,
      pickupSpecs,
      horseSpecs,
    }
  }

  private static _expandFactionUnits(
    army: ArmyConfig,
    faction: CharacterFaction,
    prng: () => number,
    manualAssignments?: readonly SquadAssignment[],
  ): PlannedUnitInstance[] {
    const normalized = normalizeArmyConfig(army, faction)
    const rawUnits: Array<Omit<PlannedUnitInstance, 'squadId'>> = []

    for (const [presetKey, tierCounts] of Object.entries(normalized)) {
      const presetId = presetKey as UnitPresetId
      const preset = UNIT_PRESETS[presetId]
      const presetName = preset?.nameEn ?? presetKey

      for (const tier of CUSTOM_BATTLE_UNIT_TIERS) {
        const count = tierCounts[tier] || 0
        if (count <= 0) continue

        const isT4 = tier === 4
        const isT5 = tier === 5
        const profile = isT4 ? T4_UNIT_PROFILES[presetId] : null
        const t5Profile = isT5 ? getT5ProfileForFaction(faction) : null
        const baseLoadout = resolveUnitLoadout(presetId, (tier >= 4 ? 3 : tier) as BaseUnitTier)
        const isCavalry = Boolean(baseLoadout.mountId)

        const mount = isCavalry ? getCustomBattleMount(tier, prng) : null
        const loadout = isT4
          ? resolveT4UnitLoadout(presetId, mount)
          : isT5
            ? resolveT5UnitLoadout(presetId, mount)
            : { ...baseLoadout, mountId: mount }

        const hasRanged = Boolean(loadout.rangedWeaponId)
        const aiType = hasRanged ? AIType.RANGED : AIType.MELEE

        for (let i = 0; i < count; i++) {
          rawUnits.push({
            presetId,
            presetName,
            tier,
            cavalry: isCavalry,
            aiType,
            loadout,
            characterTier: (isT5 ? 5 : isT4 ? 4 : tier) as CharacterTier,
            heroArchetype: isT5 ? 'commander' : isT4 ? (profile?.specialCombatProfile ? 'ranger' : 'captain') : undefined,
            visualAssetId: profile?.visualAssetId ?? t5Profile?.visualAssetId,
            combatProfileId: profile?.combatProfileId ?? t5Profile?.combatProfileId,
            specialCombatProfile: profile?.specialCombatProfile,
          })
        }
      }
    }

    // Assign squads
    return this._assignSquadIds(rawUnits, manualAssignments)
  }

  private static _assignSquadIds(
    units: Array<Omit<PlannedUnitInstance, 'squadId'>>,
    manualAssignments?: readonly SquadAssignment[],
  ): PlannedUnitInstance[] {
    const result: PlannedUnitInstance[] = []
    const unassigned: Array<Omit<PlannedUnitInstance, 'squadId'>> = []

    if (manualAssignments && manualAssignments.length > 0) {
      // Group available units by presetId and tier
      const pool = new Map<string, Array<Omit<PlannedUnitInstance, 'squadId'>>>()
      for (const u of units) {
        const key = `${u.presetId}:${u.tier}`
        const arr = pool.get(key) ?? []
        arr.push(u)
        pool.set(key, arr)
      }

      for (const assignment of manualAssignments) {
        const key = `${assignment.presetId}:${assignment.tier}`
        const arr = pool.get(key) ?? []
        const take = Math.min(arr.length, assignment.count)
        for (let i = 0; i < take; i++) {
          const u = arr.shift()!
          result.push({ ...u, squadId: assignment.squadId })
        }
      }

      // Collect remaining units from pool
      for (const remaining of pool.values()) {
        unassigned.push(...remaining)
      }
    } else {
      unassigned.push(...units)
    }

    // For any unassigned units, auto-distribute across squads (max 50 per squad, max 10 squads)
    if (unassigned.length > 0) {
      // Find current occupancy of squads 1..10
      const squadCounts = new Map<SquadId, number>()
      for (let s = 1; s <= MAX_CUSTOM_BATTLE_COMMAND_SQUADS; s++) {
        squadCounts.set(s as SquadId, 0)
      }
      for (const r of result) {
        squadCounts.set(r.squadId, (squadCounts.get(r.squadId) ?? 0) + 1)
      }

      // Pack unassigned units into squads that have room
      let currentSquadId: SquadId = 1
      for (const u of unassigned) {
        while (currentSquadId <= MAX_CUSTOM_BATTLE_COMMAND_SQUADS && (squadCounts.get(currentSquadId) ?? 0) >= MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE) {
          currentSquadId = (currentSquadId + 1) as SquadId
        }
        if (currentSquadId > MAX_CUSTOM_BATTLE_COMMAND_SQUADS) {
          // Fallback to least loaded squad
          let minSquad: SquadId = 1
          let minCount = Infinity
          for (let s = 1; s <= MAX_CUSTOM_BATTLE_COMMAND_SQUADS; s++) {
            const count = squadCounts.get(s as SquadId) ?? 0
            if (count < minCount) {
              minCount = count
              minSquad = s as SquadId
            }
          }
          currentSquadId = minSquad
        }
        result.push({ ...u, squadId: currentSquadId })
        squadCounts.set(currentSquadId, (squadCounts.get(currentSquadId) ?? 0) + 1)
      }
    }

    return result
  }

  private static _groupIntoSquads(units: PlannedUnitInstance[]): SquadGroup[] {
    const squadMap = new Map<SquadId, PlannedUnitInstance[]>()
    for (const u of units) {
      const arr = squadMap.get(u.squadId) ?? []
      arr.push(u)
      squadMap.set(u.squadId, arr)
    }

    const groups: SquadGroup[] = []
    for (const [squadId, squadUnits] of squadMap.entries()) {
      if (squadUnits.length > 0) {
        groups.push({ squadId, units: squadUnits })
      }
    }
    return groups.sort((a, b) => a.squadId - b.squadId)
  }

  private static _deployFactionRank(
    squads: SquadGroup[],
    rankZ: number,
    characterFaction: CharacterFaction,
    config: BattleConfig,
    mode: 'formation' | 'scattered',
    npcSpecs: NpcSpawnSpec[],
    respawn: boolean,
    obstacles?: ObstacleData[],
    boundsX = 140,
  ): void {
    if (squads.length === 0) return

    const playerFaction = config.playerFaction ?? 'viking'
    const factionAllegiance = allegianceFor(characterFaction, playerFaction)
    const isViking = characterFaction === 'viking'

    const squadCount = Math.min(5, squads.length)
    const squadBlockWidth = mode === 'scattered' ? 24 : 18
    const squadGap = mode === 'scattered' ? 8 : 6
    const squadPitchX = squadBlockWidth + squadGap

    for (let i = 0; i < squadCount; i++) {
      const squad = squads[i]
      const squadCenterX = (i - (squadCount - 1) / 2) * squadPitchX
      const units = squad.units
      const unitCount = units.length
      if (unitCount === 0) continue

      const hasCavalry = units.some(u => u.cavalry)
      const spacingX = hasCavalry ? (mode === 'scattered' ? 4.2 : 3.4) : (mode === 'scattered' ? 2.6 : 1.9)
      const spacingZ = hasCavalry ? (mode === 'scattered' ? 4.2 : 3.4) : (mode === 'scattered' ? 2.6 : 1.9)

      const columns = Math.min(5, unitCount)

      for (let uIdx = 0; uIdx < unitCount; uIdx++) {
        const unit = units[uIdx]
        const col = uIdx % columns
        const row = Math.floor(uIdx / columns)

        const offsetX = (col - (columns - 1) / 2) * spacingX
        // Viking: facing -Z (forward is -Z, backward is +Z)
        // Roman: facing +Z (forward is +Z, backward is -Z)
        const rowOffsetZ = isViking ? row * spacingZ : -row * spacingZ

        let x = squadCenterX + offsetX
        let z = rankZ + rowOffsetZ

        // Clamp inside map horizontal bounds
        x = Math.max(-boundsX + 5, Math.min(boundsX - 5, x))

        // Collision avoidance against static obstacles and trees
        const clearPos = this._findClearPosition(x, z, obstacles, unit.cavalry ? 1.0 : 0.5)
        x = clearPos.x
        z = clearPos.z

        const name = `${characterFaction}_${unit.presetName}_t${unit.tier}_s${unit.squadId}_${uIdx + 1}`

        npcSpecs.push({
          x,
          z,
          characterFaction,
          faction: factionAllegiance,
          aiType: unit.aiType,
          name,
          tier: unit.tier,
          characterTier: unit.characterTier,
          heroArchetype: unit.heroArchetype,
          cavalry: unit.cavalry,
          respawnEnabled: respawn,
          presetId: unit.presetId,
          loadout: unit.loadout,
          visualAssetId: unit.visualAssetId,
          combatProfileId: unit.combatProfileId,
          specialCombatProfile: unit.specialCombatProfile,
          squadId: unit.squadId,
        })
      }
    }
  }

  private static _findClearPosition(
    startX: number,
    startZ: number,
    obstacles: ObstacleData[] | undefined,
    radius: number,
  ): { x: number; z: number } {
    if (!this._isBlocked(startX, startZ, obstacles, radius)) {
      return { x: startX, z: startZ }
    }
    // Search spiral outward for clear ground
    const step = radius * 2
    for (let r = 1; r <= 8; r++) {
      for (const [dx, dz] of [[0, r], [r, 0], [0, -r], [-r, 0], [r, r], [-r, r], [r, -r], [-r, -r]]) {
        const testX = startX + dx * step
        const testZ = startZ + dz * step
        if (!this._isBlocked(testX, testZ, obstacles, radius)) {
          return { x: testX, z: testZ }
        }
      }
    }
    return { x: startX, z: startZ }
  }

  private static _isBlocked(x: number, z: number, obstacles?: ObstacleData[], radius = 0.5): boolean {
    for (const [tx, tz] of TERRAIN_TREE_POSITIONS) {
      if (Math.hypot(x - tx, z - tz) < 3.0 + radius) {
        return true
      }
    }
    if (obstacles) {
      for (const obs of obstacles) {
        if (obs.walkSurface) continue
        const box = obs.box
        if (
          x + radius >= box.min.x &&
          x - radius <= box.max.x &&
          z + radius >= box.min.z &&
          z - radius <= box.max.z
        ) {
          return true
        }
      }
    }
    return false
  }
}
