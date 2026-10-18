import { markObstacleTopologyChanged } from './ObstacleTopology'
/**
 * Terrain.ts
 * Creates a procedural 3D heightmap terrain with undulating hills and valleys.
 * Exports getTerrainHeight(x, z) to calibrate all 3D entity & obstacle positions.
 */
import * as THREE from 'three'
import { createPineVisual } from './EnvironmentVisuals'
import { createMeadow, meadowMaterial } from './Meadow'
import { DAMAGEABLE_OBSTACLE_HP, DamageableObstacle } from './DamageableObstacle'
import type { CharacterFaction } from './CharacterVisuals'
import { ObstacleCollisionSpatialIndex } from './ObstacleCollisionSpatialIndex'
import {
  getRiverCrossingMeshTerrainHeight,
  getRiverCrossingTerrainHeight,
} from './RiverCrossingBattlefield'

/** Sine amplitudes bound every terrain valley; fortified camp offsets are nonnegative. */
export const TERRAIN_MIN_HEIGHT = -3.7
export const TERRAIN_SIZE = 640
export const PLAYABLE_WORLD_BOUND = 300

// Scene ownership keeps Town limits out of Campaign/Outpost and also covers
// actors created later by missions, equipment changes and mount purchases.
const scenePlayableBounds = new WeakMap<THREE.Scene, number>()
export function setScenePlayableWorldBound(scene: THREE.Scene, bound: number): void {
  scenePlayableBounds.set(scene, bound)
}
export function getScenePlayableWorldBound(scene: THREE.Scene): number {
  return scenePlayableBounds.get(scene) ?? PLAYABLE_WORLD_BOUND
}

/** Hardcoded pine tree positions calibrated with getTerrainHeight. */
export const TERRAIN_TREE_POSITIONS: readonly [number, number][] = [
  [18, -22], [-28, 18], [40, -5], [-12, 35], [25, 15],
]

export const FORTIFIED_CAMP_HILL = {
  centerAbsZ: 144,
  radiusX: 22,
  radiusZ: 18,
  flatTopRatio: 0.35,
  height: 3.5,
} as const

/**
 * Smooth raised center shared by the Roman/Viking campaign camp locations.
 * This is part of the battlefield terrain itself, so movement and visuals use
 * the same getTerrainHeight() result without a separate collision platform.
 */
export function getFortifiedCampHeightOffset(
  x: number,
  z: number,
  faction: CharacterFaction,
): number {
  const centerZ = faction === 'roman'
    ? -FORTIFIED_CAMP_HILL.centerAbsZ
    : FORTIFIED_CAMP_HILL.centerAbsZ
  const normalizedX = x / FORTIFIED_CAMP_HILL.radiusX
  const normalizedZ = (z - centerZ) / FORTIFIED_CAMP_HILL.radiusZ
  const radius = Math.hypot(normalizedX, normalizedZ)

  if (radius >= 1) return 0
  if (radius <= FORTIFIED_CAMP_HILL.flatTopRatio) return FORTIFIED_CAMP_HILL.height

  const t = (radius - FORTIFIED_CAMP_HILL.flatTopRatio)
    / (1 - FORTIFIED_CAMP_HILL.flatTopRatio)
  const smooth = t * t * (3 - 2 * t)
  return FORTIFIED_CAMP_HILL.height * (1 - smooth)
}

/** Keeps actors on the rendered terrain while leaving a 20m safety margin at each edge. */
export function clampToPlayableWorld(position: THREE.Vector3, bound = PLAYABLE_WORLD_BOUND): void {
  position.x = THREE.MathUtils.clamp(position.x, -bound, bound)
  position.z = THREE.MathUtils.clamp(position.z, -bound, bound)
}

let activeFortifiedCampFaction: CharacterFaction | null = null
let activeRiverCrossing = false
const sceneRiverCrossing = new WeakMap<object, boolean>()

export function setRiverCrossingTerrainActive(active: boolean): void {
  activeRiverCrossing = Boolean(active)
}

export function isRiverCrossingTerrainActive(): boolean {
  return activeRiverCrossing
}

export function setSceneRiverCrossing(scene: object, active: boolean): void {
  const enabled = Boolean(active)
  sceneRiverCrossing.set(scene, enabled)
  activeRiverCrossing = enabled
}

export function isSceneRiverCrossing(scene: object): boolean {
  return sceneRiverCrossing.get(scene) ?? false
}

export function resetTerrainScenePolicy(): void {
  activeFortifiedCampFaction = null
  activeRiverCrossing = false
}

export interface TerrainOptions {
  fortifiedCampFaction?: CharacterFaction | null
  riverCrossing?: boolean
  treeClearances?: readonly THREE.Box3[]
}

/**
 * Pure procedural terrain height before any River Crossing override.
 */
export function getBaseProceduralTerrainHeight(
  x: number,
  z: number,
  fortifiedCampFaction: CharacterFaction | null = activeFortifiedCampFaction,
): number {
  const h1 = Math.sin(x * 0.04) * Math.cos(z * 0.04) * 2.5
  const h2 = Math.sin(x * 0.09 + 1.2) * Math.cos(z * 0.08 + 0.5) * 1.2
  const campOffset = fortifiedCampFaction
    ? getFortifiedCampHeightOffset(x, z, fortifiedCampFaction)
    : 0
  return h1 + h2 + campOffset
}

/**
 * Calculates terrain Y height at any (x, z) world coordinate using smooth sine/cosine wave superposition.
 */
export function getTerrainHeight(x: number, z: number): number {
  const baseHeight = getBaseProceduralTerrainHeight(x, z, activeFortifiedCampFaction)
  if (activeRiverCrossing) {
    return getRiverCrossingTerrainHeight(x, z, baseHeight)
  }
  return baseHeight
}

