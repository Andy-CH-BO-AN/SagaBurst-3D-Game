import * as THREE from 'three'
import { architectureLocalToWorld, type BuildingSpec } from '../town/architecture/ArchitectureSpecs'
import type { ObstacleData } from '../world/Terrain'
import { NavigationGrid, type NavigationCell } from './NavigationGrid'

/** Clearance grid for one civic hall. Local to the hall; the global A* grid is untouched. */
export const CIVIC_EXIT_CELL_SIZE = 0.5
/** Frames without progress before a mounted exit is abandoned to ordinary target fallback. */
export const CIVIC_EXIT_STALL_FRAMES = 180
const PROGRESS_DISTANCE = 0.5
const WAYPOINT_ARRIVAL = 0.35
const REPLAN_DISTANCE_SQ = 4
const OUTSIDE_CLEARANCE = 1
const INSIDE_ALIGNMENT = 2.5
const GRID_MARGIN = 3

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
}

function insideHall(hall: CivicHall, p: { x: number; z: number }, margin = 0): boolean {
  return hall.rects.some(r => p.x > r.minX - margin && p.x < r.maxX + margin && p.z > r.minZ - margin && p.z < r.maxZ + margin)
}

/** Per-actor owner of a mounted rider's walk out of a civic hall through its real door.
 * It only supplies the next local waypoint; the actor's attack/charge intent is untouched.
 */
export class CivicExitRoute {
  private door: CivicDoor | null = null
  private waypoints: THREE.Vector3[] = []
  private index = 0
  private revision = -1
  private stalledFrames = 0
  private progressAnchor = new THREE.Vector3()
  private failedRevision = -1
  private readonly failedAt = new THREE.Vector3()
  private readonly out = new THREE.Vector3()

  clear(): void {
    this.door = null
    this.waypoints.length = 0
    this.index = 0
    this.stalledFrames = 0
  }

  /** null means the actor is not leaving a civic hall; ordinary routing owns the move. */
  resolve(request: CivicExitRequest, obstacles: readonly ObstacleData[]): CivicExitResult {
    const { position: p, goal: g, halls, revision } = request
    if (this.door) {
      if (this.passedDoor(p)) { this.clear(); return null }
      // Topology changes (e.g. a wall breach) invalidate the cached route; replan from here.
      if (revision !== this.revision) this.clear()
    }
    if (!this.door) {
      const hall = halls.find(h => insideHall(h, p))
      if (!hall || insideHall(hall, g, .5)) return null
      if (this.failedRevision === revision && p.distanceToSquared(this.failedAt) < REPLAN_DISTANCE_SQ) return { kind: 'blocked' }
      if (!this.plan(hall, p, g, obstacles, revision, request.radius, request.height)) {
        this.failedRevision = revision
        this.failedAt.copy(p)
        return { kind: 'blocked' }
      }
    }
    return this.follow(p)
  }

  private passedDoor(p: THREE.Vector3): boolean {
    const door = this.door!
    const along = (p.x - door.threshold.x) * door.outward.x + (p.z - door.threshold.z) * door.outward.z
    return along >= door.approach + OUTSIDE_CLEARANCE
  }

  private plan(hall: CivicHall, p: THREE.Vector3, g: THREE.Vector3, obstacles: readonly ObstacleData[], revision: number, radius: number, height: number): boolean {
    const grid = clearanceGrid(hall, obstacles, revision, radius, height)
    const doors = [...hall.doors].sort((a, b) => (p.distanceTo(a.inside) + a.inside.distanceTo(g)) - (p.distanceTo(b.inside) + b.inside.distanceTo(g)))
    for (const door of doors) {
      const route = this.route(grid, p, door)
      if (!route) continue
      this.door = door
      this.waypoints = route
      this.index = 0
      this.revision = revision
      this.stalledFrames = 0
      this.progressAnchor.copy(p)
      return true
    }
    return false
  }

  private route(grid: NavigationGrid, p: THREE.Vector3, door: CivicDoor): THREE.Vector3[] | null {
    const start = grid.findNearestWalkableCell(p, 2)
    const inside = grid.findNearestWalkableCell(door.inside, 2)
    if (!start || !inside) return null
    const cells: NavigationCell[] | null = start.x === inside.x && start.z === inside.z ? [inside] : grid.findPathCells(start, inside)
    if (!cells) return null
    const points = cells.map(cell => grid.cellToWorld(cell, door.floorY))
    points.push(door.threshold.clone())
    // Aim past the release line so the body crosses it before the final waypoint is reached.
    points.push(door.threshold.clone().addScaledVector(door.outward, door.approach + OUTSIDE_CLEARANCE + .5))
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
    } else if (++this.stalledFrames > CIVIC_EXIT_STALL_FRAMES) {
      this.failedRevision = this.revision
      this.failedAt.copy(p)
      this.clear()
      return { kind: 'blocked' }
    }
    this.out.copy(waypoints[this.index])
    return { kind: 'walk', target: this.out }
  }
}
