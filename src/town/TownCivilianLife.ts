import { cloneCivilianCommandSquad, type CivilianCommandSquadState } from '../career/CivilianCommandAuthority'
import { TOWN_CENTER, TOWN_WELL, TOWN_CITY, TOWN_CITY_ROADS, TOWN_LOCAL_ROADS, TOWN_DUEL_CENTER, TOWN_DUEL_HALF_SIZE, townHousing, TOWN_PRIVATE_EAGLE_SITES, TOWN_GARRISON_EAGLE_SITES } from './TownLayout'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import type { NavigationWorld } from '../navigation/NavigationWorld'

export type CivilianDistrict = 'plaza' | 'housing' | 'street'
export interface CivilianAnchor { x: number; y: number; z: number; district: CivilianDistrict }
interface Point { x: number; z: number }
export const CIVILIAN_MOUNT_CLEARANCE = { radius: 2, height: 4.5 } as const
const civilianRoads = [...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS]
const civilianHousing = townHousing('viking')
/** Stable identity-based variation, independent of creation order and reload time. */
function random(id: string, step: number): number {
  let h = 2166136261
  for (const c of `${id}:${step}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  h = Math.imul(h ^ h >>> 16, 2246822507)
  return (h >>> 0) / 4294967296
}
export function civilianDistrict(_index: number): CivilianDistrict { return 'housing' }

/** Conservative ground clearance shared by placement and short walking segments. */
export function civilianPointLegal(point: Point, occupied: readonly Point[] = [], obstacles: readonly ObstacleData[] = [], clearance = { radius: .8, height: 1.8 }): boolean {
  const { x, z } = point, r = clearance.radius
  if (x < TOWN_CITY.minX + 10 || x > TOWN_CITY.maxX - 10 || z < TOWN_CITY.minZ + 10 || z > TOWN_CITY.maxZ - 3) return false
  // Viking houses have the larger footprint; the same home anchors work for both towns.
  if (civilianHousing.some(h => Math.abs(x - h.x) < h.width / 2 + r && Math.abs(z - h.z) < h.depth / 2 + r)) return false
  if (Math.abs(x - TOWN_CENTER.x) < TOWN_CENTER.width / 2 + 1 + r && Math.abs(z - TOWN_CENTER.z) < TOWN_CENTER.depth / 2 + 1 + r) return false
  // Keep both service-side Commander candidates and the Captain's mounted approach open.
  if (Math.abs(x - (TOWN_CENTER.x - 8)) < 13 && z > TOWN_CENTER.z + 13 && z < TOWN_CENTER.z + 28) return false
  if (Math.hypot(x - TOWN_WELL.x, z - TOWN_WELL.z) < TOWN_WELL.radius + 1.35) return false
  // Main riding roads and gate corridors stay clear, including the road shoulders.
  if (civilianRoads.some(road => {
    const dx = road.bx - road.ax, dz = road.bz - road.az
    const t = Math.max(0, Math.min(1, ((x - road.ax) * dx + (z - road.az) * dz) / (dx * dx + dz * dz)))
    return Math.hypot(x - road.ax - t * dx, z - road.az - t * dz) < road.width / 2 + Math.max(2, r + .5)
  })) return false
  if ([...TOWN_PRIVATE_EAGLE_SITES, ...TOWN_GARRISON_EAGLE_SITES].some(p => Math.abs(x - p.x) < 16 && Math.abs(z - p.z) < 28)) return false
  if (Math.abs(x - TOWN_DUEL_CENTER.x) < TOWN_DUEL_HALF_SIZE + 6 && Math.abs(z - TOWN_DUEL_CENTER.z) < TOWN_DUEL_HALF_SIZE + 6) return false
  if (occupied.some(p => Math.hypot(x - p.x, z - p.z) < Math.max(3, r * 2 + .5))) return false
  const y = getTerrainHeight(x, z)
  return !obstacles.some(o => {
    const box = clearance.height > 1.8 ? o.box : o.navigationBox ?? o.box
    return box.max.y > y + .15 && box.min.y < y + clearance.height
      && x > box.min.x - r && x < box.max.x + r && z > box.min.z - r && z < box.max.z + r
  })
}

/** Bounded candidates come from production housing geometry, never a second house list. */
export function civilianHomeAnchor(index: number, occupied: readonly Point[] = [], obstacles: readonly ObstacleData[] = [], navigation?: Pick<NavigationWorld, 'areConnected'>): CivilianAnchor {
  const id = `civilian-${index}`, district = civilianDistrict(index), homes = civilianHousing
  for (let attempt = 0; attempt < homes.length * 24; attempt++) {
    const u = random(id, attempt * 2), v = random(id, attempt * 2 + 1)
    const h = homes[(index + Math.floor(attempt / 24)) % homes.length]
    // Side/rear edges avoid front doors; Viking's larger footprint is safe in both towns.
    const edge = attempt % 3, gap = CIVILIAN_MOUNT_CLEARANCE.radius + 1 + v * .5
    const side = edge < 2 ? (edge === 0 ? -1 : 1) * (h.width / 2 + gap) : (u - .5) * (h.width - 2)
    const forward = edge < 2 ? (u - .5) * (h.depth - 2) : -h.depth / 2 - gap
    const x = h.x + Math.cos(h.yaw) * side + Math.sin(h.yaw) * forward
    const z = h.z - Math.sin(h.yaw) * side + Math.cos(h.yaw) * forward
    if (civilianPointLegal({ x, z }, occupied, obstacles, CIVILIAN_MOUNT_CLEARANCE) && (!navigation || navigation.areConnected({ x: 60, z: 12 }, { x, z }))) return { x, y: getTerrainHeight(x, z), z, district }
  }
  throw new Error(`No legal civilian home for ${id}`)
}

interface WalkState { remaining: number; step: number; destination?: Point }
/** Small local walks need no A*. Geometry is sampled only when choosing a new goal. */
export class TownCivilianLife {
  private readonly states = new Map<string, WalkState>()
  update(id: string, home: Point, position: { x: number; y: number; z: number }, dt: number,
    navigation: Pick<NavigationWorld, 'areConnected'>, obstacles: readonly ObstacleData[], occupied: readonly Point[]): { speed: number; yaw?: number } {
    let state = this.states.get(id)
    if (!state) { state = { remaining: 1 + random(id, 0) * 8, step: 0 }; this.states.set(id, state) }
    state.remaining -= dt
    if (!state.destination && state.remaining <= 0) {
      const angle = random(id, ++state.step) * Math.PI * 2
      const destination = { x: home.x + Math.cos(angle) * 1.5, z: home.z + Math.sin(angle) * 1.5 }
      const length = Math.hypot(destination.x - position.x, destination.z - position.z)
      let legal = length < 6 && navigation.areConnected(position, destination)
      for (let t = 0; legal && t <= 1; t += .1) legal = civilianPointLegal({
        x: position.x + (destination.x - position.x) * t, z: position.z + (destination.z - position.z) * t,
      }, occupied, obstacles)
      if (legal) state.destination = destination
      else state.remaining = 5
    }
    if (!state.destination) return { speed: 0 }
    const dx = state.destination.x - position.x, dz = state.destination.z - position.z, distance = Math.hypot(dx, dz)
    if (distance < .08) {
      state.destination = undefined; state.remaining = 5 + random(id, state.step + 100) * 10
      return { speed: 0 }
    }
    const stride = Math.min(distance, .65 * dt), next = { x: position.x + dx / distance * stride, z: position.z + dz / distance * stride }
    if (!civilianPointLegal(next, occupied, obstacles)) { state.destination = undefined; state.remaining = 3; return { speed: 0 } }
    position.x = next.x; position.z = next.z; position.y = getTerrainHeight(next.x, next.z)
    return { speed: .65, yaw: Math.atan2(dx, dz) }
  }
  suspend(id: string): void { this.states.delete(id) }
}

export const CIVILIAN_HOME_LAYOUT_VERSION = 3
/** Upgrade only native home intent. Never move commanded actors, revive deaths or reset wartime shelter. */
export function migrateCivilianHomes(saved: CivilianCommandSquadState,
  homes: readonly { id: string; x: number; y?: number; z: number; yaw?: number }[],
  canPlaceMountedCivilian?: (point: Point, actorId: string) => boolean): CivilianCommandSquadState {
  const upgrade = (saved.homeLayoutVersion ?? 0) < CIVILIAN_HOME_LAYOUT_VERSION
  let next = upgrade ? cloneCivilianCommandSquad(saved) : undefined
  if (next) next.homeLayoutVersion = CIVILIAN_HOME_LAYOUT_VERSION
  for (const home of homes) {
    const member = saved.members[home.id], owner = saved.owners[home.id]
    if (!member || owner !== 'daily' || member.status === 'dead' || member.status === 'exited'
      || member.hp === 0 || member.fall || member.mount?.flight || !/^civilian-\d+$/.test(home.id)) continue
    // Equipment may have changed since the last pose checkpoint. Recheck even the current layout.
    const repairMount = member.mount && member.mount.hp > 0 && canPlaceMountedCivilian
      && (!canPlaceMountedCivilian(member.mount.position, home.id)
        || member.mount.mounted && member.position && !canPlaceMountedCivilian(member.position, home.id))
    if ((!upgrade && !repairMount) || (canPlaceMountedCivilian && !canPlaceMountedCivilian(home, home.id))) continue
    next ??= cloneCivilianCommandSquad(saved)
    const updated = next.members[home.id]
    const position = { x: home.x, y: home.y ?? getTerrainHeight(home.x, home.z), z: home.z, yaw: home.yaw ?? 0 }
    updated.position = position; updated.order = 'attack'; delete updated.formation
    if (updated.mount && (updated.mount.mounted || repairMount)) updated.mount.position = { ...position }
  }
  return next ?? saved
}