/**
 * A straight, constant-width ramp that ends in a flat landing. Height depends on
 * the position along the ramp axis, so the same X/Z can coexist with the ground
 * below without changing getTerrainHeight().
 */
export interface WalkRampSurface {
  /** Centre of the low end. */
  startX: number
  startZ: number
  /** Unit horizontal direction from the low end toward the high end. */
  dirX: number
  dirZ: number
  halfWidth: number
  /** Sloped run length, followed by `landing` metres of flat surface at topY. */
  length: number
  landing: number
  startY: number
  topY: number
  mounted?: boolean
}

/** Highest foot lift for stepping onto a ramp; swept falling contacts are handled separately. */
export const WALK_SURFACE_STEP_UP = 0.75

/** Height of the ramp surface at (x, z), or null when the point is off the ramp. */
export function getWalkRampHeight(surface: WalkRampSurface, x: number, z: number): number | null {
  const dx = x - surface.startX
  const dz = z - surface.startZ
  const along = dx * surface.dirX + dz * surface.dirZ
  if (along < 0 || along > surface.length + surface.landing) return null
  if (Math.abs(dx * -surface.dirZ + dz * surface.dirX) > surface.halfWidth) return null
  if (along >= surface.length) return surface.topY
  return surface.startY + (surface.topY - surface.startY) * (along / surface.length)
}

/** Owner-maintained live envelope containing every grouped physical part. */
export interface ObstacleCollisionGroup {
  readonly bounds: THREE.Box3
}

export interface ObstacleData {
  /** Continuous body/nav collision volume. */
  box: THREE.Box3
  /** Moving obstacles bypass the static grid without rebuilding it. */
  dynamic?: boolean
  /** Optional dynamic owner envelope, updated with part bounds before queries. */
  collisionGroup?: ObstacleCollisionGroup
  /** Optional ground footprint for overhead arches/lintels. Body/projectile collision still uses box. */
  navigationBox?: THREE.Box3
  isBarricade: boolean
  damageable?: DamageableObstacle
  /**
   * Optional projectile-specific solid volumes.
   * Used by see-through palisades so actors cannot squeeze through stake gaps,
   * while arrows/javelins can physically pass between the visible timbers.
   */
  projectileBoxes?: readonly THREE.Box3[]
  /** Rigid world-to-local transform when projectileBoxes describe rotated timber. */
  projectileWorldToLocal?: THREE.Matrix4
  /**
   * Opt-in live world AABB containing all projectile geometry, including any
   * rotation and scale. Owners without this guarantee retain the exact fallback.
   */
  projectileBounds?: THREE.Box3
  /**
   * Walkable ramp carried by this obstacle. Callers that opt in through
   * ObstacleCollisionOptions.walkSurfaces stand on it; every other caller
   * keeps treating `box` as a solid volume.
   */
  walkSurface?: WalkRampSurface
  /** Overhead structure: ground navigation grids must not treat its footprint as blocked. */
  navigationPassable?: boolean
  /** Navigation/AI blocker whose volume does not physically push actors out (e.g. open water hazard). */
  physicalPassable?: boolean
  /** Arrows and javelins fly through (e.g. raised planking that must not block ground archers). */
  projectilePassable?: boolean
}

const obstacleCollisionIndexes = new WeakMap<
  ObstacleData[],
  ObstacleCollisionSpatialIndex
>()

/** Ephemeral shared broad-phase buffer; consume immediately without retaining it. */
export function getLocalCollisionObstacles(
  obstacles: ObstacleData[],
  x: number,
  z: number,
  radius: number,
): readonly ObstacleData[] {
  let index = obstacleCollisionIndexes.get(obstacles)
  if (!index) {
    index = new ObstacleCollisionSpatialIndex()
    obstacleCollisionIndexes.set(obstacles, index)
  }
  index.sync(obstacles)
  return index.queryNear(x, z, radius)
}

/** Swept X/Z bounds, without radius inflation on the perpendicular axis. */
function getSweptCollisionObstacles(obstacles: ObstacleData[], minX: number, minZ: number, maxX: number, maxZ: number): readonly ObstacleData[] {
  let index = obstacleCollisionIndexes.get(obstacles)
  if (!index) {
    index = new ObstacleCollisionSpatialIndex()
    obstacleCollisionIndexes.set(obstacles, index)
  }
  index.sync(obstacles)
  return index.queryBounds(minX, minZ, maxX, maxZ)
}

export interface TerrainResult {
  terrainMesh: THREE.Mesh
  obstacles: ObstacleData[]
  obstacleMeshes: THREE.Object3D[]
  damageableObstacles: DamageableObstacle[]
}

export function removeObstacleData(obstacles: ObstacleData[], obstacle: ObstacleData): boolean {
  const index = obstacles.indexOf(obstacle)
  if (index < 0) return false
  obstacles.splice(index, 1)
  markObstacleTopologyChanged(obstacles)
  return true
}

export interface ObstacleCollisionResult {
  velocityY: number
  onGround: boolean
}

export interface ObstacleCollisionOptions {
  /** Stand on obstacle.walkSurface ramps instead of colliding with their box. */
  walkSurfaces?: boolean
  /** Mounts only use surfaces explicitly admitting their body size. */
  mountedSurfaces?: boolean
}

export interface EntityCollisionBody {
  mountedSurfaces?: boolean
  position: THREE.Vector3
  radius: number
  height: number
  bottomOffset: number
  anchored?: boolean
  walkSurfaces?: boolean
}

export type ObstacleDetourSide = -1 | 1

