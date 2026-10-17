import { TOWN_CITY, TOWN_GATES, TOWN_PATROL_WALL_OFFSET } from '../town/TownLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { townPatrolRoute } from '../town/TownPatrolRoute'
import { Vector3 } from 'three'
import { isObstaclePathClear, type ObstacleData } from '../world/Terrain'

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
