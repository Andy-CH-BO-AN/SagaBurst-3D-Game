/**
 * AerialFormationPlanner.ts
 * Dedicated aerial spawn planner for Custom Battle 2.0 Aerial Battle (50 vs 50).
 *
 * Implements:
 * 1. 50 max participants per side (49 AI + 1 player if participating; 50 AI if spectator).
 * 2. All participants mounted on giant eagles (xongkoro).
 * 3. Elevated safe takeoff altitude (spawnY in 35..55m range) with squad-level altitude offsets.
 * 4. Squad-based layout: <= 5 squads in rear rank; > 5 squads in front (1-5) and rear (6-10).
 * 5. Bounded map edge deployment (strictly within playable bounds |Z| <= 270, |X| <= 220).
 * 6. True T1..T5 stats, models, profiles, weapons.
 * 7. Only archer units are permitted in aerial combat.
 */
import { AIType } from '../world/NPC'
import {
  BattleConfig,
  CUSTOM_BATTLE_UNIT_TIERS,
  ArmyConfig,
  normalizeArmyConfig,
  UnitTier,
} from './BattleConfig'
import { T4_UNIT_PROFILES, resolveT4UnitLoadout } from './T4HeroCatalog'
import { getT5ProfileForPreset, resolveT5UnitLoadout } from './T5HeroCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { CharacterTier } from '../combat/CharacterIdentity'
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
  allegianceFor,
} from './BattleSpawner'

export const AERIAL_BASE_ALTITUDE = 35
export const AERIAL_ALTITUDE_STEP = 10
export const AERIAL_MAP_EDGE_Z = 250
export const AERIAL_PLAYER_OFFSET_Z = 15
export const AERIAL_RANK_GAP = 25

