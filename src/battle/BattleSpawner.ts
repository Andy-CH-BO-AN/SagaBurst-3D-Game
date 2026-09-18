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

export const BATTLE_FRONTLINE_Z = 125.0
export const VIKING_PLAYER_SPAWN = { x: 0, z: 145.0 }
export const CAMP_PICKUP_Z = 151.0
export const CAMP_HORSE_Z = 158.0
export const PLAYER_SAFE_CLEARANCE = 2.0

export const SCATTER_BOUND_MIN = -140.0
export const SCATTER_BOUND_MAX = 140.0
export const SCATTER_BASE_SEED = 0x5a6ab7
export const PLAYER_SCATTERED_CLEARANCE = 5.0

const TREE_OBSTACLES = [
  { x: 18, z: -22 },
  { x: -28, z: 18 },
  { x: 40, z: -5 },
  { x: -12, z: 35 },
  { x: 25, z: 15 },
]
const TREE_EXCLUSION_RADIUS = 3.0

function createMulberry32(seed: number = SCATTER_BASE_SEED) {
  let s = seed >>> 0
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface BattleSpawnPlan {
  playerSpawn: { x: number; z: number }
  npcSpecs: NpcSpawnSpec[]
  pickupSpecs: CampPickupSpec[]
  horseSpecs: CampHorseSpec[]
}

interface UnitInstance {
  type: BattleUnitType
  tier: UnitTier
  index: number
}

interface PendingNpc {
  faction: Faction
  aiType: AIType
  name: string
  tier: UnitTier
  cavalry: boolean
  respawnEnabled: boolean
}

export class BattleSpawner {
  /**
   * Generates a complete deterministic spawn plan from BattleConfig.
   */
  static createSpawnPlan(config: BattleConfig): BattleSpawnPlan {
    const mode = config.mode ?? 'formation'
    if (mode === 'scattered') {
      return this._generateScatteredPlan(config)
    }
    return this._generateFormationPlan(config)
  }

  private static _generateFormationPlan(config: BattleConfig): BattleSpawnPlan {
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
      playerSpawn: { x: VIKING_PLAYER_SPAWN.x, z: VIKING_PLAYER_SPAWN.z },
      npcSpecs,
      pickupSpecs,
      horseSpecs,
    }
  }

  private static _generateScatteredPlan(config: BattleConfig): BattleSpawnPlan {
    const respawn = config.rules.respawnEnabled ?? false
    const vikingExpanded = this._expandArmy(config.viking)
    const romanExpanded = this._expandArmy(config.roman)

    const buildPending = (expanded: ReturnType<typeof BattleSpawner._expandArmy>, faction: Faction): PendingNpc[] => {
      const isViking = faction === Faction.PLAYER
      const prefix = isViking ? 'Viking' : 'Roman'
      const list: PendingNpc[] = []

      for (const u of expanded.infantry) {
        list.push({
          faction,
          aiType: AIType.MELEE,
          name: `${prefix} T${u.tier} Infantry ${u.index}`,
          tier: u.tier,
          cavalry: false,
          respawnEnabled: respawn,
        })
      }
      for (const u of expanded.archer) {
        list.push({
          faction,
          aiType: AIType.RANGED,
          name: `${prefix} T${u.tier} Archer ${u.index}`,
          tier: u.tier,
          cavalry: false,
          respawnEnabled: respawn,
        })
      }
      for (const u of expanded.cavalry) {
        list.push({
          faction,
          aiType: AIType.MELEE,
          name: `${prefix} T${u.tier} Lancer ${u.index}`,
          tier: u.tier,
          cavalry: true,
          respawnEnabled: respawn,
        })
      }
      for (const u of expanded.horseArcher) {
        list.push({
          faction,
          aiType: AIType.RANGED,
          name: `${prefix} T${u.tier} Horse Archer ${u.index}`,
          tier: u.tier,
          cavalry: true,
          respawnEnabled: respawn,
        })
      }
      return list
    }

    const vikingList = buildPending(vikingExpanded, Faction.PLAYER)
    const romanList = buildPending(romanExpanded, Faction.ENEMY)
    const totalNpcCount = vikingList.length + romanList.length
    const actorCount = totalNpcCount + 1 // + 1 for Player

    let gridSize = Math.max(6, Math.ceil(Math.sqrt(actorCount)) + 1)
    while (gridSize * gridSize - TREE_OBSTACLES.length * 2 < actorCount) {
      gridSize++
    }

    const cellSize = (SCATTER_BOUND_MAX - SCATTER_BOUND_MIN) / gridSize
    const maxJitter = Math.min(5.0, Math.max(1.0, (cellSize - 5.5) / 2))

    const prng = createMulberry32(SCATTER_BASE_SEED)
    const candidates: Array<{ x: number; z: number }> = []

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const cx = SCATTER_BOUND_MIN + (c + 0.5) * cellSize
        const cz = SCATTER_BOUND_MIN + (r + 0.5) * cellSize
        const jx = (prng() * 2 - 1) * maxJitter
        const jz = (prng() * 2 - 1) * maxJitter
        const x = Math.round((cx + jx) * 100) / 100
        const z = Math.round((cz + jz) * 100) / 100

        let nearObstacle = false
        for (const tree of TREE_OBSTACLES) {
          if (Math.hypot(x - tree.x, z - tree.z) < TREE_EXCLUSION_RADIUS) {
            nearObstacle = true
            break
          }
        }
        if (!nearObstacle) {
          candidates.push({ x, z })
        }
      }
    }

    if (candidates.length < actorCount) {
      throw new Error(`Insufficient scattered spawn slots: needed ${actorCount}, found ${candidates.length}`)
    }

    // Deterministic Fisher-Yates shuffle of candidate slots
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1))
      const tmp = candidates[i]
      candidates[i] = candidates[j]
      candidates[j] = tmp
    }

    // Player takes candidate slot 0
    const playerSpawn = candidates[0]

    // Interleave Viking and Roman NPCs to guarantee true mixed distribution across the field
    const mixedNpcs: PendingNpc[] = []
    let vIdx = 0
    let rIdx = 0
    while (vIdx < vikingList.length || rIdx < romanList.length) {
      if (vIdx < vikingList.length) mixedNpcs.push(vikingList[vIdx++])
      if (rIdx < romanList.length) mixedNpcs.push(romanList[rIdx++])
    }

    const npcSpecs: NpcSpawnSpec[] = []
    for (let i = 0; i < mixedNpcs.length; i++) {
      const pos = candidates[i + 1]
      const pending = mixedNpcs[i]
      npcSpecs.push({
        x: pos.x,
        z: pos.z,
        faction: pending.faction,
        aiType: pending.aiType,
        name: pending.name,
        tier: pending.tier,
        cavalry: pending.cavalry,
        respawnEnabled: pending.respawnEnabled,
      })
    }

    const pickupSpecs: CampPickupSpec[] = []
    const horseSpecs: CampHorseSpec[] = []

    if (config.rules.includeCamps) {
      pickupSpecs.push(...this._generateCampPickups(Faction.PLAYER))
      pickupSpecs.push(...this._generateCampPickups(Faction.ENEMY))
      horseSpecs.push(...this._generateCampHorses(Faction.PLAYER))
      horseSpecs.push(...this._generateCampHorses(Faction.ENEMY))
    }

    return {
      playerSpawn,
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
   * Calculates deterministic coordinates in the outer staging band.
   * Front lines start at |Z| = BATTLE_FRONTLINE_Z and formations extend
   * toward their faction's map edge. Camps remain behind the armies.
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
    const footTotal = units.infantry.length + units.archer.length
    const infPerRow = footTotal > 50 ? 20 : (units.infantry.length > 20 ? 15 : 10)
    const infSpacingX = 2.4
    const infRowSpacingZ = 2.2
    const infStartOffsetZ = BATTLE_FRONTLINE_Z

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
    const archPerRow = footTotal > 50 ? 20 : (units.archer.length > 20 ? 15 : 10)
    const archSpacingX = 2.6
    const archRowSpacingZ = 2.2
    const archBaseZ = units.infantry.length > 0
      ? infStartOffsetZ + infRowCount * infRowSpacingZ + 1.2
      : BATTLE_FRONTLINE_Z

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
    const mountedTotal = units.cavalry.length + units.horseArcher.length
    const maxColPerWing = mountedTotal > 30 ? 8 : 4
    const wingSpacingX = 2.2
    const wingSpacingZ = 2.1
    const startZ = BATTLE_FRONTLINE_Z

    const maxFootUnitsInRow = Math.max(
      units.infantry.length > 0 ? Math.min(infPerRow, units.infantry.length) : 0,
      units.archer.length > 0 ? Math.min(archPerRow, units.archer.length) : 0,
    )
    const maxFootHalfWidth = maxFootUnitsInRow > 0
      ? ((maxFootUnitsInRow - 1) / 2) * Math.max(infSpacingX, archSpacingX)
      : 4.0
    const cavalryBaseX = Math.max(14.0, maxFootHalfWidth + 3.0)
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

    // Relaxation to strictly guarantee >= 2.0m spacing between all friendly units and clearance from player
    const MIN_FRIENDLY_SPAWN_SPACING = 2.05
    for (let iter = 0; iter < 10; iter++) {
      let moved = false
      for (let i = 0; i < specs.length; i++) {
        for (let j = i + 1; j < specs.length; j++) {
          const u1 = specs[i]
          const u2 = specs[j]
          const dx = u1.x - u2.x
          const dz = u1.z - u2.z
          const dist = Math.hypot(dx, dz)
          if (dist < MIN_FRIENDLY_SPAWN_SPACING && dist > 0.0001) {
            const push = (MIN_FRIENDLY_SPAWN_SPACING - dist) * 0.5
            const nx = dx / dist
            const nz = dz / dist
            u1.x = Math.round((u1.x + nx * push) * 100) / 100
            u1.z = Math.round((u1.z + nz * push) * 100) / 100
            u2.x = Math.round((u2.x - nx * push) * 100) / 100
            u2.z = Math.round((u2.z - nz * push) * 100) / 100
            moved = true
          }
        }
        if (isViking) {
          const s = specs[i]
          const pDist = Math.hypot(s.x - VIKING_PLAYER_SPAWN.x, s.z - VIKING_PLAYER_SPAWN.z)
          if (pDist < PLAYER_SAFE_CLEARANCE) {
            const push = PLAYER_SAFE_CLEARANCE - pDist + 0.1
            const nx = (s.x - VIKING_PLAYER_SPAWN.x) || (s.x >= 0 ? 1 : -1)
            const nz = (s.z - VIKING_PLAYER_SPAWN.z) || 1
            const len = Math.hypot(nx, nz)
            s.x = Math.round((s.x + (nx / len) * push) * 100) / 100
            s.z = Math.round((s.z + (nz / len) * push) * 100) / 100
            moved = true
          }
        }
      }
      if (!moved) break
    }

    return specs
  }

  private static _generateCampPickups(faction: Faction): CampPickupSpec[] {
    const isViking = faction === Faction.PLAYER
    const z = (isViking ? CAMP_PICKUP_Z : -CAMP_PICKUP_Z)
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
    const z = (isViking ? CAMP_HORSE_Z : -CAMP_HORSE_Z)
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
