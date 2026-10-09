import * as THREE from 'three'
import { MAX_PLAYER_OWNED_XONGKORO } from '../career/CareerInventory'
import type { EaglePad } from '../career/EaglePadReservations'
import { type ObstacleData } from '../world/Terrain'
import { TOWN_CITY, TOWN_GATES, TOWN_PATROL_WALL_OFFSET, TOWN_CAVALRY_FIELD, TOWN_MOUNTED_MISSION_MUSTER, type TownRoad } from './TownLayout'
import { TOWN_BANDIT_CAMP_CENTERS, TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
import { townRoster, type TownActorSpec } from './TownRules'
import type { TownHRLayout } from './TownHRLayout'
import { XONGKORO_LANDING, eagleLandingFootprint, isEagleLandingClear } from '../world/EagleLanding'

export const EAGLE_TRAINING_GROUND_NAME = 'xongkoro Eagle Training Ground · 老鷹訓練場'
export interface TownEagleTrainingGround {
  site: { x: number; z: number; yaw: number }
  trainer: { x: number; z: number; yaw: number }
  /** Actual private parking spaces; candidates are not built or assigned. */
  pads: EaglePad[]
  candidatePads: { x: number; z: number; yaw: number }[]
}

/** Search the built world: every pad reserves full wingspan, road, patrol and mission clearance. */
export function resolveTownEagleTrainingGround(obstacles: readonly ObstacleData[], roads: readonly TownRoad[], hr: TownHRLayout): TownEagleTrainingGround {
  const residents = townRoster()
  const reserved = [new THREE.Box3(new THREE.Vector3(TOWN_CAVALRY_FIELD.minX, -100, TOWN_CAVALRY_FIELD.minZ),
    new THREE.Vector3(TOWN_CAVALRY_FIELD.maxX, 100, TOWN_CAVALRY_FIELD.maxZ)),
    new THREE.Box3().setFromPoints(hr.muster.map(p => new THREE.Vector3(p.x, 0, p.z))).expandByVector(new THREE.Vector3(3, 100, 3))]
  const candidates: TownEagleTrainingGround['candidatePads'] = []
  const clear = (point: { x: number; z: number; yaw: number }) => {
    if (!isEagleLandingClear(point, obstacles, candidates, TOWN_PLAYABLE_WORLD_BOUND)) return false
    const box = eagleLandingFootprint(point)
    if (candidates[0] && box.clone().expandByScalar(3).containsPoint(new THREE.Vector3(
      candidates[0].x, 0, candidates[0].z + XONGKORO_LANDING.depth / 2 + 2))) return false
    if (reserved.some(other => box.intersectsBox(other))) return false
    if (residents.some(p => box.clone().expandByScalar(3).containsPoint(new THREE.Vector3(p.x, 0, p.z)))) return false
    if (TOWN_BANDIT_CAMP_CENTERS.some(([x, z]) => Math.hypot(point.x - x, point.z - z) < 55)) return false
    if (Math.hypot(point.x - TOWN_MOUNTED_MISSION_MUSTER.x, point.z - TOWN_MOUNTED_MISSION_MUSTER.z) < 35) return false
    // Existing patrols travel around the wall; their route must remain open.
    const exterior = Math.hypot(Math.max(TOWN_CITY.minX - point.x, 0, point.x - TOWN_CITY.maxX), Math.max(TOWN_CITY.minZ - point.z, 0, point.z - TOWN_CITY.maxZ))
    if (exterior > 0 && exterior < TOWN_PATROL_WALL_OFFSET + XONGKORO_LANDING.width) return false
    if (point.z < -230 && Math.abs(point.x) < 160) return false
    if (TOWN_GATES.some(gate => Math.hypot(point.x - gate.x, point.z - gate.z) < 30)) return false
    return !roads.some(road => box.intersectsBox(new THREE.Box3(
      new THREE.Vector3(Math.min(road.ax, road.bx) - road.width / 2 - 2, -100, Math.min(road.az, road.bz) - road.width / 2 - 2),
      new THREE.Vector3(Math.max(road.ax, road.bx) + road.width / 2 + 2, 100, Math.max(road.az, road.bz) + road.width / 2 + 2))))
  }
  // Candidate search is separate from the finite built parking layout.
  for (let ring = 1; ring <= 48 && candidates.length < 30; ring++) {
    for (let step = 0; step < ring * 8 && candidates.length < 30; step++) {
      const angle = step / (ring * 8) * Math.PI * 2
      const point = { x: hr.officer.x + Math.sin(angle) * ring * 8, z: hr.officer.z + Math.cos(angle) * ring * 8, yaw: 0 }
      if (!clear(point)) continue
      candidates.push(point)
    }
  }
  if (candidates.length < MAX_PLAYER_OWNED_XONGKORO) throw new Error('No clear three-pad xongkoro training ground in the built Town')
  const pads = candidates.slice(0, MAX_PLAYER_OWNED_XONGKORO).map((point, index) => ({ ...point, id: `private-eagle-pad:${index + 1}` }))
  const site = pads[0]
  const trainer = { x: site.x, z: site.z + XONGKORO_LANDING.depth / 2 + 2, yaw: Math.PI }
  return { site, trainer, pads, candidatePads: candidates }
}

export function eagleTrainerSpec(layout: TownEagleTrainingGround): TownActorSpec {
  return { id: 'eagle-trainer', role: 'eagle-trainer', duty: 'service', tier: 4, mounted: false,
    training: false, assaultObjective: true, index: 0, ...layout.trainer }
}