export interface PlannedUnitInstance {
  presetId: UnitPresetId
  presetName: string
  tier: UnitTier
  cavalry: boolean
  aiType: AIType
  loadout: UnitLoadout
  characterTier?: CharacterTier
  heroArchetype?: 'commander' | 'captain' | 'ranger'
  visualAssetId?: import('../world/HeroAssetCatalog').HeroAssetId
  combatProfileId?: import('./HeroCombatProfile').HeroCombatProfileId
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

export class AerialFormationPlanner {
  /**
   * Plans an aerial battle deployment where all units fly on giant eagles (xongkoro).
   */
  static planAerialBattle(config: BattleConfig): BattleSpawnPlan {
    const respawn = config.rules.respawnEnabled ?? false
    const playerFaction: CharacterFaction = config.playerFaction ?? 'viking'
    const isVikingPlayer = playerFaction === 'viking'

    // 1. Expand units (archers only) and assign squad IDs (1..10)
    // Custom Battle squad assignments apply to the player's faction; the enemy faction uses automatic grouping.
    const vikingAssignments = isVikingPlayer ? config.squadAssignments : undefined
    const romanAssignments = !isVikingPlayer ? config.squadAssignments : undefined

    const vikingUnits = this._expandFactionUnits(config.viking, 'viking', vikingAssignments)
    const romanUnits = this._expandFactionUnits(config.roman, 'roman', romanAssignments)

    // 2. Group into squads and partition into front/rear ranks
    const vikingSquads = this._groupIntoSquads(vikingUnits)
    const romanSquads = this._groupIntoSquads(romanUnits)

    const vikingPartition = partitionSquadRanks(vikingSquads)
    const romanPartition = partitionSquadRanks(romanSquads)

    const npcSpecs: NpcSpawnSpec[] = []

    // 3. Compute dynamic rank depths for each faction
    const vikingRearDepth = this._calculateRankDepth(vikingPartition.rearRank)
    const vikingFrontDepth = this._calculateRankDepth(vikingPartition.frontRank)

    const romanRearDepth = this._calculateRankDepth(romanPartition.rearRank)
    const romanFrontDepth = this._calculateRankDepth(romanPartition.frontRank)

    // 4. Calculate Viking rank base Z (South edge: Z > 0, facing -Z)
    // Row 0 has smaller Z; rear row has largest Z (up to AERIAL_MAP_EDGE_Z)
    const vikingRearBaseZ = AERIAL_MAP_EDGE_Z - vikingRearDepth
    const vikingFrontBaseZ = vikingPartition.frontRank.length > 0
      ? vikingRearBaseZ - AERIAL_RANK_GAP - vikingFrontDepth
      : vikingRearBaseZ

    // 5. Calculate Roman rank base Z (North edge: Z < 0, facing +Z)
    // Row 0 has larger Z (closest to center); rear row has most negative Z (down to -AERIAL_MAP_EDGE_Z)
    const romanRearBaseZ = -(AERIAL_MAP_EDGE_Z - romanRearDepth)
    const romanFrontBaseZ = romanPartition.frontRank.length > 0
      ? romanRearBaseZ + AERIAL_RANK_GAP + romanFrontDepth
      : romanRearBaseZ

    // 6. Deploy Viking aerial ranks
    this._deployAerialRank(
      vikingPartition.frontRank,
      vikingFrontBaseZ,
      'viking',
      config,
      npcSpecs,
      respawn,
      0,
    )
    this._deployAerialRank(
      vikingPartition.rearRank,
      vikingRearBaseZ,
      'viking',
      config,
      npcSpecs,
      respawn,
      1,
    )

    // 7. Deploy Roman aerial ranks
    this._deployAerialRank(
      romanPartition.frontRank,
      romanFrontBaseZ,
      'roman',
      config,
      npcSpecs,
      respawn,
      0,
    )
    this._deployAerialRank(
      romanPartition.rearRank,
      romanRearBaseZ,
      'roman',
      config,
      npcSpecs,
      respawn,
      1,
    )

    // 8. Player spawn: behind the friendly rear rank at altitude 35
    const playerZ = isVikingPlayer
      ? AERIAL_MAP_EDGE_Z + AERIAL_PLAYER_OFFSET_Z
      : -(AERIAL_MAP_EDGE_Z + AERIAL_PLAYER_OFFSET_Z)

    const playerSpawn = {
      x: 0,
      y: AERIAL_BASE_ALTITUDE,
      z: playerZ,
    }

    return {
      playerSpawn,
      npcSpecs,
      pickupSpecs: [],
      horseSpecs: [],
    }
  }

