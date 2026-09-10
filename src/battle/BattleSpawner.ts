/**
 * BattleSpawner.ts
 * Pure deterministic formation calculation and spawn plan generation.
 * Generates bounded, non-overlapping coordinates for armies, camp armories, and camp horses.
 */
import { Faction, AIType } from '../world/NPC'
import {
  BattleConfig,
  BattleUnitType,
  UnitTier,
  ArmyConfig,
} from './BattleConfig'

export interface NpcSpawnSpec {
  x: number
  z: number
  faction: Faction
  aiType: AIType
  name: string
  tier: UnitTier
  cavalry: boolean
  respawnEnabled: boolean
}

export interface CampPickupSpec {
  weaponId: string
  x: number
  z: number
  isArrowPack?: boolean
  arrowQuantity?: number
}

export interface CampHorseSpec {
  x: number
  z: number
  stableKey: string
}

export const VIKING_PLAYER_SPAWN = { x: 0, z: 80.8 }
export const PLAYER_SAFE_CLEARANCE = 2.0

export interface BattleSpawnPlan {
  npcSpecs: NpcSpawnSpec[]
  pickupSpecs: CampPickupSpec[]
  horseSpecs: CampHorseSpec[]
}

interface UnitInstance {
  type: BattleUnitType
  tier: UnitTier
  index: number
}

export class BattleSpawner {
  /**
   * Generates a complete deterministic spawn plan from BattleConfig.
   */
  static createSpawnPlan(config: BattleConfig): BattleSpawnPlan {
    const respawn = config.rules.respawnEnabled ?? false
    const npcSpecs: NpcSpawnSpec[] = [
      ...this._generateArmySpecs(config.viking, Faction.PLAYER, respawn),
      ...this._generateArmySpecs(config.roman, Faction.ENEMY, respawn),
    ]

    const pickupSpecs: CampPickupSpec[] = []
    const horseSpecs: CampHorseSpec[] = []

    if (config.rules.includeCamps) {
      pickupSpecs.push(...this._generateCampPickups(Faction.PLAYER))
      pickupSpecs.push(...this._generateCampPickups(Faction.ENEMY))
      horseSpecs.push(...this._generateCampHorses(Faction.PLAYER))
      horseSpecs.push(...this._generateCampHorses(Faction.ENEMY))
    }

    return {
      npcSpecs,
      pickupSpecs,
      horseSpecs,
    }
  }

  private static _expandArmy(army: ArmyConfig): {
    infantry: UnitInstance[]
    archer: UnitInstance[]
    cavalry: UnitInstance[]
    horseArcher: UnitInstance[]
  } {
    const expand = (type: BattleUnitType): UnitInstance[] => {
      const list: UnitInstance[] = []
      const counts = army[type]
      let idx = 1
      for (const tier of [1, 2, 3] as UnitTier[]) {
        const count = counts[tier] || 0
        for (let i = 0; i < count; i++) {
          list.push({ type, tier, index: idx++ })
        }
      }
      return list
    }

    return {
      infantry: expand('infantry'),
      archer: expand('archer'),
      cavalry: expand('cavalry'),
      horseArcher: expand('horseArcher'),
    }
  }