export interface ObstacleDetourPlan {
  obstacle: ObstacleData
  waypoint: THREE.Vector3
  side: ObstacleDetourSide
}

const OBSTACLE_DETOUR_MARGIN = 0.35
const SEGMENT_EPSILON = 1e-6

function verticallyOverlapsObstacle(
  positionY: number,
  height: number,
  bottomOffset: number,
  box: THREE.Box3,
): boolean {
  const bottomY = positionY - bottomOffset
  const topY = bottomY + height
  return bottomY < box.max.y - 0.001 && topY > box.min.y + 0.001
}

function segmentEntryFractionExpandedBox(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  box: THREE.Box3,
  padding: number,
): number | null {
  const minX = box.min.x - padding
  const maxX = box.max.x + padding
  const minZ = box.min.z - padding
  const maxZ = box.max.z + padding
  const dx = endX - startX
  const dz = endZ - startZ

  let tMin = 0
  let tMax = 1

  if (Math.abs(dx) < SEGMENT_EPSILON) {
    if (startX < minX || startX > maxX) return null
  } else {
    let tx1 = (minX - startX) / dx
    let tx2 = (maxX - startX) / dx
    if (tx1 > tx2) [tx1, tx2] = [tx2, tx1]
    tMin = Math.max(tMin, tx1)
    tMax = Math.min(tMax, tx2)
    if (tMin > tMax) return null
  }

  if (Math.abs(dz) < SEGMENT_EPSILON) {
    if (startZ < minZ || startZ > maxZ) return null
  } else {
    let tz1 = (minZ - startZ) / dz
    let tz2 = (maxZ - startZ) / dz
    if (tz1 > tz2) [tz1, tz2] = [tz2, tz1]
    tMin = Math.max(tMin, tz1)
    tMax = Math.min(tMax, tz2)
    if (tMin > tMax) return null
  }

  return tMax >= 0 && tMin <= 1 ? Math.max(0, tMin) : null
}


function segmentEntryFractionBox3D(
  start: THREE.Vector3,
  end: THREE.Vector3,
  box: THREE.Box3,
): number | null {
  let tMin = 0
  let tMax = 1

  // Scalar slab test: no per-box callback, tuple or temporary vector allocation.
  for (let axis = 0; axis < 3; axis++) {
    const startValue = start.getComponent(axis), delta = end.getComponent(axis) - startValue
    const minValue = box.min.getComponent(axis), maxValue = box.max.getComponent(axis)
    if (Math.abs(delta) < SEGMENT_EPSILON) {
      if (startValue < minValue || startValue > maxValue) return null
      continue
    }
    let t1 = (minValue - startValue) / delta, t2 = (maxValue - startValue) / delta
    if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap }
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return null
  }

  return tMax >= 0 && tMin <= 1 ? Math.max(0, tMin) : null
}

export function obstacleContainsProjectilePoint(
  obstacle: ObstacleData,
  point: THREE.Vector3,
): boolean {
  const boxes = obstacle.projectileBoxes
  if (!boxes || boxes.length === 0) return obstacle.box.containsPoint(point)
  const localPoint = obstacle.projectileWorldToLocal
    ? projectileLocalStart.copy(point).applyMatrix4(obstacle.projectileWorldToLocal)
    : point
  for (const box of boxes) {
    if (box.containsPoint(localPoint)) return true
  }
  return false
}

const projectileLocalStart = new THREE.Vector3()
const projectileLocalEnd = new THREE.Vector3()

/** Earliest solid contact on a segment, shared by live projectiles and shooting LOS. */
export function projectileObstacleEntryFraction(
  obstacle: ObstacleData,
  start: THREE.Vector3,
  end: THREE.Vector3,
): number | null {
  if (obstacle.projectilePassable) return null
  const boxes = obstacle.projectileBoxes
  if (!boxes?.length) return segmentEntryFractionBox3D(start, end, obstacle.box)
  if (obstacle.projectileWorldToLocal) {
    start = projectileLocalStart.copy(start).applyMatrix4(obstacle.projectileWorldToLocal)
    end = projectileLocalEnd.copy(end).applyMatrix4(obstacle.projectileWorldToLocal)
  }
  let closest = Infinity
  for (const box of boxes) {
    const entry = segmentEntryFractionBox3D(start, end, box)
    if (entry !== null) closest = Math.min(closest, entry)
  }
  return Number.isFinite(closest) ? closest : null
}

function segmentEnvelopeIntersectsBox(
  start: THREE.Vector3,
  end: THREE.Vector3,
  box: THREE.Box3,
): boolean {
  // Inclusive with a world-space broad-phase margin for forward/inverse
  // transform rounding. The unchanged local exact trace owns contact precision.
  return Math.max(start.x, end.x) >= box.min.x - SEGMENT_EPSILON && Math.min(start.x, end.x) <= box.max.x + SEGMENT_EPSILON
    && Math.max(start.y, end.y) >= box.min.y - SEGMENT_EPSILON && Math.min(start.y, end.y) <= box.max.y + SEGMENT_EPSILON
    && Math.max(start.z, end.z) >= box.min.z - SEGMENT_EPSILON && Math.min(start.z, end.z) <= box.max.z + SEGMENT_EPSILON
}

export interface ProjectileObstacleContact {
  fraction: number
  point: THREE.Vector3
}

/**
 * Finds the first physical projectile blocker along a 3D segment.
 *
 * Navigation continues to use the continuous obstacle box; projectile LOS uses
 * projectileBoxes when present so a palisade's visible gaps are real firing gaps.
 */
