/**
 * AerialFormationPlanner.ts
 * Dedicated aerial spawn planner for Custom Battle 2.0 Aerial Battle (50 vs 50).
 *
 * Implements:
 * 1. 50 max participants per side (49 AI + 1 player if participating; 50 AI if spectator).
 * 2. All participants mounted on giant eagles (xongkoro).
 * 3. Elevated safe takeoff altitude (spawnY in 35..55m range) with squad-level altitude offsets.
 * 4. Squad-based layout: <= 5 squads in rear rank; > 5 squads in front (1-5) and rear (6-10).
 * 5. Deterministic placement at opposite map edges (Viking South +Z, Roman North -Z).
 * 6. True T1..T5 stats, models, profiles, weapons.
 */
import { AIType } from '../world/NPC'
import {
  BattleConfig,
  CUSTOM_BATTLE_UNIT_TIERS,
  ArmyConfig,
  normalizeArmyConfig,
  MAX_AERIAL_CUSTOM_ARMY_SIZE,
} from './BattleConfig'
import { T4_UNIT_PROFILES, resolveT4UnitLoadout } from './T4HeroCatalog'
import { getT5ProfileForFaction, resolveT5UnitLoadout } from './T5HeroCatalog'
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
import {
  createMulberry32,
  partitionSquadRanks,
  type PlannedUnitInstance,
  type SquadGroup,
} from './SquadFormationPlanner'

export const AERIAL_VIKING_REAR_Z = 160
export const AERIAL_VIKING_FRONT_Z = 120
export const AERIAL_VIKING_PLAYER_Z = 185

export const AERIAL_ROMAN_REAR_Z = -160
export const AERIAL_ROMAN_FRONT_Z = -120
export const AERIAL_ROMAN_PLAYER_Z = -185

export const AERIAL_BASE_ALTITUDE = 35
export const AERIAL_ALTITUDE_STEP = 8

export class AerialFormationPlanner {
  static planAerialBattle(config: BattleConfig): BattleSpawnPlan {
    const seed = config.seed ?? 0x5a6ab7
    createMulberry32(seed)

    const playerFaction = config.playerFaction ?? 'viking'
    const isVikingPlayer = playerFaction === 'viking'
    const isSpectator = Boolean(config.spectator)

    // Player takes 1 slot on friendly side if participating
    const maxVikingAi = !isSpectator && isVikingPlayer ? MAX_AERIAL_CUSTOM_ARMY_SIZE - 1 : MAX_AERIAL_CUSTOM_ARMY_SIZE
    const maxRomanAi = !isSpectator && !isVikingPlayer ? MAX_AERIAL_CUSTOM_ARMY_SIZE - 1 : MAX_AERIAL_CUSTOM_ARMY_SIZE

    // 1. Expand Viking units
    const vikingUnits = this._expandAerialUnits(
      config.viking,
      'viking',
      maxVikingAi,
      isVikingPlayer ? config.squadAssignments : undefined,
    )
    const vikingSquads = this._groupIntoSquads(vikingUnits)
    const vikingPartition = partitionSquadRanks(vikingSquads)

    // 2. Expand Roman units
    const romanUnits = this._expandAerialUnits(
      config.roman,
      'roman',
      maxRomanAi,
      !isVikingPlayer ? config.squadAssignments : undefined,
    )
    const romanSquads = this._groupIntoSquads(romanUnits)
    const romanPartition = partitionSquadRanks(romanSquads)

    // 3. Deploy
    const npcSpecs: NpcSpawnSpec[] = []
    const respawn = config.rules.respawnEnabled ?? false

    // Deploy Viking
    this._deployAerialRank(
      vikingPartition.frontRank,
      AERIAL_VIKING_FRONT_Z,
      'viking',
      config,
      npcSpecs,
      respawn,
      0,
    )
    this._deployAerialRank(
      vikingPartition.rearRank,
      AERIAL_VIKING_REAR_Z,
      'viking',
      config,
      npcSpecs,
      respawn,
      1,
    )

    // Deploy Roman
    this._deployAerialRank(
      romanPartition.frontRank,
      AERIAL_ROMAN_FRONT_Z,
      'roman',
      config,
      npcSpecs,
      respawn,
      0,
    )
    this._deployAerialRank(
      romanPartition.rearRank,
      AERIAL_ROMAN_REAR_Z,
      'roman',
      config,
      npcSpecs,
      respawn,
      1,
    )

    const playerSpawn = {
      x: 0,
      z: isVikingPlayer ? AERIAL_VIKING_PLAYER_Z : AERIAL_ROMAN_PLAYER_Z,
    }

    return {
      playerSpawn,
      npcSpecs,
      pickupSpecs: [],
      horseSpecs: [],
    }
  }

  private static _expandAerialUnits(
    army: ArmyConfig,
    faction: CharacterFaction,
    maxAiTotal: number,
    manualAssignments?: readonly SquadAssignment[],
  ): PlannedUnitInstance[] {
    const normalized = normalizeArmyConfig(army, faction)
    const rawUnits: Array<Omit<PlannedUnitInstance, 'squadId'>> = []
    let totalAdded = 0

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
          if (totalAdded >= maxAiTotal) break
          totalAdded++

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
        if (totalAdded >= maxAiTotal) break
      }
      if (totalAdded >= maxAiTotal) break
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
        while (currentSquadId <= MAX_CUSTOM_BATTLE_COMMAND_SQUADS && (squadCounts.get(currentSquadId) ?? 0) >= MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE) {
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

  private static _deployAerialRank(
    squads: SquadGroup[],
    rankZ: number,
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
    const squadSpacingX = 48
    const eagleSpacingX = 18
    const eagleSpacingZ = 20

    for (let i = 0; i < squadCount; i++) {
      const squad = squads[i]
      const squadCenterX = (i - (squadCount - 1) / 2) * squadSpacingX
      const units = squad.units
      const unitCount = units.length
      if (unitCount === 0) continue

      const columns = Math.min(4, unitCount)
      const altitude = AERIAL_BASE_ALTITUDE + ((i + rankIndex) % 3) * AERIAL_ALTITUDE_STEP

      for (let uIdx = 0; uIdx < unitCount; uIdx++) {
        const unit = units[uIdx]
        const col = uIdx % columns
        const row = Math.floor(uIdx / columns)

        const offsetX = (col - (columns - 1) / 2) * eagleSpacingX
        const rowOffsetZ = isViking ? row * eagleSpacingZ : -row * eagleSpacingZ

        const x = squadCenterX + offsetX
        const z = rankZ + rowOffsetZ

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
