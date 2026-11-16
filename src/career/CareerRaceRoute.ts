import { TOWN_CITY, TOWN_GATES, TOWN_PATROL_WALL_OFFSET } from '../town/TownLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { townPatrolRoute } from '../town/TownPatrolRoute'
import { Vector3 } from 'three'
import { getWalkRampHeight, isObstaclePathClear, type ObstacleData } from '../world/Terrain'
import { collideMountBody, MOUNT_BODY_HEIGHT, settleMountOnTerrain } from '../world/MountGroundBody'

export interface RacePoint { x: number; z: number }
export interface RacePosition extends RacePoint { y: number; yaw: number }
export interface RaceCrossing { t: number; lateral: number }
export interface RaceLine { center: RacePoint; normal: RacePoint; halfWidth: number; label: string }
const north = TOWN_GATES.find(g => g.id === 'north')!
const offset = TOWN_PATROL_WALL_OFFSET
// Cover the whole walkable exterior lane, including a rider hugging the wall.
// Previously offset ±8 left an unmarked gap between the wall and each checkpoint.
const innerLane = .01 // Strictly exterior, including the walkable open gate mouth.
const outerLane = offset + 8
const laneCenter = (innerLane + outerLane) / 2
const laneHalfWidth = (outerLane - innerLane) / 2
export const RACE_START = { x: north.x, z: north.z + 9 }
export const RACE_START_SLOTS = [{ x: north.x - 3, z: north.z + 9 }, { x: north.x + 3, z: north.z + 9 }] as const
export const RACE_LINES: readonly RaceLine[] = [
  { center: north, normal: { x: 0, z: -1 }, halfWidth: TOWN_CITY.gateWidth / 2, label: '北門出城' },
  { center: { x: TOWN_CITY.maxX + laneCenter, z: TOWN_GATES.find(g => g.id === 'east')!.z }, normal: { x: 0, z: 1 }, halfWidth: laneHalfWidth, label: '東側城外 · 向南通過' },
  { center: { x: 0, z: TOWN_CITY.maxZ + laneCenter }, normal: { x: -1, z: 0 }, halfWidth: laneHalfWidth, label: '南側城外 · 向西通過' },
  { center: { x: TOWN_CITY.minX - laneCenter, z: TOWN_GATES.find(g => g.id === 'west')!.z }, normal: { x: 0, z: -1 }, halfWidth: laneHalfWidth, label: '西側城外 · 向北通過' },
  { center: north, normal: { x: 0, z: 1 }, halfWidth: TOWN_CITY.gateWidth / 2, label: '北門入城' },
]
export function lineCrossing(a: RacePoint, b: RacePoint, line: RaceLine, includeArrival = false): RaceCrossing | null {
  const side = (p: RacePoint) => (p.x - line.center.x) * line.normal.x + (p.z - line.center.z) * line.normal.z
  const from = side(a), to = side(b)
  if (to === from || from > 0 || (includeArrival ? to < 0 : to <= 0)) return null
  const t = -from / (to - from), x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t
  const lateral = (x - line.center.x) * line.normal.z - (z - line.center.z) * line.normal.x
  return Math.abs(lateral) <= line.halfWidth ? { t, lateral } : null
}
/** Aim beyond the detection plane so following the arrow actually crosses it. */
export function raceCheckpointTarget(checkpoint: number, from?: RacePoint): RacePoint | null {
  const line = RACE_LINES[checkpoint]
  if (!line) return null
  // A rider who missed the finite lane must re-approach, never receive retroactive progress.
  const pastLine = from && (from.x - line.center.x) * line.normal.x + (from.z - line.center.z) * line.normal.z >= 0
  const offset = pastLine ? -3 : 3
  return { x: line.center.x + line.normal.x * offset, z: line.center.z + line.normal.z * offset }
}
export function insideRaceTown(p: RacePoint): boolean {
  return p.x >= TOWN_CITY.minX && p.x <= TOWN_CITY.maxX && p.z >= TOWN_CITY.minZ && p.z <= TOWN_CITY.maxZ
}
export function legalRaceStart(p: RacePoint): boolean {
  return Math.abs(p.x - north.x) <= 5 && p.z >= north.z + 1.5 && p.z <= north.z + 18
}
/** Native mount collision already resolves body clearance. Validate the actual swept
 * centre against solids, rather than treating the mount's exterior padding as a wall.
 * In particular, sliding/turning at a corner must not become a disqualification. */