export function findBlockingProjectileObstacleAlongPath(
  start: THREE.Vector3,
  end: THREE.Vector3,
  obstacles: readonly ObstacleData[],
  contact?: ProjectileObstacleContact,
): ObstacleData | null {
  let closest: ObstacleData | null = null
  let closestFraction = Infinity

  for (const obstacle of obstacles) {
    if (obstacle.projectilePassable) continue
    // Only an explicit complete-geometry bound can cull transformed parts.
    // Other rotating slabs can protrude beyond their body/navigation envelope,
    // so they retain the original conservative local exact fallback.
    if (obstacle.projectileBounds
      && !segmentEnvelopeIntersectsBox(start, end, obstacle.projectileBounds)) continue
    const coarseEntry = obstacle.projectileWorldToLocal || obstacle.projectileBounds
      ? 0
      : segmentEntryFractionBox3D(start, end, obstacle.box)
    if (coarseEntry === null || coarseEntry >= closestFraction) continue

    const entry = projectileObstacleEntryFraction(obstacle, start, end)
    if (entry !== null && entry < closestFraction) {
      closestFraction = entry
      closest = obstacle
    }
  }

  if (contact) {
    contact.fraction = closestFraction
    // Copy only the final winner. Subsequent narrow-phase tests cannot mutate
    // a building-hit position retained by the caller until damage is applied.
    if (closest) contact.point.copy(start).lerp(end, closestFraction)
  }
  return closest
}

function segmentBlockedByObstacle(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  height: number,
  bottomOffset: number,
  obstacle: ObstacleData,
): boolean {
  if (!verticallyOverlapsObstacle(start.y, height, bottomOffset, obstacle.box)) return false
  return segmentEntryFractionExpandedBox(
    start.x,
    start.z,
    end.x,
    end.z,
    obstacle.box,
    radius,
  ) !== null
}

/**
 * Returns the closest obstacle intersecting the actor's XZ travel corridor.
 * maxDistance lets callers use this as a cheap local look-ahead while keeping
 * full line-of-sight checks available with the default Infinity.
 */
export function findBlockingObstacleAlongPath(
  position: THREE.Vector3,
  target: THREE.Vector3,
  radius: number,
  height: number,
  bottomOffset: number,
  obstacles: ObstacleData[],
  maxDistance: number = Infinity,
): ObstacleData | null {
  const dx = target.x - position.x
  const dz = target.z - position.z
  const distance = Math.hypot(dx, dz)
  if (distance < SEGMENT_EPSILON) return null

  const scale = Number.isFinite(maxDistance) && distance > maxDistance
    ? maxDistance / distance
    : 1
  const endX = position.x + dx * scale
  const endZ = position.z + dz * scale

  let closest: ObstacleData | null = null
  let closestFraction = Infinity

  for (const obstacle of obstacles) {
    if (obstacle.navigationPassable) continue
    if (!verticallyOverlapsObstacle(position.y, height, bottomOffset, obstacle.box)) continue
    const entry = segmentEntryFractionExpandedBox(
      position.x,
      position.z,
      endX,
      endZ,
      obstacle.box,
      radius,
    )
    if (entry !== null && entry < closestFraction) {
      closestFraction = entry
      closest = obstacle
    }
  }

  return closest
}

export function isObstaclePathClear(
  position: THREE.Vector3,
  target: THREE.Vector3,
  radius: number,
  height: number,
  bottomOffset: number,
  obstacles: ObstacleData[],
): boolean {
  return findBlockingObstacleAlongPath(
    position,
    target,
    radius,
    height,
    bottomOffset,
    obstacles,
  ) === null
}

/**
 * Builds one persistent detour waypoint around the nearest blocking obstacle.
 * The waypoint is chosen from inflated box corners. If one corner cannot see
 * the target yet (for example a long wall), the caller can keep the chosen side
 * and request another waypoint after reaching the first corner.
 */
export function findObstacleDetourPlan(
  position: THREE.Vector3,
  target: THREE.Vector3,
  radius: number,
  height: number,
  bottomOffset: number,
  obstacles: ObstacleData[],
  preferredSide?: ObstacleDetourSide,
  maxLookAhead: number = Infinity,
): ObstacleDetourPlan | null {
  const obstacle = findBlockingObstacleAlongPath(
    position,
    target,
    radius,
    height,
    bottomOffset,
    obstacles,
    maxLookAhead,
  )
  if (!obstacle) return null

  const dx = target.x - position.x
  const dz = target.z - position.z
  const length = Math.hypot(dx, dz)
  if (length < SEGMENT_EPSILON) return null
  const dirX = dx / length
  const dirZ = dz / length

  const clearance = radius + OBSTACLE_DETOUR_MARGIN
  const box = obstacle.box
  const corners: readonly [number, number][] = [
    [box.min.x - clearance, box.min.z - clearance],
    [box.min.x - clearance, box.max.z + clearance],
    [box.max.x + clearance, box.min.z - clearance],
    [box.max.x + clearance, box.max.z + clearance],
  ]

  const choose = (sideFilter?: ObstacleDetourSide): ObstacleDetourPlan | null => {
    let best: ObstacleDetourPlan | null = null
    let bestCost = Infinity

    for (const [x, z] of corners) {
      const toWaypointX = x - position.x
      const toWaypointZ = z - position.z
      const cross = dirX * toWaypointZ - dirZ * toWaypointX
      const side: ObstacleDetourSide = cross >= 0 ? 1 : -1
      if (sideFilter !== undefined && side !== sideFilter) continue

      const waypoint = new THREE.Vector3(x, position.y, z)
      if (segmentBlockedByObstacle(position, waypoint, radius, height, bottomOffset, obstacle)) {
        continue
      }

      const firstLeg = Math.hypot(toWaypointX, toWaypointZ)
      const secondLeg = Math.hypot(target.x - x, target.z - z)
      const targetVisible = !segmentBlockedByObstacle(
        waypoint,
        target,
        radius,
        height,
        bottomOffset,
        obstacle,
      )
      const cost = firstLeg + secondLeg + (targetVisible ? 0 : 5)

      if (cost < bestCost) {
        bestCost = cost
        best = { obstacle, waypoint, side }
      }
    }

    return best
  }

  return choose(preferredSide) ?? choose()
}

