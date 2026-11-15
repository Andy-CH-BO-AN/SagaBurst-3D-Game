import * as THREE from 'three'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { TOWN_CITY,TOWN_GATES,townGatePoint,type TownGateId } from '../town/TownLayout'

export const siegeGate = (id: TownGateId) => TOWN_GATES.find(gate => gate.id === id)!
export const siegeOutward = (id: TownGateId) => new THREE.Vector3(Math.sin(siegeGate(id).yaw), 0, Math.cos(siegeGate(id).yaw))
export function siegePoint(id: TownGateId, side: number, inward: number): THREE.Vector3 {
  const p = townGatePoint(siegeGate(id), side, inward)
  return new THREE.Vector3(p.x, 0, p.z)
}
/** Nearest gate owns the local defense sector, including just outside its breach. */
export function siegeNearestGate(point: THREE.Vector3): TownGateId {
  return TOWN_GATES.reduce((nearest, gate) =>
    (point.x - gate.x) ** 2 + (point.z - gate.z) ** 2 < (point.x - nearest.x) ** 2 + (point.z - nearest.z) ** 2 ? gate : nearest).id
}
export function siegeReservePoint(id: TownGateId, index: number): THREE.Vector3 {
  return siegePoint(id, (index % 5 - 2) * 5, 30 + Math.floor(index / 5) * 5)
}
export function siegeMuster(id: TownGateId, slot = 0): THREE.Vector3 {
  const direction = siegeOutward(id), gate = siegeGate(id)
  const extent = TOWN_PLAYABLE_WORLD_BOUND - 45
  const center = new THREE.Vector3(Math.abs(direction.x) > .5 ? direction.x * extent : gate.x, 0,
    Math.abs(direction.z) > .5 ? direction.z * extent : gate.z)
  return center.add(new THREE.Vector3(direction.z, 0, -direction.x).multiplyScalar((slot % 6 - 2.5) * 5))
    .addScaledVector(direction, Math.floor(slot / 6) * 5)
}
export function insideSiegeTown(point: THREE.Vector3): boolean {
  return point.x > TOWN_CITY.minX && point.x < TOWN_CITY.maxX && point.z > TOWN_CITY.minZ && point.z < TOWN_CITY.maxZ
}
