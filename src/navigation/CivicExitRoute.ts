import * as THREE from 'three'
import { architectureLocalToWorld, type BuildingSpec } from '../town/architecture/ArchitectureSpecs'
import type { ObstacleData } from '../world/Terrain'
import { NavigationGrid, type NavigationCell } from './NavigationGrid'

/** Clearance grid for one civic hall. Local to the hall; the global A* grid is untouched. */
export const CIVIC_EXIT_CELL_SIZE = 0.5
/** Frames without progress before the exit replans from where the body stands. A jam alone never
 * fails the exit: only a clearance route that is sealed through the doorway does. */
export const CIVIC_EXIT_STALL_FRAMES = 180
const PROGRESS_DISTANCE = 0.5
const WAYPOINT_ARRIVAL = 0.35
const REPLAN_DISTANCE_SQ = 4
const OUTSIDE_CLEARANCE = 1
const INSIDE_ALIGNMENT = 2.5
const GRID_MARGIN = 6

export interface CivicDoor {
  /** Door centre on the wall plane at floor height. */
  threshold: THREE.Vector3
  /** Unit horizontal direction leaving the hall through this door. */
  outward: THREE.Vector3
  /** Point on the door axis inside the hall; mounted units align here first. */
  inside: THREE.Vector3
  /** Distance from threshold to the outer foot of the entrance ramp. */
  approach: number
  floorY: number
}

export interface CivicRect { minX: number; maxX: number; minZ: number; maxZ: number }

export interface CivicHall {
  id: string
  /** World XZ footprints of the walkable interior and its public vestibule (not their bounding box). */
  rects: readonly CivicRect[]
  /** Bounding box of `rects`, used only to size the clearance grid. */
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  doors: readonly CivicDoor[]
}

type CivicSpecPlan = Pick<BuildingSpec, 'interior' | 'aisle' | 'entrance' | 'additionalEntrances'>

/** Derives a hall's exit data from the same plan that generates colliders and ramps. */
export function civicHallFromPlan(id: string, plan: CivicSpecPlan, site: { x: number; z: number; yaw: number }, floorY: number): CivicHall {
  const local = [plan.interior, plan.aisle].filter((r): r is NonNullable<typeof r> => Boolean(r))
  const rects: CivicRect[] = []
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const r of local) {
    const corners = [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]].map(([x, z]) => architectureLocalToWorld(site, x, z))
    const rect = { minX: Math.min(...corners.map(c => c.x)), maxX: Math.max(...corners.map(c => c.x)), minZ: Math.min(...corners.map(c => c.z)), maxZ: Math.max(...corners.map(c => c.z)) }
    rects.push(rect)
    minX = Math.min(minX, rect.minX); maxX = Math.max(maxX, rect.maxX); minZ = Math.min(minZ, rect.minZ); maxZ = Math.max(maxZ, rect.maxZ)
  }
  const doors = [plan.entrance, ...plan.additionalEntrances ?? []].map(e => {
    const threshold = architectureLocalToWorld(site, e.x, e.z)
    const out = architectureLocalToWorld(site, e.x + Math.sin(e.yaw), e.z + Math.cos(e.yaw))
    const length = Math.hypot(out.x - threshold.x, out.z - threshold.z) || 1
    const inside = architectureLocalToWorld(site, e.x - Math.sin(e.yaw) * INSIDE_ALIGNMENT, e.z - Math.cos(e.yaw) * INSIDE_ALIGNMENT)
    return {
      threshold: new THREE.Vector3(threshold.x, floorY, threshold.z),
      outward: new THREE.Vector3((out.x - threshold.x) / length, 0, (out.z - threshold.z) / length),
      inside: new THREE.Vector3(inside.x, floorY, inside.z),
      approach: e.approach,
      floorY,
    }
  })
  return { id, rects, minX, maxX, minZ, maxZ, doors }
}

interface HallGrid { revision: number; count: number; radius: number; grid: NavigationGrid }
const hallGrids = new WeakMap<CivicHall, HallGrid>()

/** Clearance-inflated local grid. Posts and walls block a rider's body, not just the centre cell.
 * Rebuilt only when the scene's navigation topology revision changes (wall damage, rebuilds). */
function clearanceGrid(hall: CivicHall, obstacles: readonly ObstacleData[], revision: number, radius: number, height: number): NavigationGrid {
  const cached = hallGrids.get(hall)
  if (cached && cached.revision === revision && cached.count === obstacles.length && cached.radius === radius) return cached.grid
  const floorY = hall.doors[0]?.floorY ?? 0
  const bounds = { minX: hall.minX - GRID_MARGIN, maxX: hall.maxX + GRID_MARGIN, minZ: hall.minZ - GRID_MARGIN, maxZ: hall.maxZ + GRID_MARGIN }
  const grid = new NavigationGrid({ ...bounds, cellSize: CIVIC_EXIT_CELL_SIZE })
  for (const o of obstacles) {
    // Floors, ramps and physically passable ledges never stop a body; overhead volumes above the head do not either.
    if (o.walkSurface || o.physicalPassable || o.box.isEmpty()) continue
    if (o.box.max.y <= floorY + .3 || o.box.min.y >= floorY + height) continue
    if (o.box.max.x < bounds.minX - radius || o.box.min.x > bounds.maxX + radius
      || o.box.max.z < bounds.minZ - radius || o.box.min.z > bounds.maxZ + radius) continue
    grid.setBlockedBox(o.box, true, radius + .05)
  }
  hallGrids.set(hall, { revision, count: obstacles.length, radius, grid })
  return grid
}