  private static _expandFactionUnits(
    army: ArmyConfig,
    faction: CharacterFaction,
    manualAssignments?: readonly SquadAssignment[],
  ): PlannedUnitInstance[] {
    const normalized = normalizeArmyConfig(army, faction)
    const rawUnits: Array<Omit<PlannedUnitInstance, 'squadId'>> = []

    for (const [presetKey, tierCounts] of Object.entries(normalized)) {
      const presetId = presetKey as UnitPresetId
      // In Aerial battle, only archer presets are permitted
      if (!presetId.endsWith('_archer') && presetKey !== 'archer') {
        continue
      }

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

        // Aerial units always ride xongkoro
        const base = isT4
          ? resolveT4UnitLoadout(presetId)
          : isT5
            ? resolveT5UnitLoadout(presetId)
            : baseLoadout

        const loadout: UnitLoadout = {
          ...base,
          mountId: 'xongkoro',
          shieldId: null,
        }

        const hasRanged = Boolean(loadout.rangedWeaponId)
        const aiType = hasRanged ? AIType.RANGED : AIType.MELEE

        for (let i = 0; i < count; i++) {
          rawUnits.push({
            presetId,
            presetName,
            tier,
            cavalry: true,
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

    return this._assignSquadIds(rawUnits, manualAssignments)
  }

  private static _assignSquadIds(
    units: Array<Omit<PlannedUnitInstance, 'squadId'>>,
    manualAssignments?: readonly SquadAssignment[],
  ): PlannedUnitInstance[] {
    const result: PlannedUnitInstance[] = []
    const unassigned: Array<Omit<PlannedUnitInstance, 'squadId'>> = []

    if (manualAssignments && manualAssignments.length > 0) {
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

      for (const remaining of pool.values()) {
        unassigned.push(...remaining)
      }
    } else {
      unassigned.push(...units)
    }

    if (unassigned.length > 0) {
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

  private static _calculateRankDepth(squads: SquadGroup[]): number {
    if (squads.length === 0) return 0
    let maxDepth = 0
    const eagleSpacingZ = 16
    for (const squad of squads) {
      const unitCount = squad.units.length
      if (unitCount === 0) continue
      const columns = Math.min(10, Math.max(5, Math.ceil(Math.sqrt(unitCount * 2.0))))
      const rows = Math.ceil(unitCount / columns)
      const depth = Math.max(0, (rows - 1) * eagleSpacingZ)
      if (depth > maxDepth) maxDepth = depth
    }
    return maxDepth
  }

  private static _deployAerialRank(
    squads: SquadGroup[],
    rankBaseZ: number,
    characterFaction: CharacterFaction,
    config: BattleConfig,
    npcSpecs: NpcSpawnSpec[],
    respawn: boolean,
    rankIndex: number,
  ): void {
    if (squads.length === 0) return

    const playerFaction = config.playerFaction ?? 'viking'
    const factionAllegiance = allegianceFor(characterFaction, playerFaction)
    const isViking = characterFaction === 'viking'

    const squadCount = Math.min(5, squads.length)
    const eagleSpacingX = 14
    const eagleSpacingZ = 16
    const squadGap = 16

    // Compute width for each squad
    const squadWidths: number[] = []
    for (let i = 0; i < squadCount; i++) {
      const unitCount = squads[i].units.length
      const columns = Math.min(10, Math.max(5, Math.ceil(Math.sqrt(unitCount * 2.0))))
      squadWidths.push(Math.max(1, (columns - 1) * eagleSpacingX))
    }

    const totalWidth = squadWidths.reduce((sum, w) => sum + w, 0) + (squadCount - 1) * squadGap
    let currentX = -totalWidth / 2

    for (let i = 0; i < squadCount; i++) {
      const squad = squads[i]
      const units = squad.units
      const unitCount = units.length
      if (unitCount === 0) continue

      const columns = Math.min(10, Math.max(5, Math.ceil(Math.sqrt(unitCount * 2.0))))
      const altitude = AERIAL_BASE_ALTITUDE + ((i + rankIndex) % 3) * AERIAL_ALTITUDE_STEP

      const sWidth = squadWidths[i]
      const squadCenterX = currentX + sWidth / 2
      currentX += sWidth + squadGap

      for (let uIdx = 0; uIdx < unitCount; uIdx++) {
        const unit = units[uIdx]
        const col = uIdx % columns
        const row = Math.floor(uIdx / columns)

        const offsetX = (col - (columns - 1) / 2) * eagleSpacingX
        // Viking faces North (-Z), row offset pushes further South (+Z)
        // Roman faces South (+Z), row offset pushes further North (-Z)
        const rowOffsetZ = isViking ? row * eagleSpacingZ : -row * eagleSpacingZ

        const x = squadCenterX + offsetX
        const z = rankBaseZ + rowOffsetZ

        const name = `${characterFaction}_aerial_${unit.presetName}_t${unit.tier}_s${unit.squadId}_${uIdx + 1}`

        npcSpecs.push({
          x,
          spawnY: altitude,
          z,
          characterFaction,
          faction: factionAllegiance,
          aiType: unit.aiType,
          name,
          tier: unit.tier,
          characterTier: unit.characterTier,
          heroArchetype: unit.heroArchetype,
          cavalry: true,
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
}
