import * as THREE from 'three'
import { TOWN_CITY, TOWN_GATES, TOWN_PATROL_WALL_OFFSET, townGatePoint, type TownGateId } from './TownLayout'
import type { TownPatrolId } from './TownRules'

export { TOWN_PATROL_WALL_OFFSET } from './TownLayout'
export const TOWN_PATROL_SPEED = 5

/** Clockwise in the X/Z map: north → east → south → west, with rounded corners. */
export function townPatrolRoute(): THREE.Vector3[] {
  const { minX, maxX, minZ, maxZ } = TOWN_CITY, r = TOWN_PATROL_WALL_OFFSET
  const points: THREE.Vector3[] = []
  const line = (x: number, z: number) => {
    const end = new THREE.Vector3(x, 0, z), start = points[points.length - 1]
    if (start) {
      const steps = Math.ceil(start.distanceTo(end) / 16)
      for (let i = 1; i < steps; i++) points.push(start.clone().lerp(end, i / steps))
    }
    points.push(end)
  }
  const corner = (x: number, z: number, start: number) => {
    for (let i = 1; i <= 4; i++) {
      const a = start + i * Math.PI / 8
      line(x + Math.cos(a) * r, z + Math.sin(a) * r)
    }
  }
  line(minX, minZ - r); line(maxX, minZ - r); corner(maxX, minZ, -Math.PI / 2)
  line(maxX + r, TOWN_GATES.find(g => g.id === 'east')!.z)
  line(maxX + r, maxZ); corner(maxX, maxZ, 0)
  line(minX, maxZ + r); corner(minX, maxZ, Math.PI / 2)
  line(minX - r, TOWN_GATES.find(g => g.id === 'west')!.z)
  line(minX - r, minZ); corner(minX, minZ, Math.PI)
  points.pop() // The final segment closes back onto waypoint zero.
  return points
}

export function townPatrolDeparture(id: TownPatrolId, route = townPatrolRoute()) {
  const gateId: TownGateId = id === 'A' ? 'east' : 'west'
  const gate = TOWN_GATES.find(g => g.id === gateId)!
  const exterior = townGatePoint(gate, 0, -TOWN_PATROL_WALL_OFFSET)
  const phase = route.findIndex(p => Math.hypot(p.x - exterior.x, p.z - exterior.z) < .01)
  // Approach via existing road junctions; the last two points straddle the open doorway.
  const roads = id === 'A' ? [[100, 45], [130, 45]] : [[0, 42], [0, 6], [-65, 6], [-78, 0]]
  const inside = townGatePoint(gate, 0, 8)
  const waypoints = [...roads.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    new THREE.Vector3(inside.x, 0, inside.z), new THREE.Vector3(exterior.x, 0, exterior.z)]
  return { gateId, phase, direction: 'clockwise' as const, waypoints }
}