export type CivicExitResult = { kind: 'walk'; target: THREE.Vector3 } | { kind: 'blocked' } | null

interface CivicExitRequest {
  position: THREE.Vector3
  goal: THREE.Vector3
  halls: readonly CivicHall[]
  revision: number
  radius: number
  height: number
  commandIdentity: number
  movementIntent: 'chase' | 'command'
}

function insideHall(hall: CivicHall, p: { x: number; z: number }, margin = 0): boolean {
  return hall.rects.some(r => p.x > r.minX - margin && p.x < r.maxX + margin && p.z > r.minZ - margin && p.z < r.maxZ + margin)
}

/** How far a body that just left by a doorway may be and still enter through it when ordered back in. */
const ENTRY_REACH = 8

/** Per-actor owner of a mounted rider's walk out of a civic hall, and back in through the same doorway
 * when a real command orders it indoors. It only supplies the next local waypoint; the actor's
 * attack/charge/formation intent is untouched, and the actor applies civic steering while it is returned.
 */
export class CivicExitRoute {
  private hall: CivicHall | null = null
  private door: CivicDoor | null = null
  /** +1 while leaving the hall, -1 while entering it again. */
  private direction: 1 | -1 = 1
  /** Set when an exit completes, so a later indoor command can bring the body back through this doorway. */
  private returning: { hall: CivicHall; identity: number } | null = null
  /** The newest real indoor command issued while leaving; only it may become the return. */
  private indoorCommand: { hall: CivicHall; identity: number } | null = null
  private waypoints: THREE.Vector3[] = []
  private index = 0
  private revision = -1
  private identity = -1
  private stalledFrames = 0
  private progressAnchor = new THREE.Vector3()
  private failedRevision = -1
  private readonly failedAt = new THREE.Vector3()
  private readonly out = new THREE.Vector3()

  clear(): void {
    this.hall = null
    this.door = null
    this.direction = 1
    this.waypoints.length = 0
    this.index = 0
    this.stalledFrames = 0
  }

  /** null means ordinary routing owns the move (not leaving or entering a civic hall). */
  resolve(request: CivicExitRequest, obstacles: readonly ObstacleData[]): CivicExitResult {
    const { position: p, goal: g, halls, revision, commandIdentity, movementIntent } = request
    const isCommand = movementIntent === 'command'
    if (this.door && this.hall) {
      if (this.direction > 0) {
        // Before the doorway, a real command aimed indoors replaces the exit intent. Combat chase and enemy
        // movement never do, and once the body is at the threshold the exit is committed to the safety line.
        const indoor = isCommand && insideHall(this.hall, g, .5)
        if (this.along(p) < 0 && commandIdentity !== this.identity && indoor) { this.clear(); return null }
        if (commandIdentity !== this.identity) this.indoorCommand = indoor ? { hall: this.hall, identity: commandIdentity } : null
        this.identity = commandIdentity
        if (this.passedDoor(p)) {
          // Only the newest command, still aimed indoors, may bring the body back through this doorway.
          const order = this.indoorCommand
          this.returning = order && order.identity === commandIdentity ? { hall: order.hall, identity: order.identity } : null
          this.clear()
          return null
        }
      } else {
        // Entering again: any non-command or outdoor order ends the return; a newer indoor command re-routes it.
        if (!isCommand || !insideHall(this.hall, g, .5)) { this.clear(); this.returning = null; return null }
        if (commandIdentity !== this.identity) {
          const hall = this.hall
          this.clear()
          if (!this.plan(hall, p, g, obstacles, revision, request.radius, request.height, commandIdentity, -1)) { this.returning = null; return null }
        }
        this.identity = commandIdentity
        if (this.entryArrived(p, g)) { this.clear(); this.returning = null; return null }
      }
      // Topology changes (e.g. a wall breach) or a long jam replan from here through the same doorway,
      // including on the ramp before the safety line, so ordinary routing never takes over early.
      if (revision !== this.revision || this.stalledFrames > CIVIC_EXIT_STALL_FRAMES) {
        const hall = this.hall, direction = this.direction
        this.clear()
        if (!this.plan(hall, p, g, obstacles, revision, request.radius, request.height, commandIdentity, direction)) {
          if (direction > 0) return this.reject(p, revision)
          this.returning = null
          return null
        }
      }
    }
    if (!this.door) {
      const hall = halls.find(h => insideHall(h, p))
      if (hall) {
        this.returning = null
        this.indoorCommand = null
        if (insideHall(hall, g, .5)) return null
        if (this.failedRevision === revision && p.distanceToSquared(this.failedAt) < REPLAN_DISTANCE_SQ) return { kind: 'blocked' }
        if (!this.plan(hall, p, g, obstacles, revision, request.radius, request.height, commandIdentity, 1)) return this.reject(p, revision)
      } else {
        // Outside every hall: a return needs the same live, newest indoor command that left the hall.
        const returning = this.returning
        if (!returning || !isCommand || commandIdentity !== returning.identity || !insideHall(returning.hall, g, .5)
          || !returning.hall.doors.some(d => p.distanceTo(d.threshold) <= ENTRY_REACH)) {
          this.returning = null
          return null
        }
        if (!this.plan(returning.hall, p, g, obstacles, revision, request.radius, request.height, commandIdentity, -1)) {
          this.returning = null
          return null
        }
      }
    }
    return this.follow(p)
  }

