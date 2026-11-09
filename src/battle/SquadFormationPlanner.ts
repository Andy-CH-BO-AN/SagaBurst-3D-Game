/**
 * SquadFormationPlanner.ts
 * Pure deterministic squad-based formation planner for Custom Battle 2.0 (Ground Battle 300v300).
 *
 * Implements:
 * 1. 10 squads max, 50 units max per squad.
 * 2. <= 5 squads: ALL in Rear Rank (Front Rank completely empty).
 * 3. > 5 squads: squads 1..5 in Front Rank, squads 6..10 in Rear Rank.
 * 4. Squads arranged side-by-side horizontally, centered along X.
 * 5. Deployment at opposite map edges facing each other:
 *    - Viking South (Z > 0) facing North (-Z)
 *    - Roman North (Z < 0) facing South (+Z)
 * 6. Dynamic depth calculation: ensures front/rear ranks and player never overlap.
 * 7. Safe mounted footprints (>= 4.2m center-to-center for cavalry).
 * 8. Comprehensive occupancy tracking and tree/obstacle avoidance (never returns blocked coordinate).
 * 9. Individual deterministic mount allocation per NPC for T4/T5 cavalry.
 * 10. Reusable deployment zones for all 5 ground maps.
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
import { getT5ProfileForPreset, resolveT5UnitLoadout, getCustomBattleMount } from './T5HeroCatalog'
import type { HeroCombatProfileId } from './HeroCombatProfile'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { CharacterTier, HeroArchetype } from '../combat/CharacterIdentity'
import {
  UNIT_PRESETS,
  fixedUnitMount,
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
  BattleSpawner,
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
  /** Maximum army edge Z (furthest friendly line) before player offset */
  edgeZ: number
  /** Horizontal bounds limit for deployment */
  boundsX: number
  /** Buffer gap between front rank and rear rank */
  rankGap: number
  /** Distance behind the rear rank where player safely spawns */
  playerOffset: number
}

