import * as THREE from 'three'
import { architectureLocalToWorld, type BuildingSpec } from '../town/architecture/ArchitectureSpecs'
import { findBlockingObstacleAlongPath, type ObstacleData } from '../world/Terrain'

/** Ramp safety line: a leaving body is released only once its centre is this far past the ramp foot. */
const OUTSIDE_CLEARANCE = 1
/** Distance from the threshold to the point on the door axis inside the hall, where a mounted body aligns. */
const INSIDE_ALIGNMENT = 2.5
const WAYPOINT_ARRIVAL = .35
/** How far a body that just left by the doorway may stand and still re-enter when ordered indoors. */
const ENTRY_REACH = 8

export interface CivicDoor {
  /** Door centre on the wall plane at floor height. */
  threshold: THREE.Vector3
  /** Unit horizontal direction leaving the hall through this door. */
  outward: THREE.Vector3
  /** Point on the door axis inside the hall, where a mounted body aligns first. */
  inside: THREE.Vector3
  /** Point on the door axis beyond the ramp foot; a leaving body is released after its safety line. */
  beyond: THREE.Vector3
  /** Distance from the threshold to the outer foot of the entrance ramp. */
  approach: number
  floorY: number
}

export interface CivicRect { minX: number; maxX: number; minZ: number; maxZ: number }

export interface CivicHall {
  id: string
  /** World XZ footprints of the walkable interior and its public vestibule. */
  rects: readonly CivicRect[]
  doors: readonly CivicDoor[]
}

type CivicSpecPlan = Pick<BuildingSpec, 'interior' | 'aisle' | 'entrance' | 'additionalEntrances'>

/** Derives a hall's doorway data from the same plan that generates its colliders, ramps and anchors. */
export function civicHallFromPlan(id: string, plan: CivicSpecPlan, site: { x: number; z: number; yaw: number }, floorY: number): CivicHall {
  const rects: CivicRect[] = []
  for (const r of [plan.interior, plan.aisle]) {
    if (!r) continue
    const corners = [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]].map(([x, z]) => architectureLocalToWorld(site, x, z))
    rects.push({
      minX: Math.min(...corners.map(c => c.x)), maxX: Math.max(...corners.map(c => c.x)),
      minZ: Math.min(...corners.map(c => c.z)), maxZ: Math.max(...corners.map(c => c.z)),
    })
  }
  const doors = [plan.entrance, ...plan.additionalEntrances ?? []].map(e => {
    const threshold = architectureLocalToWorld(site, e.x, e.z)
    const out = architectureLocalToWorld(site, e.x + Math.sin(e.yaw), e.z + Math.cos(e.yaw))
    const length = Math.hypot(out.x - threshold.x, out.z - threshold.z) || 1
    const outward = new THREE.Vector3((out.x - threshold.x) / length, 0, (out.z - threshold.z) / length)
    const inside = architectureLocalToWorld(site, e.x - Math.sin(e.yaw) * INSIDE_ALIGNMENT, e.z - Math.cos(e.yaw) * INSIDE_ALIGNMENT)
    const reach = e.approach + OUTSIDE_CLEARANCE + .5
    return {
      threshold: new THREE.Vector3(threshold.x, floorY, threshold.z),
      outward,
      inside: new THREE.Vector3(inside.x, floorY, inside.z),
      beyond: new THREE.Vector3(threshold.x + outward.x * reach, floorY, threshold.z + outward.z * reach),
      approach: e.approach,
      floorY,
    }
  })
  return { id, rects, doors }
}

/** Static check of one leg: no solid volume may block a body of this radius and height along it. */
function legClear(a: THREE.Vector3, b: THREE.Vector3, obstacles: ObstacleData[], radius: number, height: number): boolean {
  return findBlockingObstacleAlongPath(a, b, radius, height, 0, obstacles) === null
}

function routeClear(points: readonly THREE.Vector3[], obstacles: ObstacleData[], radius: number, height: number): boolean {
  for (let i = 1; i < points.length; i++) if (!legClear(points[i - 1], points[i], obstacles, radius, height)) return false
  return true
}

function insideHall(hall: CivicHall, p: { x: number; z: number }, margin = 0): boolean {
  return hall.rects.some(r => p.x > r.minX - margin && p.x < r.maxX + margin && p.z > r.minZ - margin && p.z < r.maxZ + margin)
}

export type CivicExitResult = { kind: 'walk'; target: THREE.Vector3 } | { kind: 'blocked' } | null

interface CivicExitRequest {
  position: THREE.Vector3
  goal: THREE.Vector3
  halls: readonly CivicHall[]
  radius: number
  height: number
  commandIdentity: number
  movementIntent: 'chase' | 'command'
}

/** Per-actor owner of a mounted body's walk through a civic doorway, in either direction. It follows fixed legs
 * from the door plan, validated statically against the same collision the body uses. It supplies only the next
 * waypoint; the actor's own attack, charge or formation intent is untouched. */