  /** Only a static sealed route is cached as a failure; a jam never is. */
  private reject(p: THREE.Vector3, revision: number): CivicExitResult {
    this.failedRevision = revision
    this.failedAt.copy(p)
    return { kind: 'blocked' }
  }

  /** Signed distance along the current doorway's outward axis; negative is inside the hall. */
  private along(p: THREE.Vector3): number {
    const door = this.door!
    return (p.x - door.threshold.x) * door.outward.x + (p.z - door.threshold.z) * door.outward.z
  }

  /** An entering route ends at the indoor goal (its clear cell), not at the doorway. */
  private entryArrived(p: THREE.Vector3, g: THREE.Vector3): boolean {
    const last = this.waypoints[this.waypoints.length - 1]
    if (Math.hypot(p.x - g.x, p.z - g.z) < 1) return true
    return this.index >= this.waypoints.length - 1 && Math.hypot(p.x - last.x, p.z - last.z) < 1
  }

  private passedDoor(p: THREE.Vector3): boolean {
    const along = this.along(p)
    return this.direction > 0 ? along >= this.door!.approach + OUTSIDE_CLEARANCE : along <= -OUTSIDE_CLEARANCE
  }

  private plan(hall: CivicHall, p: THREE.Vector3, g: THREE.Vector3, obstacles: readonly ObstacleData[], revision: number, radius: number, height: number, identity: number, direction: 1 | -1): boolean {
    const grid = clearanceGrid(hall, obstacles, revision, radius, height)
    const doors = [...hall.doors].sort((a, b) => direction > 0
      ? (p.distanceTo(a.inside) + a.inside.distanceTo(g)) - (p.distanceTo(b.inside) + b.inside.distanceTo(g))
      : p.distanceTo(a.threshold) - p.distanceTo(b.threshold))
    for (const door of doors) {
      const route = this.route(grid, p, door, direction, g)
      if (!route) continue
      this.hall = hall
      this.door = door
      this.direction = direction
      this.waypoints = route
      this.index = 0
      this.revision = revision
      this.identity = identity
      this.stalledFrames = 0
      this.progressAnchor.copy(p)
      return true
    }
    return false
  }

  /** Leaving routes to the point beyond the ramp, so a doorway sealed for the body fails here, statically.
   * Entering routes to the point on the door axis inside the hall. */
  private route(grid: NavigationGrid, p: THREE.Vector3, door: CivicDoor, direction: 1 | -1, indoorGoal: THREE.Vector3): THREE.Vector3[] | null {
    const target = direction > 0
      ? door.threshold.clone().addScaledVector(door.outward, door.approach + OUTSIDE_CLEARANCE + .5)
      : indoorGoal.clone()
    const start = grid.findNearestWalkableCell(p, 2)
    const goal = grid.findNearestWalkableCell(target, 2)
    if (!start || !goal) return null
    const cells: NavigationCell[] | null = start.x === goal.x && start.z === goal.z ? [goal] : grid.findPathCells(start, goal)
    if (!cells) return null
    const points = cells.map(cell => grid.cellToWorld(cell, door.floorY))
    // Leaving ends past the release line; entering ends on the goal's clear cell, so posts are respected inside too.
    if (direction > 0) points.push(target)
    else points.push(grid.cellToWorld(goal, door.floorY))
    return points
  }

  private follow(p: THREE.Vector3): CivicExitResult {
    const waypoints = this.waypoints
    while (this.index < waypoints.length - 1) {
      const w = waypoints[this.index]
      if (Math.hypot(w.x - p.x, w.z - p.z) > WAYPOINT_ARRIVAL) break
      this.index++
    }
    if (p.distanceTo(this.progressAnchor) >= PROGRESS_DISTANCE) {
      this.progressAnchor.copy(p)
      this.stalledFrames = 0
    } else {
      this.stalledFrames++
    }
    this.out.copy(waypoints[this.index])
    return { kind: 'walk', target: this.out }
  }
}