  /**
   * Calculates deterministic coordinates in bounded staging area.
   * Safe bounds:
   *   |X| <= 35
   *   68 <= |Z| <= 82
   *   Camp starts at |Z| >= 84
   */
  private static _generateArmySpecs(
    army: ArmyConfig,
    faction: Faction,
    respawnEnabled: boolean
  ): NpcSpawnSpec[] {
    const isViking = faction === Faction.PLAYER
    const zSign = isViking ? 1 : -1
    const prefix = isViking ? 'Viking' : 'Roman'
    const units = this._expandArmy(army)
    const specs: NpcSpawnSpec[] = []

    // ── 1. Infantry Formation (Center Frontline) ──
    const infPerRow = 10
    const infSpacingX = 2.4
    const infRowSpacingZ = 2.2
    const infStartOffsetZ = 68.0

    let infRowCount = 0
    if (units.infantry.length > 0) {
      infRowCount = Math.ceil(units.infantry.length / infPerRow)
      for (let i = 0; i < units.infantry.length; i++) {
        const u = units.infantry[i]
        const row = Math.floor(i / infPerRow)
        const col = i % infPerRow
        const countInRow = Math.min(infPerRow, units.infantry.length - row * infPerRow)
        let x = (col - (countInRow - 1) / 2) * infSpacingX
        const z = (infStartOffsetZ + row * infRowSpacingZ) * zSign

        if (isViking && Math.hypot(x - VIKING_PLAYER_SPAWN.x, z - VIKING_PLAYER_SPAWN.z) < PLAYER_SAFE_CLEARANCE) {
          x = x >= 0 ? x + PLAYER_SAFE_CLEARANCE : x - PLAYER_SAFE_CLEARANCE
        }
        specs.push({
          x: Math.round(x * 100) / 100,
          z: Math.round(z * 100) / 100,
          faction,
          aiType: AIType.MELEE,
          name: `${prefix} T${u.tier} Infantry ${u.index}`,
          tier: u.tier,
          cavalry: false,
          respawnEnabled,
        })
      }
    }

    // ── 2. Archer Formation (Center Backline) ──
    const archPerRow = 10
    const archSpacingX = 2.6
    const archRowSpacingZ = 2.2
    const archBaseZ = units.infantry.length > 0
      ? infStartOffsetZ + infRowCount * infRowSpacingZ + 1.2
      : 68.0

    for (let i = 0; i < units.archer.length; i++) {
      const u = units.archer[i]
      const row = Math.floor(i / archPerRow)
      const col = i % archPerRow
      const countInRow = Math.min(archPerRow, units.archer.length - row * archPerRow)
      let x = (col - (countInRow - 1) / 2) * archSpacingX
      const z = (archBaseZ + row * archRowSpacingZ) * zSign

      if (isViking && Math.hypot(x - VIKING_PLAYER_SPAWN.x, z - VIKING_PLAYER_SPAWN.z) < PLAYER_SAFE_CLEARANCE) {
        x = x >= 0 ? x + PLAYER_SAFE_CLEARANCE : x - PLAYER_SAFE_CLEARANCE
      }
      specs.push({
        x: Math.round(x * 100) / 100,
        z: Math.round(z * 100) / 100,
        faction,
        aiType: AIType.RANGED,
        name: `${prefix} T${u.tier} Archer ${u.index}`,
        tier: u.tier,
        cavalry: false,
        respawnEnabled,
      })
    }

    // ── 3. Cavalry & Horse Archer Formation (Bounded Wings) ──
    const maxColPerWing = 4
    const wingSpacingX = 2.2
    const wingSpacingZ = 2.1
    const startZ = 68.0

    const maxFootHalfWidth = units.archer.length > 0 ? 11.7 : units.infantry.length > 0 ? 10.8 : 4.0
    const cavalryBaseX = Math.max(14.0, maxFootHalfWidth + 2.4)
    const hasCavalry = units.cavalry.length > 0
    const horseArcherBaseX = hasCavalry
      ? cavalryBaseX + maxColPerWing * wingSpacingX + 2.0
      : cavalryBaseX

    const placeWingUnits = (
      unitList: UnitInstance[],
      wingBaseX: number,
      aiType: AIType,
      unitLabel: string
    ) => {
      for (let i = 0; i < unitList.length; i++) {
        const u = unitList[i]
        const wingSign = (i % 2 === 0) ? -1 : 1
        const wingIndex = Math.floor(i / 2)
        const row = Math.floor(wingIndex / maxColPerWing)
        const col = wingIndex % maxColPerWing

        const x = (wingBaseX + col * wingSpacingX) * wingSign
        const z = (startZ + row * wingSpacingZ) * zSign

        specs.push({
          x: Math.round(x * 100) / 100,
          z: Math.round(z * 100) / 100,
          faction,
          aiType,
          name: `${prefix} T${u.tier} ${unitLabel} ${u.index}`,
          tier: u.tier,
          cavalry: true,
          respawnEnabled,
        })
      }
    }

    placeWingUnits(units.cavalry, cavalryBaseX, AIType.MELEE, 'Lancer')
    placeWingUnits(units.horseArcher, horseArcherBaseX, AIType.RANGED, 'Horse Archer')

    return specs
  }

  private static _generateCampPickups(faction: Faction): CampPickupSpec[] {
    const isViking = faction === Faction.PLAYER
    const z = (isViking ? 84.0 : -84.0)
    const pickups: CampPickupSpec[] = []

    if (isViking) {
      const items: Array<{ id: string; isArrow?: boolean }> = [
        { id: 'rusty_dagger' },
        { id: 'steel_sword' },
        { id: 'runic_greatsword' },
        { id: 'wooden_shortbow' },
        { id: 'recurve_longbow' },
        { id: 'elven_runebow' },
        { id: 'round_shield_t1' },
        { id: 'round_shield_t2' },
        { id: 'round_shield_t3' },
        { id: 'steel_lance' },
        { id: '', isArrow: true },
      ]
      const spacing = 1.8
      const startX = -((items.length - 1) * spacing) / 2
      items.forEach((item, idx) => {
        pickups.push({
          weaponId: item.id,
          x: Math.round((startX + idx * spacing) * 100) / 100,
          z,
          isArrowPack: item.isArrow,
          arrowQuantity: 20,
        })
      })
    } else {
      // Roman Camp (Player compatible weapons: Shields, Swords, Lance, Bows & Arrows)
      const items: Array<{ id: string; isArrow?: boolean }> = [
        { id: 'scutum_t1' },
        { id: 'scutum_t2' },
        { id: 'scutum_t3' },
        { id: 'steel_sword' },
        { id: 'steel_lance' },
        { id: 'rusty_dagger' },
        { id: 'runic_greatsword' },
        { id: 'wooden_shortbow' },
        { id: 'recurve_longbow' },
        { id: 'elven_runebow' },
        { id: '', isArrow: true },
      ]
      const spacing = 1.8
      const startX = -((items.length - 1) * spacing) / 2
      items.forEach((item, idx) => {
        pickups.push({
          weaponId: item.id,
          x: Math.round((startX + idx * spacing) * 100) / 100,
          z,
          isArrowPack: item.isArrow,
          arrowQuantity: 20,
        })
      })
    }

    return pickups
  }

  private static _generateCampHorses(faction: Faction): CampHorseSpec[] {
    const isViking = faction === Faction.PLAYER
    const z = (isViking ? 88.0 : -88.0)
    const prefix = isViking ? 'viking' : 'roman'
    const horses: CampHorseSpec[] = []
    const spacing = 3.2
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * spacing
      horses.push({
        x: Math.round(x * 100) / 100,
        z,
        stableKey: `camp:${prefix}:horse:${i + 1}`,
      })
    }
    return horses
  }
}