export class CivicExitRoute {
  private hall: CivicHall | null = null
  private door: CivicDoor | null = null
  /** +1 while leaving the hall, -1 while entering it again. */
  private direction: 1 | -1 = 1
  /** Set when a leave completes, so a later indoor command may bring the body back through this doorway. */
  private returning: { hall: CivicHall; identity: number } | null = null
  /** The newest real indoor command issued while leaving; only it may become the return. */
  private indoorCommand: { hall: CivicHall; identity: number } | null = null
  private waypoints: THREE.Vector3[] = []
  private index = 0
  private identity = -1
  private readonly out = new THREE.Vector3()

  clear(): void {
    this.hall = null
    this.door = null
    this.direction = 1
    this.waypoints.length = 0
    this.index = 0
  }

  /** null means ordinary routing owns the move; blocked means the doorway is statically sealed for this body. */
  resolve(request: CivicExitRequest, obstacles: ObstacleData[]): CivicExitResult {
    const { position: p, goal: g, halls, commandIdentity, movementIntent, radius, height } = request
    const isCommand = movementIntent === 'command'
    if (this.door && this.hall) {
      if (this.direction > 0) {
        // Before the doorway, a real command aimed indoors replaces the leave. Combat chase and enemy movement never do.
        // Once the body is at the threshold, the leave is committed to its safety line.
        const indoor = isCommand && insideHall(this.hall, g, .5)
        if (this.along(p) < 0 && commandIdentity !== this.identity && indoor) { this.clear(); return null }
        if (commandIdentity !== this.identity) this.indoorCommand = indoor ? { hall: this.hall, identity: commandIdentity } : null
        this.identity = commandIdentity
        if (this.passedDoor(p)) {
          const order = this.indoorCommand
          this.returning = order && order.identity === commandIdentity ? { hall: order.hall, identity: order.identity } : null
          this.clear()
          return null
        }
      } else {
        // Re-entering: any goal outside the hall, or a non-command order, ends the return.
        if (!isCommand || !insideHall(this.hall, g, .5)) { this.clear(); this.returning = null; return null }
        // The return completes only once the whole body is back inside; arrival is then ordinary formation arrival.
        if (this.along(p) <= -radius) { this.clear(); this.returning = null; return null }
        if (commandIdentity !== this.identity) {
          const hall = this.hall
          this.clear()
          if (!this.plan(hall, p, obstacles, radius, height, commandIdentity, -1)) { this.returning = null; return null }
        }
      }
    }
    if (!this.door) {
      const hall = halls.find(h => insideHall(h, p))
      if (hall) {
        this.returning = null
        this.indoorCommand = null
        if (insideHall(hall, g, .5)) return null
        if (!this.plan(hall, p, obstacles, radius, height, commandIdentity, 1)) return { kind: 'blocked' }
      } else {
        // Outside every hall: only the newest indoor command that left the hall may bring the body back through the same doorway.
        const returning = this.returning
        if (!returning || !isCommand || commandIdentity !== returning.identity || !insideHall(returning.hall, g, .5)
          || !returning.hall.doors.some(d => p.distanceTo(d.threshold) <= ENTRY_REACH)) {
          this.returning = null
          return null
        }
        if (!this.plan(returning.hall, p, obstacles, radius, height, commandIdentity, -1)) { this.returning = null; return null }
      }
    }
    return this.follow(p)
  }

  /** Signed distance along the current doorway's outward axis; negative is inside the hall. */
  private along(p: THREE.Vector3): number {
    const door = this.door!
    return (p.x - door.threshold.x) * door.outward.x + (p.z - door.threshold.z) * door.outward.z
  }

  private passedDoor(p: THREE.Vector3): boolean {
    return this.along(p) >= this.door!.approach + OUTSIDE_CLEARANCE
  }

  /** Fixed legs through the doorway. Candidates are the direct line and one lateral pivot on the door-aligned line,
   * tried in that order; a route is taken only if every leg is clear for this body. Leaving ends beyond the ramp,
   * entering ends with the whole body inside. If no candidate is clear, the doorway is sealed for this body. */
  private plan(hall: CivicHall, p: THREE.Vector3, obstacles: ObstacleData[], radius: number, height: number, identity: number, direction: 1 | -1): boolean {
    const doors = [...hall.doors].sort((a, b) => direction > 0 ? p.distanceTo(a.inside) - p.distanceTo(b.inside) : p.distanceTo(a.threshold) - p.distanceTo(b.threshold))
    for (const door of doors) {
      const routes = direction > 0
        ? [[p, door.inside, door.threshold, door.beyond],
          [p, new THREE.Vector3(door.inside.x, p.y, p.z), door.inside, door.threshold, door.beyond]]
        : [[p, door.threshold, door.inside],
          [p, new THREE.Vector3(door.threshold.x, p.y, p.z), door.threshold, door.inside]]
      const route = routes.find(candidate => routeClear(candidate, obstacles, radius, height))
      if (!route) continue
      this.hall = hall
      this.door = door
      this.direction = direction
      this.waypoints = route
      this.index = 1
      this.identity = identity
      return true
    }
    return false
  }

  private follow(p: THREE.Vector3): CivicExitResult {
    const waypoints = this.waypoints
    while (this.index < waypoints.length - 1) {
      const w = waypoints[this.index]
      if (Math.hypot(w.x - p.x, w.z - p.z) > WAYPOINT_ARRIVAL) break
      this.index++
    }
    this.out.copy(waypoints[this.index])
    return { kind: 'walk', target: this.out }
  }
}