/** Returns a direction that steers around an obstacle directly ahead. */
export function getObstacleAvoidanceDirection(
  position: THREE.Vector3,
  desiredDirection: THREE.Vector3,
  radius: number,
  height: number,
  bottomOffset: number,
  obstacles: ObstacleData[],
): THREE.Vector3 {
  const desired = desiredDirection.clone()
  desired.y = 0
  if (desired.lengthSq() < 0.0001) return desired
  desired.normalize()

  const bottomY = position.y - bottomOffset
  const topY = bottomY + height
  const lookAhead = radius + 1.25
  const angles = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75]

  const isBlocked = (direction: THREE.Vector3): boolean => {
    const sampleX = position.x + direction.x * lookAhead
    const sampleZ = position.z + direction.z * lookAhead
    for (const obstacle of obstacles) {
      if (obstacle.navigationPassable) continue
      const box = obstacle.box
      if (bottomY >= box.max.y - 0.001 || topY <= box.min.y + 0.001) continue
      if (
        sampleX + radius > box.min.x && sampleX - radius < box.max.x &&
        sampleZ + radius > box.min.z && sampleZ - radius < box.max.z
      ) return true
    }
    return false
  }

  for (const angle of angles) {
    const candidate = desired.clone()
    candidate.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle)
    if (!isBlocked(candidate)) return candidate
  }

  return desired
}

/** Resolves horizontal overlap between two living entities. */
export function resolveEntityCollision(
  first: EntityCollisionBody, 
  second: EntityCollisionBody, 
  obstacles: ObstacleData[]
): void {
  const firstBottom = first.position.y - first.bottomOffset
  const secondBottom = second.position.y - second.bottomOffset
  const firstTop = firstBottom + first.height
  const secondTop = secondBottom + second.height
  if (firstBottom >= secondTop || secondBottom >= firstTop) return

  const dx = first.position.x - second.position.x
  const dz = first.position.z - second.position.z
  const minDistance = first.radius + second.radius
  const distanceSq = dx * dx + dz * dz
  if (distanceSq >= minDistance * minDistance) return

  const distance = Math.sqrt(distanceSq)
  const normalX = distance > 0.0001 ? dx / distance : 1
  const normalZ = distance > 0.0001 ? dz / distance : 0
  const pushDistance = minDistance - distance
  const halfPush = pushDistance * 0.5

  const overlapsObstacle = (pos: THREE.Vector3, offsetX: number, offsetZ: number, radius: number, bottomOffset: number, height: number, walkSurfaces?: boolean, mountedSurfaces?: boolean): boolean => {
    const targetX = pos.x + offsetX
    const targetZ = pos.z + offsetZ
    const b = pos.y - bottomOffset
    const t = b + height
    const minX = Math.min(pos.x, targetX) - radius
    const maxX = Math.max(pos.x, targetX) + radius
    const minZ = Math.min(pos.z, targetZ) - radius
    const maxZ = Math.max(pos.z, targetZ) + radius
    const candidates = getSweptCollisionObstacles(obstacles, minX, minZ, maxX, maxZ)
    for (const obs of candidates) {
      if (maxX <= obs.box.min.x || minX >= obs.box.max.x ||
        maxZ <= obs.box.min.z || minZ >= obs.box.max.z) continue
      if (obs.physicalPassable) continue
      if (obs.walkSurface && (walkSurfaces || mountedSurfaces && obs.walkSurface.mounted)) continue
      if (b >= obs.box.max.y - 0.001 || t <= obs.box.min.y + 0.001) continue
      if (targetX + radius > obs.box.min.x && targetX - radius < obs.box.max.x &&
          targetZ + radius > obs.box.min.z && targetZ - radius < obs.box.max.z) return true
      // A crowd separation can cross a thin wall even when its destination is
      // clear. Preserve strict tangent clearance while checking the whole push.
      if (offsetX === 0 && (pos.x + radius <= obs.box.min.x || pos.x - radius >= obs.box.max.x) ||
        offsetZ === 0 && (pos.z + radius <= obs.box.min.z || pos.z - radius >= obs.box.max.z)) continue
      const tx = offsetX > 0 ? (obs.box.min.x - radius - pos.x) / offsetX :
        offsetX < 0 ? (obs.box.max.x + radius - pos.x) / offsetX : -Infinity
      const tz = offsetZ > 0 ? (obs.box.min.z - radius - pos.z) / offsetZ :
        offsetZ < 0 ? (obs.box.max.z + radius - pos.z) / offsetZ : -Infinity
      if (Math.max(tx, tz) >= 0 &&
        segmentEntryFractionExpandedBox(pos.x, pos.z, targetX, targetZ, obs.box, radius) !== null) return true
    }
    return false
  }

  // Direction B: Predictive Obstacle Check
  // If pushed into a wall, treat the entity as temporarily anchored
  const firstAnchored = first.anchored || overlapsObstacle(first.position, normalX * halfPush, normalZ * halfPush, first.radius, first.bottomOffset, first.height, first.walkSurfaces, first.mountedSurfaces)
  const secondAnchored = second.anchored || overlapsObstacle(second.position, -normalX * halfPush, -normalZ * halfPush, second.radius, second.bottomOffset, second.height, second.walkSurfaces, second.mountedSurfaces)

  if (firstAnchored && secondAnchored) return
  if (firstAnchored) {
    if (!overlapsObstacle(second.position, -normalX * pushDistance, -normalZ * pushDistance, second.radius, second.bottomOffset, second.height, second.walkSurfaces, second.mountedSurfaces)) {
      second.position.x -= normalX * pushDistance
      second.position.z -= normalZ * pushDistance
    }
  } else if (secondAnchored) {
    if (!overlapsObstacle(first.position, normalX * pushDistance, normalZ * pushDistance, first.radius, first.bottomOffset, first.height, first.walkSurfaces, first.mountedSurfaces)) {
      first.position.x += normalX * pushDistance
      first.position.z += normalZ * pushDistance
    }
  } else {
    first.position.x += normalX * halfPush
    first.position.z += normalZ * halfPush
    second.position.x -= normalX * halfPush
    second.position.z -= normalZ * halfPush
  }
}