export function raceMovementIsLegal(a: RacePosition, b: RacePosition, obstacles: readonly ObstacleData[]): boolean {
  return [a, b].every(p => Math.max(Math.abs(p.x), Math.abs(p.z)) < TOWN_PLAYABLE_WORLD_BOUND)
    && isObstaclePathClear(new Vector3(a.x, a.y, a.z), new Vector3(b.x, b.y, b.z), 0, 2.6, 0,
      obstacles.filter(obstacle => !obstacle.physicalPassable))
}
/** Every wall boundary has a finite span. Tangential travel outside another gate is harmless. */
export function illegalTownCrossing(a: RacePoint, b: RacePoint, nextCheckpoint: number): boolean {
  const boundaries: RaceLine[] = [
    { center: { x: (TOWN_CITY.minX + TOWN_CITY.maxX) / 2, z: TOWN_CITY.minZ }, normal: { x: 0, z: 1 }, halfWidth: (TOWN_CITY.maxX - TOWN_CITY.minX) / 2, label: 'north' },
    { center: { x: (TOWN_CITY.minX + TOWN_CITY.maxX) / 2, z: TOWN_CITY.maxZ }, normal: { x: 0, z: -1 }, halfWidth: (TOWN_CITY.maxX - TOWN_CITY.minX) / 2, label: 'south' },
    { center: { x: TOWN_CITY.maxX, z: (TOWN_CITY.minZ + TOWN_CITY.maxZ) / 2 }, normal: { x: -1, z: 0 }, halfWidth: (TOWN_CITY.maxZ - TOWN_CITY.minZ) / 2, label: 'east' },
    { center: { x: TOWN_CITY.minX, z: (TOWN_CITY.minZ + TOWN_CITY.maxZ) / 2 }, normal: { x: 1, z: 0 }, halfWidth: (TOWN_CITY.maxZ - TOWN_CITY.minZ) / 2, label: 'west' },
  ]
  return boundaries.some(line => {
    const entering = lineCrossing(a, b, line), leaving = lineCrossing(b, a, line)
    if (!entering && !leaving) return false
    if (line.label !== 'north') return true
    const allowed = entering ? nextCheckpoint === 4 : nextCheckpoint === 0
    return !allowed || !lineCrossing(entering ? a : b, entering ? b : a, RACE_LINES[4])
  })
}
/** Reuses the scenery-cleared native patrol ring, split at North Gate; no alternate map. */
export function raceWaypoints(): RacePoint[] {
  const ring = townPatrolRoute().map(p => ({ x: p.x, z: p.z }))
  const split = ring.findIndex(p => p.z === TOWN_CITY.minZ - offset && p.x > north.x)
  return [{ x: north.x + 3, z: north.z - offset }, ...ring.slice(split), ...ring.slice(0, split),
    { x: north.x, z: north.z - offset }, { x: north.x, z: north.z + 9 }]
    .filter(p => Math.max(Math.abs(p.x), Math.abs(p.z)) < TOWN_PLAYABLE_WORLD_BOUND - 2)
}

/** Where a race-owned mount may stand: the real walk surface (Town Center floor indoors, terrain outside) and body clearance. */
export interface RaceMountSpawnOptions {
  /** Height of the walkable surface under a point; a raised hall floor, never the terrain under its plinth. */
  groundAt(x: number, z: number): number
  obstacles: readonly ObstacleData[]
  /** Riders, NPCs and other mounts already standing there, including the rider's own home mount. */
  occupied?: readonly { x: number; z: number; radius?: number }[]
  /** Body radius of the mount being placed, for spacing from other occupants. */
  radius?: number
  isValid?: (point: RacePoint) => boolean
  /** Terrain heightmap the live Mount clamps to every frame (defaults to the scene terrain). */
  terrainHeight?: (x: number, z: number) => number
}
const RACE_MOUNT_SURFACE_TOLERANCE = .25
/** Horizontal clearance from any solid that still collides with the mount body (posts, walls, furniture). */
const RACE_MOUNT_SOLID_MARGIN = 1.05
const RACE_MOUNT_STEP = .35
const RACE_MOUNT_RINGS = [2.4, 4.0, 5.6, 8.0, 11.0] as const

