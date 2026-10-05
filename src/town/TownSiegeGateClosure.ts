import * as THREE from 'three'
import type { CampaignGateController } from '../campaign/CampaignGate'
import type { TownGateId } from './TownLayout'
import type { ObstacleData } from '../world/Terrain'
import { getTerrainHeight } from '../world/Terrain'
import { siegeOutward } from '../career/TownSiege'

export interface GateClosureBody {
  position: THREE.Vector3
  radius: number
  /** A mounted body moves rider and mount together. This never emits combat damage. */
  moveTo(point: THREE.Vector3): void
}
export function overlapsGateClosure(box: THREE.Box3, position: THREE.Vector3, radius: number): boolean {
  return position.x + radius >= box.min.x && position.x - radius <= box.max.x
    && position.z + radius >= box.min.z && position.z - radius <= box.max.z
}

/** Plan every displacement first, then move the overlapping bodies and use the normal close API. */
export function closeSiegeGate(id: TownGateId, gate: CampaignGateController, bodies: readonly GateClosureBody[], obstacles: readonly ObstacleData[]): boolean {
  if (gate.state !== 'open') return true
  const outward = siegeOutward(id), tangent = new THREE.Vector3(outward.z, 0, -outward.x)
  const plans: { body: GateClosureBody; point: THREE.Vector3 }[] = []
  const box = gate.collisionBox
  const center = box.getCenter(new THREE.Vector3()).setY(0)
  for (const body of bodies) {
    if (!overlapsGateClosure(box, body.position, body.radius)) continue
    let best: THREE.Vector3 | undefined, bestDistance = Infinity
    for (let forward = 1; forward <= 60; forward += 1) {
      for (let sideways = -14; sideways <= 14; sideways += 1) {
        const point = body.position.clone().addScaledVector(outward, forward).addScaledVector(tangent, sideways)
        if (point.clone().sub(center).dot(outward) < body.radius + .6 || overlapsGateClosure(box, point, body.radius + .15)) continue
        if (obstacles.some(obstacle => !obstacle.damageable?.destroyed && overlapsGateClosure(obstacle.navigationBox ?? obstacle.box, point, body.radius + .15))) continue
        if (plans.some(plan => plan.point.distanceToSquared(point) < (plan.body.radius + body.radius + .2) ** 2)) continue
        const distance = forward * forward + sideways * sideways
        if (distance < bestDistance) { best = point; bestDistance = distance }
      }
      if (best && forward * forward > bestDistance) break
    }
    if (!best) return false
    best.y = getTerrainHeight(best.x, best.z)
    plans.push({ body, point: best })
  }
  for (const plan of plans) plan.body.moveTo(plan.point)
  return gate.close(false)
}