export function getMapDeploymentZones(mapId: CustomBattleMapId = 'original'): MapDeploymentZone {
  switch (mapId) {
    case 'bridge':
      // River crossing: river is |Z| <= 24.
      // South Bank (Viking) extends to +250; North Bank (Roman) extends to -250.
      return {
        edgeZ: 220,
        boundsX: 130,
        rankGap: 20,
        playerOffset: 12,
      }
    case 'roman_town':
    case 'viking_town':
      // Town city walls are at minZ = -115, maxZ = 100.
      // Outside south wall is Z in [140, 250]; outside north wall is Z in [-250, -140].
      return {
        edgeZ: 225,
        boundsX: 140,
        rankGap: 20,
        playerOffset: 12,
      }
    case 'snow':
    case 'original':
    default:
      // Open battlefield: playable bounds [-280, 280].
      return {
        edgeZ: 250,
        boundsX: 180,
        rankGap: 20,
        playerOffset: 12,
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

interface OccupiedFootprint {
  x: number
  z: number
  radius: number
}

export class SquadFormationPlanner {
  /**
   * Plans a complete squad-based formation for custom battle.
   */
  static planCustomBattle(config: BattleConfig, obstacles?: ObstacleData[]): BattleSpawnPlan {
    const prng = createMulberry32(config.seed ?? 0x5a6ab7)
    const mode = config.mode ?? 'formation'
    const mapId = config.mapId ?? 'original'
    const zones = getMapDeploymentZones(mapId)
    const respawn = config.rules.respawnEnabled ?? false
    const playerFaction: CharacterFaction = config.playerFaction ?? 'viking'
    const isVikingPlayer = playerFaction === 'viking'

    // 1. Expand all units and assign squad IDs (1..10)
    // Custom Battle squad assignments apply to the player's faction; the enemy faction uses automatic grouping.
    const vikingAssignments = isVikingPlayer ? config.squadAssignments : undefined
    const romanAssignments = !isVikingPlayer ? config.squadAssignments : undefined

    const vikingUnits = this._expandFactionUnits(config.viking, 'viking', prng, vikingAssignments)
    const romanUnits = this._expandFactionUnits(config.roman, 'roman', prng, romanAssignments)

    // 2. Group into squads and partition into front/rear ranks
    const vikingSquads = this._groupIntoSquads(vikingUnits)
    const romanSquads = this._groupIntoSquads(romanUnits)

    const vikingPartition = partitionSquadRanks(vikingSquads)
    const romanPartition = partitionSquadRanks(romanSquads)

    const npcSpecs: NpcSpawnSpec[] = []
    const occupied: OccupiedFootprint[] = []

    // 3. Compute dynamic rank depths for each faction
    const vikingRearDepth = this._calculateRankDepth(vikingPartition.rearRank, mode)
    const vikingFrontDepth = this._calculateRankDepth(vikingPartition.frontRank, mode)

    const romanRearDepth = this._calculateRankDepth(romanPartition.rearRank, mode)
    const romanFrontDepth = this._calculateRankDepth(romanPartition.frontRank, mode)

    // 4. Calculate Viking rank base Z (South edge: Z > 0, facing -Z)
    // Row 0 has smaller Z; rear row has largest Z (up to edgeZ)
    const vikingRearBaseZ = zones.edgeZ - vikingRearDepth
    const vikingFrontBaseZ = vikingPartition.frontRank.length > 0
      ? vikingRearBaseZ - zones.rankGap - vikingFrontDepth
      : vikingRearBaseZ

    // 5. Calculate Roman rank base Z (North edge: Z < 0, facing +Z)
    // Row 0 has larger Z (closest to center); rear row has most negative Z (down to -edgeZ)
    const romanRearBaseZ = -(zones.edgeZ - romanRearDepth)
    const romanFrontBaseZ = romanPartition.frontRank.length > 0
      ? romanRearBaseZ + zones.rankGap + romanFrontDepth
      : romanRearBaseZ

    // Corridors ensuring ranks and player never overlap
    const hasVikingFront = vikingPartition.frontRank.length > 0
    const vikingFrontMinZ = vikingFrontBaseZ - 10
    const vikingFrontMaxZ = vikingRearBaseZ - 6
    const vikingRearMinZ = hasVikingFront ? vikingRearBaseZ - 4 : vikingRearBaseZ - 20
    const vikingRearMaxZ = zones.edgeZ + 4

    const hasRomanFront = romanPartition.frontRank.length > 0
    const romanFrontMinZ = romanRearBaseZ + 6
    const romanFrontMaxZ = romanFrontBaseZ + 10
    const romanRearMinZ = -(zones.edgeZ + 4)
    const romanRearMaxZ = hasRomanFront ? romanRearBaseZ + 4 : romanRearBaseZ + 20

    // 6. Deploy Viking ranks (Front first, then Rear)
    this._deployFactionRank(
      vikingPartition.frontRank,
      vikingFrontBaseZ,
      'viking',
      config,
      mode,
      npcSpecs,
      respawn,
      obstacles,
      occupied,
      zones.boundsX,
      vikingFrontMinZ,
      vikingFrontMaxZ,
    )
    this._deployFactionRank(
      vikingPartition.rearRank,
      vikingRearBaseZ,
      'viking',
      config,
      mode,
      npcSpecs,
      respawn,
      obstacles,
      occupied,
      zones.boundsX,
      vikingRearMinZ,
      vikingRearMaxZ,
    )

    // 7. Deploy Roman ranks (Front first, then Rear)
    this._deployFactionRank(
      romanPartition.frontRank,
      romanFrontBaseZ,
      'roman',
      config,
      mode,
      npcSpecs,
      respawn,
      obstacles,
      occupied,
      zones.boundsX,
      romanFrontMinZ,
      romanFrontMaxZ,
    )
    this._deployFactionRank(
      romanPartition.rearRank,
      romanRearBaseZ,
      'roman',
      config,
      mode,
      npcSpecs,
      respawn,
      obstacles,
      occupied,
      zones.boundsX,
      romanRearMinZ,
      romanRearMaxZ,
    )

    // 8. Player spawn: safely behind their army's rear rank, at map edge
    const playerTargetZ = isVikingPlayer
      ? zones.edgeZ + zones.playerOffset
      : -(zones.edgeZ + zones.playerOffset)
    const playerMinZ = isVikingPlayer ? zones.edgeZ + 4 : -(zones.edgeZ + zones.playerOffset + 15)
    const playerMaxZ = isVikingPlayer ? zones.edgeZ + zones.playerOffset + 15 : -(zones.edgeZ + 4)
    const playerPos = this._findClearPosition(
      0,
      playerTargetZ,
      obstacles,
      occupied,
      1.0,
      zones.boundsX,
      playerMinZ,
      playerMaxZ,
      'player',
    )
    occupied.push({ x: playerPos.x, z: playerPos.z, radius: 1.0 })
    const playerSpawn = {
      x: playerPos.x,
      z: playerPos.z,
    }

    // 9. Camps / pick-ups / horses
    const pickupSpecs: CampPickupSpec[] = []
    const horseSpecs: CampHorseSpec[] = []
    if (config.rules.includeCamps && mapId === 'original') {
      pickupSpecs.push(...BattleSpawner.generateCampPickups('viking'))
      pickupSpecs.push(...BattleSpawner.generateCampPickups('roman'))
      horseSpecs.push(...BattleSpawner.generateCampHorses('viking'))
      horseSpecs.push(...BattleSpawner.generateCampHorses('roman'))
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
        const t5Profile = isT5 ? getT5ProfileForPreset(presetId, faction) : null
        const baseLoadout = resolveUnitLoadout(presetId, (tier >= 4 ? 3 : tier) as BaseUnitTier)
        const isCavalry = Boolean(baseLoadout.mountId)

        // Generate loadout per individual NPC to ensure proper random mount draw
        for (let i = 0; i < count; i++) {
          const mount = isCavalry ? fixedUnitMount(presetId) ?? getCustomBattleMount(tier, prng) : null
          const loadout = isT4
            ? resolveT4UnitLoadout(presetId, mount)
            : isT5
              ? resolveT5UnitLoadout(presetId, mount)
              : { ...baseLoadout, mountId: mount }

          const hasRanged = Boolean(loadout.rangedWeaponId)
          const aiType = hasRanged ? AIType.RANGED : AIType.MELEE

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

    if (unassigned.length > 0) {
      // Automatic balanced distribution
      const squadCounts = new Map<SquadId, number>()
      for (let s = 1; s <= MAX_CUSTOM_BATTLE_COMMAND_SQUADS; s++) {
        squadCounts.set(s as SquadId, 0)
      }
      for (const r of result) {
        squadCounts.set(r.squadId, (squadCounts.get(r.squadId) ?? 0) + 1)
      }

      let currentSquadId: SquadId = 1
      for (const u of unassigned) {
        while (
          currentSquadId <= MAX_CUSTOM_BATTLE_COMMAND_SQUADS &&
          (squadCounts.get(currentSquadId) ?? 0) >= MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE
        ) {
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

  private static _calculateRankDepth(squads: SquadGroup[], mode: 'formation' | 'scattered'): number {
    if (squads.length === 0) return 0
    let maxDepth = 0
    for (const squad of squads) {
      const unitCount = squad.units.length
      if (unitCount === 0) continue
      const hasCavalry = squad.units.some(u => u.cavalry)
      const spacingZ = hasCavalry ? (mode === 'scattered' ? 5.5 : 4.5) : (mode === 'scattered' ? 3.2 : 2.4)
      const columns = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(unitCount * 1.2))))
      const rows = Math.ceil(unitCount / columns)
      const depth = Math.max(0, (rows - 1) * spacingZ)
      if (depth > maxDepth) maxDepth = depth
    }
    return maxDepth
  }

  private static _deployFactionRank(
    squads: SquadGroup[],
    rankBaseZ: number,
    characterFaction: CharacterFaction,
    config: BattleConfig,
    mode: 'formation' | 'scattered',
    npcSpecs: NpcSpawnSpec[],
    respawn: boolean,
    obstacles: ObstacleData[] | undefined,
    occupied: OccupiedFootprint[],
    boundsX: number,
    minZ: number,
    maxZ: number,
  ): void {
    if (squads.length === 0) return

    const playerFaction = config.playerFaction ?? 'viking'
    const factionAllegiance = allegianceFor(characterFaction, playerFaction)
    const isViking = characterFaction === 'viking'

    const squadCount = Math.min(5, squads.length)
    const squadGap = mode === 'scattered' ? 10 : 8

    // Measure each squad width
    const squadWidths: number[] = []
    for (let i = 0; i < squadCount; i++) {
      const units = squads[i].units
      const unitCount = units.length
      const hasCavalry = units.some(u => u.cavalry)
      const spacingX = hasCavalry ? (mode === 'scattered' ? 5.2 : 4.2) : (mode === 'scattered' ? 3.2 : 2.4)
      const columns = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(unitCount * 1.2))))
      squadWidths.push(Math.max(1, (columns - 1) * spacingX))
    }

    const totalWidth = squadWidths.reduce((sum, w) => sum + w, 0) + (squadCount - 1) * squadGap
    let currentX = -totalWidth / 2

    for (let i = 0; i < squadCount; i++) {
      const squad = squads[i]
      const units = squad.units
      const unitCount = units.length
      if (unitCount === 0) continue

      const hasCavalry = units.some(u => u.cavalry)
      const spacingX = hasCavalry ? (mode === 'scattered' ? 5.2 : 4.2) : (mode === 'scattered' ? 3.2 : 2.4)
      const spacingZ = hasCavalry ? (mode === 'scattered' ? 5.5 : 4.5) : (mode === 'scattered' ? 3.2 : 2.4)
      const footRadius = hasCavalry ? 2.1 : 1.1

      const columns = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(unitCount * 1.2))))
      const sWidth = squadWidths[i]
      const squadCenterX = currentX + sWidth / 2
      currentX += sWidth + squadGap

      for (let uIdx = 0; uIdx < unitCount; uIdx++) {
        const unit = units[uIdx]
        const col = uIdx % columns
        const row = Math.floor(uIdx / columns)

        const offsetX = (col - (columns - 1) / 2) * spacingX
        // Viking faces North (-Z), row offset pushes further South (+Z)
        // Roman faces South (+Z), row offset pushes further North (-Z)
        const rowOffsetZ = isViking ? row * spacingZ : -row * spacingZ

        let x = squadCenterX + offsetX
        let z = rankBaseZ + rowOffsetZ
        const name = `${characterFaction}_${unit.presetName}_t${unit.tier}_s${unit.squadId}_${uIdx + 1}`

        // Find clear non-overlapping position
        const clearPos = this._findClearPosition(
          x,
          z,
          obstacles,
          occupied,
          footRadius,
          boundsX,
          minZ,
          maxZ,
          name,
        )
        x = clearPos.x
        z = clearPos.z

        occupied.push({ x, z, radius: footRadius })

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
    occupied: OccupiedFootprint[],
    radius: number,
    boundsX: number,
    minZ: number,
    maxZ: number,
    unitName: string,
  ): { x: number; z: number } {
    const xMin = -boundsX + 5
    const xMax = boundsX - 5
    const clampedX = Math.max(xMin, Math.min(xMax, startX))
    const clampedZ = Math.max(minZ, Math.min(maxZ, startZ))

    if (!this._isBlocked(clampedX, clampedZ, obstacles, occupied, radius)) {
      return { x: clampedX, z: clampedZ }
    }

    const step = Math.max(2.0, radius * 1.5)

    // 1. Outward spiral search around (clampedX, clampedZ)
    for (let r = 1; r <= 35; r++) {
      const ringDeltas = [
        [0, r], [r, 0], [0, -r], [-r, 0],
        [r, r], [-r, r], [r, -r], [-r, -r],
        [r * 0.5, r], [-r * 0.5, r], [r * 0.5, -r], [-r * 0.5, -r],
        [r, r * 0.5], [-r, r * 0.5], [r, -r * 0.5], [-r, -r * 0.5],
      ]
      for (const [dx, dz] of ringDeltas) {
        const testX = clampedX + dx * step
        const testZ = clampedZ + dz * step
        if (testX >= xMin && testX <= xMax && testZ >= minZ && testZ <= maxZ) {
          if (!this._isBlocked(testX, testZ, obstacles, occupied, radius)) {
            return { x: testX, z: testZ }
          }
        }
      }
    }

    // 2. Systematic corridor grid scan within [xMin, xMax] x [minZ, maxZ]
    const zSpan = Math.max(maxZ - clampedZ, clampedZ - minZ)
    for (let deltaZ = 0; deltaZ <= zSpan; deltaZ += step) {
      for (const sign of [1, -1]) {
        const testZ = clampedZ + sign * deltaZ
        if (testZ < minZ || testZ > maxZ) continue
        for (let testX = xMin; testX <= xMax; testX += step) {
          if (!this._isBlocked(testX, testZ, obstacles, occupied, radius)) {
            return { x: testX, z: testZ }
          }
        }
      }
    }

    // 3. Fail-closed: Never return a blocked or unverified coordinate
    throw new Error(
      `Unable to find safe non-overlapping deployment position for ${unitName} within deployment zone bounds ` +
      `(x in [${xMin}, ${xMax}], z in [${minZ}, ${maxZ}]). All candidate positions are blocked or occupied.`
    )
  }

  private static _isBlocked(
    x: number,
    z: number,
    obstacles: ObstacleData[] | undefined,
    occupied: OccupiedFootprint[],
    radius: number,
  ): boolean {
    // 1. Check existing placed units
    for (const occ of occupied) {
      const minDist = radius + occ.radius
      if (Math.hypot(x - occ.x, z - occ.z) < minDist) {
        return true
      }
    }

    // 2. Check terrain trees
    for (const [tx, tz] of TERRAIN_TREE_POSITIONS) {
      if (Math.hypot(x - tx, z - tz) < 3.2 + radius) {
        return true
      }
    }

    // 3. Check world obstacles
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