/**
 * Physical body rule, not navigation flags: anything that is not `physicalPassable` and overlaps the mount's height band
 * blocks it, except a walk surface (floor slab, ramp) the body is standing on. Then the real first ground-mount frame
 * (gravity, terrain, obstacle and walk-surface collision) must leave the body exactly where it was placed.
 */
function raceMountBodyFits(point: RacePoint, y: number, options: RaceMountSpawnOptions): boolean {
  if (Math.max(Math.abs(point.x), Math.abs(point.z)) > TOWN_PLAYABLE_WORLD_BOUND - 2) return false
  for (const obstacle of options.obstacles) {
    if (obstacle.physicalPassable) continue
    const box = obstacle.box
    if (box.max.y <= y + RACE_MOUNT_STEP || box.min.y >= y + MOUNT_BODY_HEIGHT) continue
    const surface = obstacle.walkSurface?.mounted ? getWalkRampHeight(obstacle.walkSurface, point.x, point.z) : null
    if (surface !== null && surface <= y + RACE_MOUNT_STEP) continue
    if (point.x > box.min.x - RACE_MOUNT_SOLID_MARGIN && point.x < box.max.x + RACE_MOUNT_SOLID_MARGIN
      && point.z > box.min.z - RACE_MOUNT_SOLID_MARGIN && point.z < box.max.z + RACE_MOUNT_SOLID_MARGIN) return false
  }
  const position = new Vector3(point.x, y, point.z), previous = position.clone()
  const state = collideMountBody(position, previous, settleMountOnTerrain(position, 0, 1 / 60, options.terrainHeight), options.obstacles as ObstacleData[])
  return state.onGround && Math.abs(position.x - point.x) < 1e-3 && Math.abs(position.z - point.z) < 1e-3 && Math.abs(position.y - y) < 1e-3
}
function raceMountSpotClear(point: RacePoint, options: RaceMountSpawnOptions, withOccupants: boolean): boolean {
  if (withOccupants && (options.occupied ?? []).some(other =>
    Math.hypot(other.x - point.x, other.z - point.z) < (other.radius ?? RACE_MOUNT_SOLID_MARGIN) + (options.radius ?? RACE_MOUNT_SOLID_MARGIN))) return false
  if (options.isValid && !options.isValid(point)) return false
  return raceMountBodyFits(point, options.groundAt(point.x, point.z), options)
}
/** A saved race-mount pose is restorable as-is only on its walk surface and clear of every solid the mount body hits. */
export function raceMountPoseLegal(pose: RacePosition, options: RaceMountSpawnOptions): boolean {
  return Math.abs(pose.y - options.groundAt(pose.x, pose.z)) <= RACE_MOUNT_SURFACE_TOLERANCE && raceMountSpotClear(pose, options, false)
}
/**
 * The race mount's spawn for its rider: the rider's own spot when its mount body is clear there, otherwise the
 * nearest clear ring point. Y always comes from the walk surface at the chosen point; null means no legal spot.
 */
export function resolveRaceMountSpawn(origin: RacePosition, options: RaceMountSpawnOptions): RacePosition | null {
  const at = (p: RacePoint): RacePosition => ({ x: p.x, y: options.groundAt(p.x, p.z), z: p.z, yaw: origin.yaw })
  if (raceMountSpotClear(origin, options, true)) return at(origin)
  for (const ring of RACE_MOUNT_RINGS) for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2
    const point = { x: origin.x + Math.sin(angle) * ring, z: origin.z + Math.cos(angle) * ring }
    if (raceMountSpotClear(point, options, true)) return at(point)
  }
  return null
}
