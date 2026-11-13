import * as THREE from 'three'
import { segmentBoxTime } from '../combat/ShieldBlocking'
import { XONGKORO } from '../movement/XongkoroConfig'
import { eagleLandingFootprint, XONGKORO_LANDING, type EagleLandingPoint } from './EagleLanding'
import type { ObstacleData } from './Terrain'

/** Another airborne eagle, by live reference: where it is and where it is heading. */
export interface EagleTraffic { position: THREE.Vector3; velocity: THREE.Vector3 }

/** Seconds of another eagle's current heading treated as occupying the column. */
export const EAGLE_TRAFFIC_LOOKAHEAD = 4
const column = new THREE.Box3(), ahead = new THREE.Vector3()

/**
 * The one live airspace rule for vertical take-off and landing: the full wing
 * footprint between two world altitudes must hold no obstacle, no other airborne
 * eagle, and none about to fly through it.
 */
export function isEagleColumnClear(point: EagleLandingPoint, low: number, high: number,
  obstacles: readonly ObstacleData[], traffic: readonly EagleTraffic[] = []): boolean {
  const box = eagleLandingFootprint(point, column)
  box.min.y = low + .2; box.max.y = Math.max(high, low + .2)
  for (const obstacle of obstacles) if (box.intersectsBox(obstacle.box)) return false
  if (!traffic.length) return true
  const margin = XONGKORO.wingClearance + XONGKORO_LANDING.separation
  box.min.x -= margin; box.max.x += margin; box.min.z -= margin; box.max.z += margin
  box.min.y = low; box.max.y += XONGKORO.bodyHeight + XONGKORO_LANDING.separation
  for (const other of traffic) {
    if (box.containsPoint(other.position)) return false
    ahead.copy(other.position).addScaledVector(other.velocity, EAGLE_TRAFFIC_LOOKAHEAD)
    if (Number.isFinite(segmentBoxTime(other.position, ahead, box))) return false
  }
  return true
}

/**
 * Height above the pad at which an eagle may fly forward, arrive level or turn its
 * wings off the pad heading: above everything standing within hover-capture reach.
 */
export function eaglePadTransitionHeight(point: EagleLandingPoint, ground: number, obstacles: readonly ObstacleData[]): number {
  const box = eagleLandingFootprint(point, column)
  // A hover capture begins this far out, with the wings at any heading.
  const reach = XONGKORO.verticalCaptureRadius + XONGKORO.wingClearance + XONGKORO_LANDING.separation
  let top = ground
  for (const { box: other } of obstacles) {
    if (other.max.y <= top || other.min.x > box.max.x + reach || other.max.x < box.min.x - reach
      || other.min.z > box.max.z + reach || other.max.z < box.min.z - reach) continue
    top = other.max.y
  }
  return Math.min(XONGKORO.maxAltitude - 10, Math.max(XONGKORO.verticalTakeoffHeight,
    top - ground + XONGKORO.bodyHeight + XONGKORO_LANDING.separation))
}

const zoneA = new THREE.Box3(), zoneB = new THREE.Box3()
/** Two pads share airspace when one's wing footprint reaches into the other's traffic margin. */
export function eagleColumnsConflict(a: EagleLandingPoint, b: EagleLandingPoint): boolean {
  eagleLandingFootprint(a, zoneA); eagleLandingFootprint(b, zoneB)
  const margin = XONGKORO.wingClearance + XONGKORO_LANDING.separation
  return zoneA.min.x - margin < zoneB.max.x && zoneA.max.x + margin > zoneB.min.x
    && zoneA.min.z - margin < zoneB.max.z && zoneA.max.z + margin > zoneB.min.z
}
