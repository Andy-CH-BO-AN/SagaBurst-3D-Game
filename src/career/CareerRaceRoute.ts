import { TOWN_CITY, TOWN_GATES, TOWN_PATROL_WALL_OFFSET } from '../town/TownLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { townPatrolRoute } from '../town/TownPatrolRoute'

export interface RacePoint { x: number; z: number }
export interface RacePosition extends RacePoint { y: number; yaw: number }
export interface RaceCrossing { t: number; lateral: number }
export interface RaceLine { center: RacePoint; normal: RacePoint; halfWidth: number; label: string }
const north = TOWN_GATES.find(g => g.id === 'north')!
const offset = TOWN_PATROL_WALL_OFFSET
export const RACE_START = { x: north.x, z: north.z + 9 }
export const RACE_START_SLOTS = [{ x: north.x - 3, z: north.z + 9 }, { x: north.x + 3, z: north.z + 9 }] as const
export const RACE_LINES: readonly RaceLine[] = [
  { center: north, normal: { x: 0, z: -1 }, halfWidth: TOWN_CITY.gateWidth / 2 - 1.1, label: '北門出城' },
  { center: { x: TOWN_CITY.maxX + offset, z: TOWN_GATES.find(g => g.id === 'east')!.z }, normal: { x: 0, z: 1 }, halfWidth: 8, label: '東側城外' },
  { center: { x: 0, z: TOWN_CITY.maxZ + offset }, normal: { x: -1, z: 0 }, halfWidth: 8, label: '南側城外' },
  { center: { x: TOWN_CITY.minX - offset, z: TOWN_GATES.find(g => g.id === 'west')!.z }, normal: { x: 0, z: -1 }, halfWidth: 8, label: '西側城外' },
  { center: north, normal: { x: 0, z: 1 }, halfWidth: TOWN_CITY.gateWidth / 2 - 1.1, label: '北門入城' },
]
export function lineCrossing(a: RacePoint, b: RacePoint, line: RaceLine): RaceCrossing | null {
  const side = (p: RacePoint) => (p.x - line.center.x) * line.normal.x + (p.z - line.center.z) * line.normal.z
  const from = side(a), to = side(b)
  if (from > 0 || to <= 0 || to === from) return null
  const t = -from / (to - from), x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t
  const lateral = (x - line.center.x) * line.normal.z - (z - line.center.z) * line.normal.x
  return Math.abs(lateral) <= line.halfWidth ? { t, lateral } : null
}
export function insideRaceTown(p: RacePoint): boolean {
  return p.x >= TOWN_CITY.minX && p.x <= TOWN_CITY.maxX && p.z >= TOWN_CITY.minZ && p.z <= TOWN_CITY.maxZ
}
export function legalRaceStart(p: RacePoint): boolean {
  return Math.abs(p.x - north.x) <= 5 && p.z >= north.z + 1.5 && p.z <= north.z + 18
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
