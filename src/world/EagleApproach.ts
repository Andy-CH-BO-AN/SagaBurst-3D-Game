import * as THREE from 'three'
import { getTerrainHeight, type ObstacleData } from './Terrain'
import { eagleLandingFootprint, XONGKORO_LANDING, type EagleLandingPoint } from './EagleLanding'

/** Full downstroke plus tracking margin above walls and parked eagles. */
export const EAGLE_APPROACH = { terminalDistance: 40, minimumHeight: 30, wingBelow: 7.46, trackingMargin: 2 } as const
export function eagleApproachDistance(cruiseAltitude: number): number {
  return Math.max(85, Math.max(EAGLE_APPROACH.minimumHeight, cruiseAltitude) * 2.7 + 15)
}
export function eagleApproachHeight(pad: EagleLandingPoint, along: number, cruiseAltitude: number,
  terrain: (x: number, z: number) => number = getTerrainHeight): number {
  return terrain(pad.x, pad.z) + Math.max(EAGLE_APPROACH.minimumHeight, cruiseAltitude)
    * THREE.MathUtils.clamp(along / EAGLE_APPROACH.terminalDistance, 0, 1)
}
/** The reciprocal heading is a different, unreserved corridor. */
export function isEagleApproachClear(pad: EagleLandingPoint, obstacles: readonly ObstacleData[],
  occupied: readonly EagleLandingPoint[] = [], bound = 350, cruiseAltitude = 40,
  terrain: (x: number, z: number) => number = getTerrainHeight): boolean {
  const distance = eagleApproachDistance(cruiseAltitude), sin = Math.sin(pad.yaw ?? 0), cos = Math.cos(pad.yaw ?? 0)
  const parked = occupied.map(other => {
    const box = eagleLandingFootprint(other)
    box.min.y = terrain(other.x, other.z); box.max.y = box.min.y + XONGKORO_LANDING.verticalClearance
    return box
  })
  const box = new THREE.Box3()
  for (let along = 0; along <= distance; along += .5) {
    const point = { x: pad.x - sin * along, z: pad.z - cos * along, yaw: pad.yaw }
    eagleLandingFootprint(point, box)
    if (box.min.x < -bound || box.max.x > bound || box.min.z < -bound || box.max.z > bound) return false
    const height = eagleApproachHeight(pad, along, cruiseAltitude, terrain)
    box.min.y = height - EAGLE_APPROACH.wingBelow - EAGLE_APPROACH.trackingMargin
    box.max.y = height + XONGKORO_LANDING.verticalClearance + EAGLE_APPROACH.trackingMargin
    if (along >= EAGLE_APPROACH.terminalDistance) {
      for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {
        if (box.min.y <= terrain(x, z)) return false
      }
    }
    if (obstacles.some(other => box.intersectsBox(other.box)) || parked.some(other => box.intersectsBox(other))) return false
  }
  return true
}
