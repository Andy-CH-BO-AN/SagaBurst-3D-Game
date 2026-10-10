import { EAGLE_APPROACH, eagleApproachDistance } from '../world/EagleApproach'
import { XONGKORO_LANDING } from '../world/EagleLanding'
import * as THREE from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'

export const TOWN_PATROL_WALL_OFFSET = 12.5
/** Saved positions from earlier Town layouts are rebased once, preserving actor identities. */
export const TOWN_LAYOUT_VERSION = 2
export const TOWN_CITY = { minX: -110, maxX: 150, minZ: -115, maxZ: 100, wallHeight: 8, wallThickness: 1.8, gateWidth: 14, gateHeight: 6 } as const
export const TOWN_PLAZA = { minX: -17, maxX: 18, minZ: -10, maxZ: 10 } as const
export const TOWN_PLAZA_CENTER = { x: (TOWN_PLAZA.minX + TOWN_PLAZA.maxX) / 2, z: (TOWN_PLAZA.minZ + TOWN_PLAZA.maxZ) / 2 } as const
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
/** Airfield layouts reserve these strips before any scenery is materialized. */
export const TOWN_PRIVATE_EAGLE_SITES = [-95, -65, -35].map(x => ({ x, z: 65, yaw: Math.PI }))
export const TOWN_GARRISON_EAGLE_SITES = [
  ...[-95, -65, -35].map(x => ({ x, z: -75, yaw: 0 })),
  ...[-95, -65].map(x => ({ x, z: -25, yaw: 0 })),
]
export const TOWN_HR_REGION = { minX: -94, maxX: -73, minZ: 18, maxZ: 35, yaw: 0 } as const
export interface TownRoad { ax: number; az: number; bx: number; bz: number; width: number }
/** Exact road rectangle, including the caller's clearance. */
export function townRoadIntersectsBox(road: TownRoad, box: THREE.Box3, clearance = 0): boolean {
  const transform = new THREE.Matrix4().makeRotationY(Math.atan2(road.bx - road.ax, road.bz - road.az))
  transform.setPosition((road.ax + road.bx) / 2, 0, (road.az + road.bz) / 2)
  return new OBB(new THREE.Vector3(), new THREE.Vector3(road.width / 2 + clearance, 100,
    Math.hypot(road.bx - road.ax, road.bz - road.az) / 2 + clearance)).applyMatrix4(transform).intersectsBox3(box)
}
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
  { ax: 0, az: 42, bx: -85, bz: 44, width: 5 },
]
/** Placement-time exclusion, including enough clearance for tree crowns and mounts. */
export function townSceneryExcluded(x: number, z: number, radius = 0): boolean {
  // The complete wing corridor extends beyond the wall. Keep visual trees and rocks
  // out before creating either their meshes or colliders.
  if ([...TOWN_PRIVATE_EAGLE_SITES, ...TOWN_GARRISON_EAGLE_SITES].some(pad => {
    const endZ = pad.z - Math.cos(pad.yaw) * eagleApproachDistance(40)
    const halfWidth = XONGKORO_LANDING.width / 2 + EAGLE_APPROACH.trackingMargin
    const halfDepth = XONGKORO_LANDING.depth / 2 + EAGLE_APPROACH.trackingMargin
    return Math.abs(x - pad.x) <= halfWidth + radius
      && z >= Math.min(pad.z, endZ) - halfDepth - radius && z <= Math.max(pad.z, endZ) + halfDepth + radius
  })) return true
  // Preserve the existing Cavalry Sweep charge lane as scenery moves outward.
  if (x >= -145 - radius && x <= 145 + radius && z >= -299 - radius && z <= -250 + radius) return true
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
