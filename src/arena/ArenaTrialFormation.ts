import { COLOSSEUM_SPAWNS } from './ColosseumLayout'
import { VALHALLA_SPAWNS } from './ValhallaLayout'
import type { DuelArenaId } from './DuelArenaCatalog'
import type { ObstacleData } from '../world/Terrain'

/**
 * Battle lines for an Arena Squad Trial. Both teams stand on the arena's existing duel lane — the player on
 * the player spawn, the opposing front rank on the opponent spawn — and every slot is checked against the
 * arena's real obstacles. A trial that cannot be fully laid out is refused, never squeezed or overlapped.
 */
export interface ArenaTrialSlot { readonly x: number; readonly z: number; readonly yaw: number }
export interface ArenaTrialFormation { readonly player: ArenaTrialSlot; readonly friendly: ArenaTrialSlot[]; readonly enemy: ArenaTrialSlot[] }

const COLUMNS = 7
const MAX_ROWS = 5
const BODY_RADIUS = 0.6
/** Floor-level decoration shorter than a step, and overhead volumes above head height, do not block a standing body. */
const STEP_HEIGHT = 0.35
const HEAD_HEIGHT = 2.6

interface LaneSpec { columnSpacing: number; rowSpacing: number; friendlyFrontZ: number; enemyFrontZ: number; groundY: number }

const LANES: Readonly<Record<DuelArenaId, LaneSpec>> = Object.freeze({
  'roman-colosseum': { columnSpacing: 2.4, rowSpacing: 2.2, friendlyFrontZ: COLOSSEUM_SPAWNS.player.z, enemyFrontZ: COLOSSEUM_SPAWNS.opponent.z, groundY: COLOSSEUM_SPAWNS.player.y },
  'viking-valhalla': { columnSpacing: 2.2, rowSpacing: 2.2, friendlyFrontZ: VALHALLA_SPAWNS.player.z, enemyFrontZ: VALHALLA_SPAWNS.opponent.z, groundY: VALHALLA_SPAWNS.player.y },
})

export function arenaTrialSlotClear(x: number, z: number, groundY: number, obstacles: readonly ObstacleData[]): boolean {
  return !obstacles.some(obstacle => !obstacle.navigationPassable
    && obstacle.box.max.y > groundY + STEP_HEIGHT && obstacle.box.min.y < groundY + HEAD_HEIGHT
    && x > obstacle.box.min.x - BODY_RADIUS && x < obstacle.box.max.x + BODY_RADIUS
    && z > obstacle.box.min.z - BODY_RADIUS && z < obstacle.box.max.z + BODY_RADIUS)
}

/** Centre-out column order so a short line stays centred behind the player or the opposing front. */
function columnOffsets(): number[] {
  const offsets = [0]
  for (let i = 1; i <= (COLUMNS - 1) / 2; i++) offsets.push(-i, i)
  return offsets
}

function lineSlots(lane: LaneSpec, frontZ: number, direction: 1 | -1, yaw: number, obstacles: readonly ObstacleData[]): ArenaTrialSlot[] {
  const slots: ArenaTrialSlot[] = []
  for (let row = 0; row < MAX_ROWS; row++) {
    for (const column of columnOffsets()) {
      const x = column * lane.columnSpacing
      const z = frontZ + direction * row * lane.rowSpacing
      if (arenaTrialSlotClear(x, z, lane.groundY, obstacles)) slots.push({ x, z, yaw })
    }
  }
  return slots
}

export function planArenaTrialFormation(arenaId: DuelArenaId, obstacles: readonly ObstacleData[], friendlyNpcCount: number, enemyCount: number): ArenaTrialFormation | null {
  const lane = LANES[arenaId]
  // Friendly line: the player holds the first slot, NPCs fill behind and beside. Friendlies face +Z, the enemy -Z.
  const friendly = lineSlots(lane, lane.friendlyFrontZ, -1, 0, obstacles)
  const enemy = lineSlots(lane, lane.enemyFrontZ, 1, Math.PI, obstacles)
  if (friendly.length < friendlyNpcCount + 1 || enemy.length < enemyCount) return null
  return { player: friendly[0], friendly: friendly.slice(1, friendlyNpcCount + 1), enemy: enemy.slice(0, enemyCount) }
}

const ROLE_ORDER = { melee: 0, spear: 1, archer: 2 } as const

/** Front ranks take melee, then spears; archers stand behind. Order inside a role follows the roster. */
export function assignArenaTrialSlots(
  entries: readonly { actorId: string; team: 'friendly' | 'enemy'; group: { role: keyof typeof ROLE_ORDER } }[],
  formation: ArenaTrialFormation,
): Map<string, ArenaTrialSlot> {
  const assigned = new Map<string, ArenaTrialSlot>()
  for (const team of ['friendly', 'enemy'] as const) {
    const slots = formation[team]
    entries.filter(entry => entry.team === team)
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => ROLE_ORDER[a.entry.group.role] - ROLE_ORDER[b.entry.group.role] || a.index - b.index)
      .forEach(({ entry }, order) => assigned.set(entry.actorId, slots[order]))
  }
  return assigned
}
