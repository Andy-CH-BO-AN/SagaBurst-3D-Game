import { EAGLE_APPROACH } from '../world/EagleApproach'
import { TOWN_PRIVATE_EAGLE_SITES, TOWN_GARRISON_EAGLE_SITES } from './TownLayout'
import { civilianPointLegal } from './TownCivilianLife'
import { getTownCommandWatchtowerLayout } from './TownCommandWatchtowerLayout'
import { TOWN_GATES, TOWN_HR_REGION, TOWN_MOUNTED_MISSION_MUSTER, TOWN_MOUNTED_MISSION_MUSTER_HALF_SIZE, townGatePoint, type TownGateId } from './TownLayout'
import type { TownRampartLayout } from './TownRamparts'
import { getTerrainHeight } from '../world/Terrain'

interface Point { x: number; z: number }
export interface GroundOccupant extends Point { radius: number }
interface StationCandidate { point: ReturnType<typeof townGatePoint>; legal?: boolean }
const eagleSites = [...TOWN_PRIVATE_EAGLE_SITES, ...TOWN_GARRISON_EAGLE_SITES]

/** Uses the authored flight, landing and wall connection, not four coordinate patches. */
export function townRampGroundExcluded(layout: TownRampartLayout, point: Point, radius: number): boolean {
  for (const ramp of layout.ramps) {
    const s = ramp.surface, dx = point.x - s.startX, dz = point.z - s.startZ
    const along = dx * s.dirX + dz * s.dirZ, lateral = Math.abs(-dx * s.dirZ + dz * s.dirX)
    const entranceAlong = (ramp.entrance.x - s.startX) * s.dirX + (ramp.entrance.z - s.startZ) * s.dirZ
    if (along >= entranceAlong - 5 - radius && along <= s.length + s.landing + radius + 1
      && lateral <= s.halfWidth + radius + 1) return true
    const ax = ramp.landing.x, az = ramp.landing.z, bx = ramp.connection.x, bz = ramp.connection.z
    const lengthSq = (bx - ax) ** 2 + (bz - az) ** 2
    const t = Math.max(0, Math.min(1, ((point.x - ax) * (bx - ax) + (point.z - az) * (bz - az)) / Math.max(.001, lengthSq)))
    if (Math.hypot(point.x - ax - (bx - ax) * t, point.z - az - (bz - az) * t) <= s.halfWidth + radius + 1) return true
  }
  return false
}

/** One allocation pass owns spacing, including reserved equipment fallback slots. */
export class TownGroundStations {
  private readonly tower = getTownCommandWatchtowerLayout().footprint
  private readonly candidates = new Map<string, StationCandidate[]>()
  constructor(private readonly layout: TownRampartLayout, private readonly occupied: GroundOccupant[]) {}

  private staticLegal(p: Point, radius: number): boolean {
    if (townRampGroundExcluded(this.layout, p, Math.max(1.8, radius))) return false
    if (!civilianPointLegal(p, [], [], { radius, height: 2.6 })) return false
    for (const pad of eagleSites) {
      const along = (pad.z - p.z) * Math.cos(pad.yaw)
      if (Math.abs(p.x - pad.x) < 16 + radius && along >= -15 - radius
        && along <= EAGLE_APPROACH.terminalDistance + radius) return false
    }
    // Service buildings have rotated footprints; reserve their eaves and approaches.
    if (Math.abs(p.x + 6) < 9 + radius && Math.abs(p.z + 17) < 8 + radius
      || Math.abs(p.x + 5) < 10 + radius && Math.abs(p.z + 39) < 10 + radius) return false
    if (p.x > this.tower.min.x - radius && p.x < this.tower.max.x + radius
      && p.z > this.tower.min.z - radius && p.z < this.tower.max.z + radius) return false
    if (p.x > TOWN_HR_REGION.minX - 6 - radius && p.x < TOWN_HR_REGION.maxX + 26 + radius
      && p.z > TOWN_HR_REGION.minZ - 12 - radius && p.z < TOWN_HR_REGION.maxZ + 12 + radius) return false
    if (Math.abs(p.x - TOWN_MOUNTED_MISSION_MUSTER.x) < TOWN_MOUNTED_MISSION_MUSTER_HALF_SIZE + radius
      && Math.abs(p.z - TOWN_MOUNTED_MISSION_MUSTER.z) < TOWN_MOUNTED_MISSION_MUSTER_HALF_SIZE + radius) return false
    return true
  }

  legal(p: Point, radius: number): boolean {
    return this.staticLegal(p, radius) && this.unoccupied(p, radius)
  }
  private unoccupied(p: Point, radius: number): boolean {
    return !this.occupied.some(o => (p.x - o.x) ** 2 + (p.z - o.z) ** 2 < (radius + o.radius + .6) ** 2)
  }

  allocate(gateId: TownGateId, desired: Point, mounted: boolean) {
    const gate = TOWN_GATES.find(g => g.id === gateId)!, radius = mounted ? 1.8 : .7
    let point = { ...desired, yaw: gate.yaw }
    if (!this.legal(point, radius)) {
      const key = `${gateId}:${radius}`
      let candidates = this.candidates.get(key)
      if (!candidates) {
        candidates = []
        for (let inward = 10; inward <= 94; inward += 4.5) for (let side = -120; side <= 120; side += 4.5) {
          const p = townGatePoint(gate, side, inward)
          // Keep each replacement in its original wall's defensive sector.
          const gateDistance = Math.hypot(p.x - gate.x, p.z - gate.z)
          if (TOWN_GATES.some(other => other !== gate && Math.hypot(p.x - other.x, p.z - other.z) + 12 < gateDistance)) continue
          candidates.push({ point: p })
        }
        this.candidates.set(key, candidates)
      }
      let candidate: ReturnType<typeof townGatePoint> | undefined, best = Infinity
      for (const entry of candidates) {
        const p = entry.point
        const distance = (p.x - desired.x) ** 2 + (p.z - desired.z) ** 2
        // Keep authored tie ordering, but validate geometry only for candidates
        // that can improve this allocation. Legality is immutable in this pass;
        // occupancy still belongs to each actor and is always checked live.
        if (distance >= best || entry.legal === false) continue
        if (entry.legal === undefined) entry.legal = this.staticLegal(p, radius)
        if (entry.legal && this.unoccupied(p, radius)) { candidate = p; best = distance }
      }
      if (!candidate) throw new Error(`No clear ground garrison station in ${gateId}`)
      point = candidate
    }
    this.occupied.push({ ...point, radius })
    return { ...point, y: getTerrainHeight(point.x, point.z) }
  }
}
