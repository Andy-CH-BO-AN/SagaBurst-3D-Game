import * as THREE from 'three'
import { getTerrainHeight, type ObstacleData } from './Terrain'

/** Full wing clearance, including the 13.91 m standing/flight transition envelope. */
export const XONGKORO_LANDING = { width: 24, depth: 14, verticalClearance: 14.5, maxHeightDifference: 3, separation: 3 } as const
export interface EagleLandingPoint { x: number; z: number; yaw?: number }
export function eagleLandingFootprint(point: EagleLandingPoint, target = new THREE.Box3()): THREE.Box3 {
  const cosine = Math.abs(Math.cos(point.yaw ?? 0)), sine = Math.abs(Math.sin(point.yaw ?? 0))
  const halfX = (XONGKORO_LANDING.width * cosine + XONGKORO_LANDING.depth * sine) / 2
  const halfZ = (XONGKORO_LANDING.width * sine + XONGKORO_LANDING.depth * cosine) / 2
  target.min.set(point.x - halfX, -100, point.z - halfZ)
  target.max.set(point.x + halfX, 100, point.z + halfZ)
  return target
}
const clearanceBox = new THREE.Box3(), occupiedBox = new THREE.Box3()
export function isEagleLandingClear(point: EagleLandingPoint, obstacles: readonly ObstacleData[],
  occupied: readonly EagleLandingPoint[] = [], bound = 300,
  terrainHeight: (x: number, z: number) => number = getTerrainHeight): boolean {
  const box = eagleLandingFootprint(point, clearanceBox)
  if (box.min.x < -bound || box.max.x > bound || box.min.z < -bound || box.max.z > bound) return false
  let minHeight = terrainHeight(point.x, point.z), maxHeight = minHeight
  for (let corner = 0; corner < 4; corner++) {
    const height = terrainHeight(corner & 1 ? box.min.x : box.max.x, corner & 2 ? box.min.z : box.max.z)
    minHeight = Math.min(minHeight, height); maxHeight = Math.max(maxHeight, height)
  }
  if (maxHeight - minHeight > XONGKORO_LANDING.maxHeightDifference) return false
  box.min.y = minHeight + .2; box.max.y = maxHeight + XONGKORO_LANDING.verticalClearance
  if (obstacles.some(obstacle => box.intersectsBox(obstacle.box))) return false
  return !occupied.some(other => box.intersectsBox(eagleLandingFootprint(other, occupiedBox).expandByScalar(XONGKORO_LANDING.separation)))
}

export function findEagleLandingPosition(origin: EagleLandingPoint, obstacles: readonly ObstacleData[],
  occupied: readonly EagleLandingPoint[] = [], bound = 300, searchRadius = 45): THREE.Vector3 | null {
  for (let radius = 0; radius <= searchRadius; radius += 5) for (let step = 0; step < (radius ? 16 : 1); step++) {
    const angle = step / 16 * Math.PI * 2
    const point = { x: origin.x + Math.sin(angle) * radius, z: origin.z + Math.cos(angle) * radius, yaw: origin.yaw ?? 0 }
    if (isEagleLandingClear(point, obstacles, occupied, bound)) return new THREE.Vector3(point.x, getTerrainHeight(point.x, point.z), point.z)
  }
  return null
}