/**
 * Resolves a moving entity against the world obstacles.
 * `position` is the entity origin; `bottomOffset` is the distance from that
 * origin to its feet (0 for mounts/NPCs, PLAYER_HALF_HEIGHT for the player).
 */
export function resolveObstacleCollision(
  position: THREE.Vector3,
  previousPosition: THREE.Vector3,
  velocityY: number,
  onGround: boolean,
  radius: number,
  height: number,
  bottomOffset: number,
  obstacles: ObstacleData[],
  options: ObstacleCollisionOptions = {},
): ObstacleCollisionResult {
  const epsilon = 0.001
  const initialBottomY = position.y - bottomOffset
  const initialVelocityY = velocityY
  const initialOnGround = onGround
  const previousBottomY = previousPosition.y - bottomOffset
  const travel = Math.hypot(position.x - previousPosition.x, position.z - previousPosition.z)
  const admittedRamp = (obstacle: ObstacleData): WalkRampSurface | undefined =>
    (options.walkSurfaces || options.mountedSurfaces && obstacle.walkSurface?.mounted)
      ? obstacle.walkSurface : undefined

  const overlapsHorizontally = (x: number, z: number, box: THREE.Box3): boolean =>
    x + radius > box.min.x && x - radius < box.max.x &&
    z + radius > box.min.z && z - radius < box.max.z

  const initialX = position.x
  const initialZ = position.z
  // No horizontal sweep needs no tighter envelope; retain the single-query
  // recovery path for stationary bodies (including loaded overlapping actors).
  const stationary = initialX === previousPosition.x && initialZ === previousPosition.z
  let candidates = stationary ? getLocalCollisionObstacles(obstacles, initialX, initialZ, radius) : getSweptCollisionObstacles(obstacles,
    Math.min(position.x, previousPosition.x) - radius, Math.min(position.z, previousPosition.z) - radius,
    Math.max(position.x, previousPosition.x) + radius, Math.max(position.z, previousPosition.z) + radius)

  // Select support from the unmodified frame position. Sequential snaps can
  // otherwise climb several overlapping surfaces beyond the single-step limit.
  let supportY: number | null = null
  let supportRamp: WalkRampSurface | undefined
  if (velocityY <= 0) {
    for (const obstacle of candidates) {
      if (obstacle.physicalPassable) continue
      const ramp = admittedRamp(obstacle)
      if (!ramp) continue
      const surfaceY = getWalkRampHeight(ramp, position.x, position.z)
      if (surfaceY === null) continue
      const slope = (ramp.topY - ramp.startY) / ramp.length
      const canStep = initialBottomY <= surfaceY + travel * Math.abs(slope) + 0.03 &&
        initialBottomY >= surfaceY - WALK_SURFACE_STEP_UP

      // Sweep against the ramp plane and its flat landing separately. Validate
      // the contact footprint, so entering from below/outside cannot land on an
      // overhead deck merely because the previous feet were above its height.
      let crossedTop = false
      for (let section = 0; section < (ramp.landing > 0 ? 2 : 1); section++) {
        const planeHeight = (x: number, z: number): number => section === 1 ? ramp.topY :
          ramp.startY + ((x - ramp.startX) * ramp.dirX + (z - ramp.startZ) * ramp.dirZ) * slope
        const previousGap = previousBottomY - planeHeight(previousPosition.x, previousPosition.z)
        const currentGap = initialBottomY - planeHeight(position.x, position.z)
        if (previousGap < -epsilon || currentGap > epsilon || previousGap <= currentGap) continue
        const t = Math.max(0, Math.min(1, previousGap / (previousGap - currentGap)))
        const contactY = getWalkRampHeight(ramp,
          previousPosition.x + (position.x - previousPosition.x) * t,
          previousPosition.z + (position.z - previousPosition.z) * t)
        if (contactY !== null && Math.abs(contactY - (previousBottomY + (initialBottomY - previousBottomY) * t)) <= epsilon) {
          crossedTop = true
          break
        }
      }
      if ((canStep || crossedTop) && (supportY === null || surfaceY > supportY)) {
        supportY = surfaceY
        supportRamp = ramp
      }
    }
  }
  if (supportY !== null) {
    position.y = supportY + bottomOffset
    velocityY = 0
    onGround = true
  }

  // Sweep before overlap recovery: a thin rail can be crossed completely in
  // one frame, or the nearest exit can already be on its wrong side. Resolve
  // the earliest entering face, then keep tangential travel for wall sliding.
  // Axis-aligned boxes need at most two contacts to constrain both X and Z.
  let sweepX = previousPosition.x
  let sweepZ = previousPosition.z
  let sweepTime = 0
  const endBottomY = position.y - bottomOffset
  for (let contact = 0; contact < 2 && (position.x !== sweepX || position.z !== sweepZ); contact++) {
    const dx = position.x - sweepX
    const dz = position.z - sweepZ
    const minX = Math.min(sweepX, position.x) - radius
    const maxX = Math.max(sweepX, position.x) + radius
    const minZ = Math.min(sweepZ, position.z) - radius
    const maxZ = Math.max(sweepZ, position.z) + radius
    let firstTime = Infinity
    let hitBox: THREE.Box3 | undefined
    let hitX = false
    for (const obstacle of candidates) {
      const box = obstacle.box
      if (maxX <= box.min.x || minX >= box.max.x || maxZ <= box.min.z || minZ >= box.max.z) continue
      if (obstacle.physicalPassable || admittedRamp(obstacle)) continue
      if (Math.min(previousBottomY, endBottomY) >= box.max.y - epsilon ||
        Math.max(previousBottomY, endBottomY) + height <= box.min.y + epsilon) continue
      if (dx === 0 && (sweepX <= box.min.x - radius || sweepX >= box.max.x + radius) ||
        dz === 0 && (sweepZ <= box.min.z - radius || sweepZ >= box.max.z + radius)) continue
      const entry = segmentEntryFractionExpandedBox(sweepX, sweepZ, position.x, position.z, box, radius)
      if (entry === null || entry >= firstTime) continue
      const tx = dx > 0 ? (box.min.x - radius - sweepX) / dx :
        dx < 0 ? (box.max.x + radius - sweepX) / dx : -Infinity
      const tz = dz > 0 ? (box.min.z - radius - sweepZ) / dz :
        dz < 0 ? (box.max.z + radius - sweepZ) / dz : -Infinity
      // Already penetrating, or departing/tangent to a face: leave recovery to
      // the existing overlap path rather than trapping a body against the wall.
      if (Math.max(tx, tz) < 0) continue
      const time = sweepTime + (1 - sweepTime) * entry
      const feetY = previousBottomY + (endBottomY - previousBottomY) * time
      if (feetY >= box.max.y - epsilon || feetY + height <= box.min.y + epsilon) continue
      firstTime = entry
      hitBox = box
      hitX = tx >= tz
    }
    if (!hitBox) break
    sweepX += dx * firstTime
    sweepZ += dz * firstTime
    sweepTime += (1 - sweepTime) * firstTime
    if (hitX) position.x = sweepX = dx > 0 ? hitBox.min.x - radius : hitBox.max.x + radius
    else position.z = sweepZ = dz > 0 ? hitBox.min.z - radius : hitBox.max.z + radius
  }
  // Sliding on a slope changes the final support height. Keep the same admitted
  // surface instead of promoting the actor onto a different overlapping level.
  if (supportRamp) {
    const y = getWalkRampHeight(supportRamp, position.x, position.z)
    if (y !== null) position.y = (supportY = y) + bottomOffset
  }

  // Try the exact candidates first. Save scalar state so an escaping push can
  // replay the original coarse recovery in source order, including earlier
  // vertical/ramp effects and repeated obstacle records, without allocations.
  const recoveryX = position.x, recoveryY = position.y, recoveryZ = position.z
  const recoveryVelocityY = velocityY, recoveryOnGround = onGround
  let coarseRecovery = stationary
  let escapedRecoveryBounds: boolean
  do {
    escapedRecoveryBounds = false
    for (const obstacle of candidates) {
      if (obstacle.physicalPassable) continue
      const bottomY = position.y - bottomOffset
      const topY = bottomY + height
      const ramp = admittedRamp(obstacle)
      if (ramp) {
        const surfaceY = getWalkRampHeight(ramp, position.x, position.z)
        if (surfaceY !== null) {
          const feetY = bottomY
          if (feetY >= surfaceY - epsilon) continue

          const RAMP_THICKNESS = 0.35
          const undersideY = surfaceY - RAMP_THICKNESS

          // 2. Rising/jumping into the underside of the ramp from beneath:
          // Actor hits their head on the underside and cannot pass upward through the stairs.
          if (topY > undersideY && previousPosition.y - bottomOffset + height <= undersideY + epsilon) {
            position.y = undersideY - height + bottomOffset
            if (velocityY > 0) velocityY = 0
            continue
          }

          // 3. Body horizontal penetration into the descending solid wedge from underneath:
          if (feetY < undersideY && topY > undersideY) {
            position.x = previousPosition.x
            position.z = previousPosition.z
            continue
          }
        }
        continue
      }

      const box = obstacle.box

      // A descending entity lands on the obstacle's top surface.
      if (
        velocityY <= 0 &&
        previousPosition.y - bottomOffset >= box.max.y - epsilon &&
        bottomY <= box.max.y + epsilon &&
        overlapsHorizontally(position.x, position.z, box)
      ) {
        position.y = box.max.y + bottomOffset
        velocityY = 0
        onGround = true
        continue
      }

      // An ascending entity bonks into the obstacle's underside ceiling.
      if (
        previousPosition.y - bottomOffset + height <= box.min.y + epsilon &&
        topY > box.min.y &&
        overlapsHorizontally(position.x, position.z, box)
      ) {
        position.y = box.min.y - height + bottomOffset
        if (velocityY > 0) velocityY = 0
        continue
      }

      // Above the obstacle: it is a walkable platform, not a wall.
      if (bottomY >= box.max.y - epsilon || topY <= box.min.y + epsilon) continue

      // Reactive Push-Out (Direction A)
      // Instantly teleport the entity to the closest valid outer edge if inside
      if (overlapsHorizontally(position.x, position.z, box)) {
        const dxMax = (box.max.x + radius) - position.x
        const dxMin = position.x - (box.min.x - radius)
        const dzMax = (box.max.z + radius) - position.z
        const dzMin = position.z - (box.min.z - radius)

        const minDist = Math.min(dxMax, dxMin, dzMax, dzMin)

        if (minDist === dxMax) position.x = box.max.x + radius
        else if (minDist === dxMin) position.x = box.min.x - radius
        else if (minDist === dzMax) position.z = box.max.z + radius
        else if (minDist === dzMin) position.z = box.min.z - radius

        // Later corrections may escape even when every earlier push stayed in
        // bounds. Only then can an exact-query omission become relevant.
        if (!coarseRecovery && (
          position.x < Math.min(initialX, previousPosition.x) || position.x > Math.max(initialX, previousPosition.x) ||
          position.z < Math.min(initialZ, previousPosition.z) || position.z > Math.max(initialZ, previousPosition.z)
        )) {
          escapedRecoveryBounds = true
          break
        }
      }
    }
    if (escapedRecoveryBounds) {
      // The query replaces the shared ephemeral buffer, after its loop exits.
      candidates = getLocalCollisionObstacles(obstacles,
        (initialX + previousPosition.x) * .5, (initialZ + previousPosition.z) * .5,
        radius + Math.max(Math.abs(initialX - previousPosition.x), Math.abs(initialZ - previousPosition.z)) * .5)
      position.set(recoveryX, recoveryY, recoveryZ)
      velocityY = recoveryVelocityY
      onGround = recoveryOnGround
      coarseRecovery = true
    }
  } while (escapedRecoveryBounds)

  // A later wall push may move the body off the support selected above.
  // Do not retain that ramp's height/ground flag at an unsupported final X/Z.
  if (supportY !== null && Math.abs(position.y - bottomOffset - supportY) <= epsilon) {
    const supported = candidates.some(obstacle => {
      if (obstacle.physicalPassable) return false
      const ramp = admittedRamp(obstacle)
      if (ramp) {
        const y = getWalkRampHeight(ramp, position.x, position.z)
        return y !== null && Math.abs(y - supportY) <= epsilon
      }
      return Math.abs(obstacle.box.max.y - supportY) <= epsilon &&
        overlapsHorizontally(position.x, position.z, obstacle.box)
    })
    if (!supported) {
      position.y = initialBottomY + bottomOffset
      velocityY = initialVelocityY
      onGround = initialOnGround
    }
  }

  return { velocityY, onGround }
}

