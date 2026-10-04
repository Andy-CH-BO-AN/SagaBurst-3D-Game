export const TOWN_PATROL_WALL_OFFSET = 12.5
export const TOWN_CITY = { minX: -110, maxX: 150, minZ: -115, maxZ: 100, wallHeight: 8, wallThickness: 1.8, gateWidth: 14, gateHeight: 6 } as const
export type TownGateId = 'north' | 'south' | 'east' | 'west'
export interface TownGateSpec { id: TownGateId; x: number; z: number; yaw: number }
/** Local +Z points outwards; leaves swing inward, away from the main passage. */
export const TOWN_GATES: readonly TownGateSpec[] = [
  { id: 'north', x: 0, z: TOWN_CITY.minZ, yaw: Math.PI },
  { id: 'south', x: 0, z: TOWN_CITY.maxZ, yaw: 0 },
  { id: 'east', x: TOWN_CITY.maxX, z: 45, yaw: Math.PI / 2 },
  { id: 'west', x: TOWN_CITY.minX, z: 0, yaw: -Math.PI / 2 },
]
export function townGatePoint(gate: TownGateSpec, side: number, inward: number) {
  return { x: gate.x + Math.cos(gate.yaw) * side - Math.sin(gate.yaw) * inward,
    z: gate.z - Math.sin(gate.yaw) * side - Math.cos(gate.yaw) * inward, yaw: gate.yaw }
}
export const TOWN_CAVALRY_FIELD = { minX: 27, maxX: 137, minZ: -101, maxZ: -53 } as const
/** Shared mounted mission muster on the open forecourt in front of the cavalry entrance. */
export const TOWN_MOUNTED_MISSION_MUSTER = { x: 124, z: -30 } as const
export interface TownRoad { ax: number; az: number; bx: number; bz: number; width: number }
export const TOWN_CITY_ROADS: readonly TownRoad[] = [
  { ax: 0, az: 0, bx: 18, bz: -20, width: 10 },
  { ax: 18, az: -20, bx: 18, bz: -55, width: 10 },
  { ax: 18, az: -55, bx: 0, bz: -65, width: 10 },
  { ax: 0, az: -65, bx: 0, bz: -137, width: 12 },
  { ax: 0, az: 0, bx: 0, bz: 122, width: 12 },
  { ax: 0, az: 0, bx: 0, bz: 42, width: 12 },
  { ax: 0, az: 42, bx: 172, bz: 45, width: 12 },
  { ax: 0, az: 0, bx: -22, bz: 6, width: 8 },
  { ax: -22, az: 6, bx: -65, bz: 6, width: 8 },
  { ax: -65, az: 6, bx: -78, bz: 0, width: 10 },
  { ax: -78, az: 0, bx: -132, bz: 0, width: 12 },
  { ax: 18, az: -55, bx: 27, bz: -58, width: 8 },
  { ax: 27, az: -58, bx: 137, bz: -58, width: 8 },
]
/** Placement-time exclusion, including enough clearance for tree crowns and mounts. */
export function townSceneryExcluded(x: number, z: number, radius = 0): boolean {
  if (x >= TOWN_CITY.minX - radius - 4 && x <= TOWN_CITY.maxX + radius + 4
    && z >= TOWN_CITY.minZ - radius - 4 && z <= TOWN_CITY.maxZ + radius + 4) return true
  const exteriorDistance = Math.hypot(Math.max(TOWN_CITY.minX - x, 0, x - TOWN_CITY.maxX), Math.max(TOWN_CITY.minZ - z, 0, z - TOWN_CITY.maxZ))
  if (radius <= 7 && Math.abs(exteriorDistance - TOWN_PATROL_WALL_OFFSET) < radius + 6) return true
  return TOWN_CITY_ROADS.some(road => {
    const dx = road.bx - road.ax, dz = road.bz - road.az
    const t = Math.max(0, Math.min(1, ((x - road.ax) * dx + (z - road.az) * dz) / (dx * dx + dz * dz)))
    return Math.hypot(x - road.ax - t * dx, z - road.az - t * dz) < road.width / 2 + radius + 4
  })
}
