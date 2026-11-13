import type { ObstacleData } from '../world/Terrain'
import { getTerrainHeight } from '../world/Terrain'

export const CAREER_MISSION_RETURN_KEY = 'sagaburst_career_mission_return'

export interface SergeantPose {
  x: number
  z: number
  yaw?: number
}

export interface SergeantReturnBlocker {
  x: number
  z: number
  radius?: number
}

export interface SergeantReturnPoint {
  x: number
  y: number
  z: number
  yaw: number
}

export interface SergeantReturnOptions {
  /** Preferred stand-off distance in metres directly in front of the Sergeant (3–4m). */
  distance?: number
  /** Horizontal body radius used for obstacle/NPC/mount overlap checks. */
  clearanceRadius?: number
  obstacles?: readonly ObstacleData[]
  blockers?: readonly SergeantReturnBlocker[]
  terrainHeight?: (x: number, z: number) => number
  worldBound?: number
  isValid?: (point: { x: number; z: number }) => boolean
}

export interface SergeantResidentLike {
  spec: { id?: string; role: string; x: number; z: number; yaw?: number }
  npc?: {
    dead?: boolean
    combatPosition?: { x: number; z: number }
    group?: { rotation?: { y?: number } }
  }
}

const DISTANCE_CANDIDATES = [3.5, 3.2, 3.8, 3.0, 4.0] as const
const ANGLE_OFFSETS = [0, 0.25, -0.25, 0.5, -0.5, 0.85, -0.85, 1.2, -1.2] as const
const SERGEANT_SELF_TOLERANCE = 1.2
const DEFAULT_CLEARANCE_RADIUS = 0.75
const DEFAULT_BLOCKER_RADIUS = 0.65
const DEFAULT_WORLD_BOUND = 348

export function markCareerMissionReturnToSergeant(storage: Pick<Storage, 'setItem'> | undefined = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined): void {
  storage?.setItem(CAREER_MISSION_RETURN_KEY, '1')
}

export function consumeCareerMissionReturnFlag(storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined): boolean {
  if (!storage || storage.getItem(CAREER_MISSION_RETURN_KEY) !== '1') return false
  storage.removeItem(CAREER_MISSION_RETURN_KEY)
  return true
}

function isCandidateClear(
  x: number,
  z: number,
  y: number,
  sergeant: SergeantPose,
  options: SergeantReturnOptions,
): boolean {
  const bound = options.worldBound ?? DEFAULT_WORLD_BOUND
  if (Math.max(Math.abs(x), Math.abs(z)) > bound) return false
  if (options.isValid && !options.isValid({ x, z })) return false
  const radius = options.clearanceRadius ?? DEFAULT_CLEARANCE_RADIUS
  for (const obstacle of options.obstacles ?? []) {
    if (obstacle.navigationPassable) continue
    if (obstacle.box.max.y <= y + 0.35 || obstacle.box.min.y >= y + 2.6) continue
    if (x > obstacle.box.min.x - radius && x < obstacle.box.max.x + radius
      && z > obstacle.box.min.z - radius && z < obstacle.box.max.z + radius) {
      return false
    }
  }
  for (const blocker of options.blockers ?? []) {
    // Sergeant stands at `sergeant.{x,z}`; ignore his own footprint in the generic blocker list
    // because the 3–4m stand-off already preserves conversational clearance.
    if (Math.hypot(blocker.x - sergeant.x, blocker.z - sergeant.z) < SERGEANT_SELF_TOLERANCE) continue
    const minDistance = radius + (blocker.radius ?? DEFAULT_BLOCKER_RADIUS)
    if (Math.hypot(x - blocker.x, z - blocker.z) < minDistance) return false
  }
  return true
}

/**
 * Resolves a grounded spawn position ~3–4m directly in front of the live Sergeant NPC,
 * facing the Sergeant and free of walls, gates, buildings, NPCs and mounts.
 */
export function resolveSergeantReturnPoint(
  sergeant: SergeantPose,
  options: SergeantReturnOptions = {},
): SergeantReturnPoint {
  const terrainHeight = options.terrainHeight ?? getTerrainHeight
  const heading = sergeant.yaw ?? 0
  const preferredDistance = options.distance ?? DISTANCE_CANDIDATES[0]
  const distances = [preferredDistance, ...DISTANCE_CANDIDATES.filter(d => Math.abs(d - preferredDistance) > 0.05)]
  for (const angleOffset of ANGLE_OFFSETS) {
    for (const distance of distances) {
      const angle = heading + angleOffset
      const x = Math.round((sergeant.x + Math.sin(angle) * distance) * 1000) / 1000
      const z = Math.round((sergeant.z + Math.cos(angle) * distance) * 1000) / 1000
      const y = terrainHeight(x, z)
      if (!isCandidateClear(x, z, y, sergeant, options)) continue
      return {
        x,
        y,
        z,
        yaw: Math.atan2(sergeant.x - x, sergeant.z - z),
      }
    }
  }
  const x = Math.round((sergeant.x + Math.sin(heading) * preferredDistance) * 1000) / 1000
  const z = Math.round((sergeant.z + Math.cos(heading) * preferredDistance) * 1000) / 1000
  return {
    x,
    y: terrainHeight(x, z),
    z,
    yaw: Math.atan2(sergeant.x - x, sergeant.z - z),
  }
}

export function findSergeantResident<T extends SergeantResidentLike>(residents: readonly T[]): T | undefined {
  return residents.find(resident => resident.spec.id === 'deployment' && resident.spec.role === 'deployment')
}

export function sergeantReturnFromResidents(
  residents: readonly SergeantResidentLike[],
  options: SergeantReturnOptions = {},
): SergeantReturnPoint | null {
  const sergeant = findSergeantResident(residents)
  if (!sergeant) return null
  const x = sergeant.npc && !sergeant.npc.dead && sergeant.npc.combatPosition ? sergeant.npc.combatPosition.x : sergeant.spec.x
  const z = sergeant.npc && !sergeant.npc.dead && sergeant.npc.combatPosition ? sergeant.npc.combatPosition.z : sergeant.spec.z
  const yaw = sergeant.npc && !sergeant.npc.dead && typeof sergeant.npc.group?.rotation?.y === 'number'
    ? sergeant.npc.group.rotation.y
    : sergeant.spec.yaw ?? 0
  return resolveSergeantReturnPoint({ x, z, yaw }, options)
}