export function createTerrain(
  scene: THREE.Scene,
  options: TerrainOptions = {},
): TerrainResult {
  activeFortifiedCampFaction = options.fortifiedCampFaction ?? null
  setSceneRiverCrossing(scene, Boolean(options.riverCrossing))
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 256, 256)
  geometry.rotateX(-Math.PI / 2)

  // Apply procedural height function to PlaneGeometry vertices.
  // In River Crossing mode, the rendered terrain mesh carves the recessed riverbed
  // all the way underneath the bridge arches rather than rising to the bridge deck.
  const posAttr = geometry.attributes.position
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i)
    const vz = posAttr.getZ(i)
    const baseHeight = getBaseProceduralTerrainHeight(vx, vz, activeFortifiedCampFaction)
    const vy = activeRiverCrossing
      ? getRiverCrossingMeshTerrainHeight(vx, vz, baseHeight)
      : baseHeight
    posAttr.setY(i, vy)
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()

  const material = meadowMaterial(geometry, options.fortifiedCampFaction)

  const terrainMesh = new THREE.Mesh(geometry, material)
  terrainMesh.name = 'terrain'
  terrainMesh.receiveShadow = true
  scene.add(terrainMesh)
  createMeadow(scene, getTerrainHeight, options.fortifiedCampFaction)

  const obstacles: ObstacleData[] = []
  const obstacleMeshes: THREE.Object3D[] = []
  const damageableObstacles: DamageableObstacle[] = []

  // ── Pine trees (damageable, but AI destruction policy is implemented separately) ──
  TERRAIN_TREE_POSITIONS.forEach(([tx, tz], index) => {
    if (options.treeClearances?.some(zone => tx + .4 >= zone.min.x && tx - .4 <= zone.max.x
      && tz + .4 >= zone.min.z && tz - .4 <= zone.max.z)) return
    const terrainY = getTerrainHeight(tx, tz)
    const root = createPineVisual(index + 42, options.fortifiedCampFaction === 'viking')
    root.name = `damageable-tree-${index + 1}`
    root.position.set(tx, terrainY, tz)
    const hitMeshes = root.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
    scene.add(root)
    obstacleMeshes.push(...hitMeshes)

    const box = new THREE.Box3(
      new THREE.Vector3(tx - 0.4, terrainY, tz - 0.4),
      new THREE.Vector3(tx + 0.4, terrainY + 6, tz + 0.4),
    )
    const damageable = new DamageableObstacle({
      kind: 'tree',
      maxHp: DAMAGEABLE_OBSTACLE_HP.tree,
      root,
      hitMeshes,
      ownerFaction: null,
    })
    const obstacle: ObstacleData = {
      box,
      isBarricade: false,
      damageable,
    }

    damageable.onDestroyed(() => {
      removeObstacleData(obstacles, obstacle)
      for (const mesh of damageable.hitMeshes) {
        const meshIndex = obstacleMeshes.indexOf(mesh)
        if (meshIndex >= 0) obstacleMeshes.splice(meshIndex, 1)
      }
    })

    obstacles.push(obstacle)
    damageableObstacles.push(damageable)
  })

  return { terrainMesh, obstacles, obstacleMeshes, damageableObstacles }
}
