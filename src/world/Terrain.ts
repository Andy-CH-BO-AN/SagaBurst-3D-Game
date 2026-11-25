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
import { OBSTACLE_COLLISION_GRID_CELL_SIZE, ObstacleCollisionSpatialIndex } from './ObstacleCollisionSpatialIndex'
import { OBSTACLE_RECOVERY_REACH, recoverHorizontalPosition } from './ObstaclePenetrationRecovery'
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
/** Enclosed arenas own a level ground plane; null keeps the procedural battlefield. */
let activeFlatTerrainY: number | null = null
/** Only one scene owns the flat ground at a time; the latest claim replaces an older one. */
let flatTerrainOwner: object | null = null

/** Installs a flat ground plane owned by `owner` until that same owner releases it. */
export function claimFlatTerrainOverride(owner: object, y: number): void {
  if (!Number.isFinite(y)) throw new Error(`Flat terrain height must be finite: ${y}`)
  flatTerrainOwner = owner
  activeFlatTerrainY = y
}

/** A late dispose of a replaced owner leaves the newer owner's ground untouched. */
export function releaseFlatTerrainOverride(owner: object): void {
  if (flatTerrainOwner !== owner) return
  flatTerrainOwner = null
  activeFlatTerrainY = null
}

export function getFlatTerrainOverride(): number | null {
  return activeFlatTerrainY
}
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
  activeFlatTerrainY = null
  flatTerrainOwner = null
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
  if (activeFlatTerrainY !== null) return activeFlatTerrainY
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
   * ObstacleCollisionOptions.walkSurfaces stand on it. Solid foundations use
   * their exact top/base planes for every caller; other surfaces retain box collision.
   */
  walkSurface?: WalkRampSurface
  /** Continuous solid foundation under the walk plane. Sloped bases preserve lower floors. */
  solidBelow?: number | { startY: number; topY: number }
  /** Connected foundation footprint used only to recover already embedded bodies. */
  solidRecoveryBounds?: THREE.Box3
  /** Overhead structure: ground navigation grids must not treat its footprint as blocked. */
  navigationPassable?: boolean
  /** Navigation/AI blocker whose volume does not physically push actors out (e.g. open water hazard). */
  physicalPassable?: boolean
  /** Arrows and javelins fly through (e.g. raised planking that must not block ground archers). */
  projectilePassable?: boolean
}

/** Height-clamped planes also cover a body's radius just outside the walk lane. */
function rampPlaneHeight(surface: WalkRampSurface, x: number, z: number, heights: Pick<WalkRampSurface, 'startY' | 'topY'> = surface): number {
  const along = (x - surface.startX) * surface.dirX + (z - surface.startZ) * surface.dirZ
  return heights.startY + (heights.topY - heights.startY) * Math.max(0, Math.min(1, along / surface.length))
}
function rampBaseHeight(obstacle: ObstacleData, x: number, z: number): number {
  const base = obstacle.solidBelow!
  return typeof base === 'number' ? base : rampPlaneHeight(obstacle.walkSurface!, x, z, base)
}

const obstacleCollisionIndexes = new WeakMap<
  ObstacleData[],
  ObstacleCollisionSpatialIndex
>()

const obstaclePathQuerySources = new WeakSet<ObstacleData[]>()

/**
 * Opt in only a stable, owner-maintained physical source with plain data records
 * (no accessors that issue nested queries). Membership, order and static bounds
 * changes must notify ObstacleTopology; dynamic parts/groups keep live bounds.
 * Fresh/scratch arrays retain the direct finder. Disable when the owner disposes.
 */
export function setObstaclePathQuerySource(obstacles: ObstacleData[], enabled: boolean): void {
  if (enabled) obstaclePathQuerySources.add(obstacles)
  else {
    obstaclePathQuerySources.delete(obstacles)
    obstacleCollisionIndexes.delete(obstacles)
    projectileObstacleIndexes.delete(obstacles)
  }
}

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

const projectileObstacleIndexes = new WeakMap<ObstacleData[], ObstacleCollisionSpatialIndex>()

/**
 * Ballistic broad-phase candidates for an X/Z envelope, or null when the caller
 * must scan every record (unregistered/small sources or very large envelopes).
 * Returns an ephemeral superset in source order; apply the exact test to it.
 */
export function queryProjectilePathObstacles(obstacles: readonly ObstacleData[],
  minX: number, minZ: number, maxX: number, maxZ: number): readonly ObstacleData[] | null {
  const source = obstacles as ObstacleData[]
  if (!obstaclePathQuerySources.has(source) || obstacles.length < 64) return null
  const minCellX = Math.floor(minX / OBSTACLE_COLLISION_GRID_CELL_SIZE), maxCellX = Math.floor(maxX / OBSTACLE_COLLISION_GRID_CELL_SIZE)
  const minCellZ = Math.floor(minZ / OBSTACLE_COLLISION_GRID_CELL_SIZE), maxCellZ = Math.floor(maxZ / OBSTACLE_COLLISION_GRID_CELL_SIZE)
  if (!Number.isSafeInteger(minCellX) || !Number.isSafeInteger(minCellZ) || !Number.isSafeInteger(maxCellX) || !Number.isSafeInteger(maxCellZ)
    || (maxCellX - minCellX + 1) * (maxCellZ - minCellZ + 1) > 256) return null
  let index = projectileObstacleIndexes.get(source)
  if (!index) {
    index = new ObstacleCollisionSpatialIndex('projectile')
    projectileObstacleIndexes.set(source, index)
  }
  index.sync(source)
  return index.queryBounds(minX, minZ, maxX, maxZ)
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
  /** A corrective placement, separate from swept movement. */
  recovered?: true
}

export interface ObstacleCollisionOptions {
  /** Stand on obstacle.walkSurface ramps instead of colliding with their box. */
  walkSurfaces?: boolean
  /** Mounts only use surfaces explicitly admitting their body size. */
  mountedSurfaces?: boolean
  /** Keep both requested motion and recovery inside the caller's playable square. */
  worldBound?: number
  /** Validate an existing pose without stepping, landing or advancing a fall. */
  recoverOnly?: boolean
  /** Match the movement caller's terrain source when it supplies an override. */
  groundHeight?: (x: number, z: number) => number
}

export interface EntityCollisionBody {
  mountedSurfaces?: boolean
  position: THREE.Vector3
  radius: number
  height: number
  bottomOffset: number
  anchored?: boolean
  walkSurfaces?: boolean
  pushWeight?: number
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
  // Segment bounds for an exact early reject: a box-only record that misses them
  // on any axis cannot pass the slab test below. Arc chords miss most candidates.
  const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x)
  const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y)
  const minZ = Math.min(start.z, end.z), maxZ = Math.max(start.z, end.z)

  for (const obstacle of obstacles) {
    if (obstacle.projectilePassable) continue
    // Only an explicit complete-geometry bound can cull transformed parts.
    // Other rotating slabs can protrude beyond their body/navigation envelope,
    // so they retain the original conservative local exact fallback.
    if (obstacle.projectileBounds
      && !segmentEnvelopeIntersectsBox(start, end, obstacle.projectileBounds)) continue
    let coarseEntry: number | null = 0
    if (!obstacle.projectileWorldToLocal && !obstacle.projectileBounds) {
      const box = obstacle.box
      if (maxX < box.min.x || minX > box.max.x || maxY < box.min.y || minY > box.max.y
        || maxZ < box.min.z || minZ > box.max.z) continue
      coarseEntry = segmentEntryFractionBox3D(start, end, box)
    }
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

  let pathObstacles: readonly ObstacleData[] = obstacles
  if (obstaclePathQuerySources.has(obstacles) && obstacles.length >= 64
    && radius >= 0 && Number.isFinite(radius)
    && height >= 0 && Number.isFinite(height)
    && bottomOffset >= 0 && Number.isFinite(bottomOffset) && Number.isFinite(position.y)
    && maxDistance >= 0 && (Number.isFinite(maxDistance) || maxDistance === Infinity)) {
    // Use the original clipped endpoint and start-height narrow phase. The
    // conservative margin also covers rounding at expanded slab boundaries.
    const padding = radius + SEGMENT_EPSILON
    const minX = Math.min(position.x, endX) - padding
    const minZ = Math.min(position.z, endZ) - padding
    const maxX = Math.max(position.x, endX) + padding
    const maxZ = Math.max(position.z, endZ) + padding
    const minCellX = Math.floor(minX / OBSTACLE_COLLISION_GRID_CELL_SIZE)
    const minCellZ = Math.floor(minZ / OBSTACLE_COLLISION_GRID_CELL_SIZE)
    const maxCellX = Math.floor(maxX / OBSTACLE_COLLISION_GRID_CELL_SIZE)
    const maxCellZ = Math.floor(maxZ / OBSTACLE_COLLISION_GRID_CELL_SIZE)
    // Bound cell traversal and source-order sorting for long diagonal corridors;
    // small sources and unsafe/low-selectivity ranges keep the original scan.
    if (Number.isSafeInteger(minCellX) && Number.isSafeInteger(minCellZ)
      && Number.isSafeInteger(maxCellX) && Number.isSafeInteger(maxCellZ)
      && (maxCellX - minCellX + 1) * (maxCellZ - minCellZ + 1) <= 64) {
      pathObstacles = getSweptCollisionObstacles(obstacles, minX, minZ, maxX, maxZ)
    }
  }

  let closest: ObstacleData | null = null
  let closestFraction = Infinity

  for (const obstacle of pathObstacles) {
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

  // Every sample square lies within `reach` of the position (unit directions), so the
  // inclusive X/Z broad phase is a superset of the strict overlaps tested below.
  let candidates: readonly ObstacleData[] = obstacles
  const reach = lookAhead + radius + SEGMENT_EPSILON
  if (obstaclePathQuerySources.has(obstacles) && obstacles.length >= 64 && radius >= 0 && Number.isFinite(radius)
    && Number.isFinite(position.x) && Number.isFinite(position.z)) {
    candidates = getSweptCollisionObstacles(obstacles, position.x - reach, position.z - reach, position.x + reach, position.z + reach)
  }

  const isBlocked = (direction: THREE.Vector3): boolean => {
    const sampleX = position.x + direction.x * lookAhead
    const sampleZ = position.z + direction.z * lookAhead
    for (const obstacle of candidates) {
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
  const firstWeight = Math.max(0.01, first.pushWeight ?? 1)
  const secondWeight = Math.max(0.01, second.pushWeight ?? 1)
  const totalWeight = firstWeight + secondWeight
  const firstPush = pushDistance * (secondWeight / totalWeight)
  const secondPush = pushDistance * (firstWeight / totalWeight)

  // Direction B: Predictive Obstacle Check
  // If pushed into a wall, treat the entity as temporarily anchored
  const firstAnchored = first.anchored || isObstacleBodyPushBlocked(first, normalX * firstPush, normalZ * firstPush, obstacles)
  const secondAnchored = second.anchored || isObstacleBodyPushBlocked(second, -normalX * secondPush, -normalZ * secondPush, obstacles)

  if (firstAnchored && secondAnchored) return
  if (firstAnchored) {
    if (!isObstacleBodyPushBlocked(second, -normalX * pushDistance, -normalZ * pushDistance, obstacles)) {
      second.position.x -= normalX * pushDistance
      second.position.z -= normalZ * pushDistance
    }
  } else if (secondAnchored) {
    if (!isObstacleBodyPushBlocked(first, normalX * pushDistance, normalZ * pushDistance, obstacles)) {
      first.position.x += normalX * pushDistance
      first.position.z += normalZ * pushDistance
    }
  } else {
    first.position.x += normalX * firstPush
    first.position.z += normalZ * firstPush
    second.position.x -= normalX * secondPush
    second.position.z -= normalZ * secondPush
  }
}

const BODY_CONTACT_EPSILON = .001
const WALK_SURFACE_THICKNESS = .35

function overlapsExpandedBox(x: number, z: number, radius: number, box: THREE.Box3): boolean {
  // Use the same expanded faces as sweep and recovery. Reversing the arithmetic
  // (e.g. x + radius > min.x) can put an exact sweep contact back inside.
  return x > box.min.x - radius && x < box.max.x + radius &&
    z > box.min.z - radius && z < box.max.z + radius
}

function admittedObstacleRamp(obstacle: ObstacleData, options: ObstacleCollisionOptions): WalkRampSurface | undefined {
  return options.walkSurfaces || options.mountedSurfaces && obstacle.walkSurface?.mounted
    ? obstacle.walkSurface : undefined
}

function obstacleSupportsFeet(obstacle: ObstacleData, x: number, z: number, feetY: number, radius: number,
  options: ObstacleCollisionOptions): boolean {
  if (obstacle.physicalPassable) return false
  const ramp = admittedObstacleRamp(obstacle, options)
  const y = ramp ? getWalkRampHeight(ramp, x, z) : obstacle.solidBelow === undefined &&
    overlapsExpandedBox(x, z, radius, obstacle.box) ? obstacle.box.max.y : null
  return y !== null && Math.abs(y - feetY) <= BODY_CONTACT_EPSILON
}

/** Radius contact can precede the feet at a low ramp entrance or at an
 * adjacent walk surface. The centre still cannot enter below the walk plane. */
function clearsRampFringe(ramp: WalkRampSurface, x: number, z: number, feetY: number, topY: number,
  hasApproachSupport?: () => boolean): boolean {
  if (feetY < topY - WALK_SURFACE_STEP_UP || getWalkRampHeight(ramp, x, z) !== null) return false
  const dx = x - ramp.startX, dz = z - ramp.startZ
  if (ramp.startY <= ramp.topY && dx * ramp.dirX + dz * ramp.dirZ < 0 &&
    Math.abs(dx * -ramp.dirZ + dz * ramp.dirX) <= ramp.halfWidth) return true
  return hasApproachSupport?.() ?? false
}

function obstacleBodyOverlaps(obstacle: ObstacleData, x: number, z: number, feetY: number, height: number, radius: number,
  options: ObstacleCollisionOptions, hasSupport?: () => boolean): boolean {
  if (obstacle.physicalPassable || !overlapsExpandedBox(x, z, radius, obstacle.box)) return false
  const admittedRamp = admittedObstacleRamp(obstacle, options)
  const solidRamp = obstacle.solidBelow !== undefined ? obstacle.walkSurface : undefined
  const surfaceY = solidRamp ? rampPlaneHeight(solidRamp, x, z)
    : admittedRamp ? getWalkRampHeight(admittedRamp, x, z) : obstacle.box.max.y
  if (surfaceY === null || feetY >= surfaceY - BODY_CONTACT_EPSILON) return false
  const bottomY = solidRamp ? rampBaseHeight(obstacle, x, z)
    : admittedRamp ? surfaceY - WALK_SURFACE_THICKNESS : obstacle.box.min.y
  if (feetY + height <= bottomY + BODY_CONTACT_EPSILON) return false
  return !(solidRamp && admittedRamp && clearsRampFringe(solidRamp, x, z, feetY, surfaceY, hasSupport))
}

function bodyBlockedByObstacles(candidates: readonly ObstacleData[], x: number, z: number, feetY: number,
  height: number, radius: number, options: ObstacleCollisionOptions): boolean {
  let supported: boolean | undefined
  const hasSupport = () => supported ??= candidates.some(obstacle => obstacleSupportsFeet(obstacle, x, z, feetY, radius, options))
  return candidates.some(obstacle => obstacleBodyOverlaps(obstacle, x, z, feetY, height, radius, options, hasSupport))
}

/**
 * Tests an external push without changing the actor's pose or fall state.
 * Endpoints use the physical body volumes. The sweep also keeps a push from
 * crossing a thin wall whose far side would otherwise be clear.
 */
export function isObstacleBodyPushBlocked(body: EntityCollisionBody, offsetX: number, offsetZ: number,
  obstacles: ObstacleData[], targetY = body.position.y): boolean {
  if (obstacles.length === 0) return false
  const { position, radius, height, bottomOffset } = body
  const targetX = position.x + offsetX, targetZ = position.z + offsetZ
  const feetY = position.y - bottomOffset, targetFeetY = targetY - bottomOffset
  const minX = Math.min(position.x, targetX) - radius, maxX = Math.max(position.x, targetX) + radius
  const minZ = Math.min(position.z, targetZ) - radius, maxZ = Math.max(position.z, targetZ) + radius
  const candidates = getSweptCollisionObstacles(obstacles, minX, minZ, maxX, maxZ)
  for (const obstacle of candidates) {
    if (obstacle.physicalPassable ||
      Math.min(feetY, targetFeetY) >= obstacle.box.max.y - BODY_CONTACT_EPSILON ||
      Math.max(feetY, targetFeetY) + height <= obstacle.box.min.y + BODY_CONTACT_EPSILON) continue
    if (obstacleBodyOverlaps(obstacle, targetX, targetZ, targetFeetY, height, radius, body)) return true
    // An admitted thin walk surface occupies only its exact slab, checked at
    // the destination. Its bounding box includes intentionally open space.
    const ramp = obstacle.walkSurface
    const solidRamp = ramp && obstacle.solidBelow !== undefined
    if (!solidRamp && admittedObstacleRamp(obstacle, body)) continue

    const box = obstacle.box
    if (offsetX === 0 && (position.x <= box.min.x - radius || position.x >= box.max.x + radius) ||
      offsetZ === 0 && (position.z <= box.min.z - radius || position.z >= box.max.z + radius)) continue
    const tx = offsetX > 0 ? (box.min.x - radius - position.x) / offsetX :
      offsetX < 0 ? (box.max.x + radius - position.x) / offsetX : -Infinity
    const tz = offsetZ > 0 ? (box.min.z - radius - position.z) / offsetZ :
      offsetZ < 0 ? (box.max.z + radius - position.z) / offsetZ : -Infinity
    if (Math.max(tx, tz) < 0) continue
    const entry = segmentEntryFractionExpandedBox(position.x, position.z, targetX, targetZ, box, radius)
    if (entry === null || entry >= 1) continue
    const contactX = position.x + offsetX * entry, contactZ = position.z + offsetZ * entry
    const contactFeetY = feetY + (targetFeetY - feetY) * entry
    const top = solidRamp ? rampPlaneHeight(ramp, contactX, contactZ) : box.max.y
    const base = solidRamp ? rampBaseHeight(obstacle, contactX, contactZ) : box.min.y
    if (contactFeetY < top - BODY_CONTACT_EPSILON && contactFeetY + height > base + BODY_CONTACT_EPSILON) return true
  }
  return false
}

/** Called only after a narrow-phase overlap has been confirmed. */
function recoverObstaclePenetration(position: THREE.Vector3, previous: THREE.Vector3,
  velocityY: number, onGround: boolean, radius: number, height: number, bottomOffset: number,
  obstacles: ObstacleData[], options: ObstacleCollisionOptions): ObstacleCollisionResult {
  const { x, z } = position
  const feetY = position.y - bottomOffset
  const reach = OBSTACLE_RECOVERY_REACH + radius
  const worldBound = options.worldBound ?? Infinity
  // Re-query once around the complete recovery envelope, after the caller is
  // done with its ephemeral sweep buffer. Every candidate uses this same query.
  const nearby = getSweptCollisionObstacles(obstacles, x - reach, z - reach, x + reach, z + reach)
  const groundHeight = options.groundHeight ?? getTerrainHeight
  const supportedOnObstacle = (px: number, pz: number, py: number) =>
    nearby.some(obstacle => obstacleSupportsFeet(obstacle, px, pz, py, radius, options))
  const canPlace = (px: number, pz: number, py: number, groundY: number) =>
    py >= groundY - BODY_CONTACT_EPSILON && !bodyBlockedByObstacles(nearby, px, pz, py, height, radius, options)
  const finish = (py: number, groundY: number, hitUnderside = false): ObstacleCollisionResult => {
    position.y = py + bottomOffset
    const supported = velocityY <= 0 && (Math.abs(py - groundY) <= BODY_CONTACT_EPSILON ||
      supportedOnObstacle(position.x, position.z, py))
    return { velocityY: supported || hitUnderside && velocityY > 0 ? 0 : velocityY, onGround: supported, recovered: true }
  }
  const originalSupport = nearby.find(obstacle => obstacleSupportsFeet(obstacle, x, z, feetY, radius, options) ||
    Math.abs(previous.y - position.y) <= BODY_CONTACT_EPSILON &&
    obstacleSupportsFeet(obstacle, previous.x, previous.z, feetY, radius, options))
  const originalRamp = originalSupport && admittedObstacleRamp(originalSupport, options)
  const retainedSupportY = (px: number, pz: number, groundY: number): number | null => {
    const rampY = originalRamp ? getWalkRampHeight(originalRamp, px, pz) : null
    if (rampY !== null && Math.abs(rampY - feetY) <= WALK_SURFACE_STEP_UP && canPlace(px, pz, rampY, groundY)) return rampY
    return supportedOnObstacle(px, pz, feetY) && canPlace(px, pz, feetY, groundY) ? feetY : null
  }
  // Grounded bodies may step onto adjoining terrain. A legal air pose keeps
  // its current height and velocity, including a fall in progress.
  const recoveryFeetY = (groundY: number) => onGround && groundY - feetY <= WALK_SURFACE_STEP_UP
    ? Math.max(feetY, groundY) : feetY
  if (recoverHorizontalPosition(position, radius, feetY, feetY + height, nearby, worldBound, !!originalSupport, (px, pz) => {
    const groundY = groundHeight(px, pz)
    if (originalSupport && retainedSupportY(px, pz, groundY) !== null) return 'supported'
    return canPlace(px, pz, recoveryFeetY(groundY), groundY) ? 'clear' : 'blocked'
  })) {
    const groundY = groundHeight(position.x, position.z)
    const surfaceY = originalSupport ? retainedSupportY(position.x, position.z, groundY) : null
    return finish(surfaceY ?? recoveryFeetY(groundY), groundY)
  }

  const previousFeetY = previous.y - bottomOffset
  // Check the original pose against the same terrain and obstacle rules as every exit.
  if (Math.hypot(previous.x - x, previous.y - position.y, previous.z - z) <= OBSTACLE_RECOVERY_REACH &&
    Math.abs(previous.x) <= worldBound && Math.abs(previous.z) <= worldBound) {
    const previousGroundY = groundHeight(previous.x, previous.z)
    if (canPlace(previous.x, previous.z, previousFeetY, previousGroundY)) {
      position.copy(previous)
      return finish(previousFeetY, previousGroundY)
    }
  }

  // A wide enclosed slab may have no local side exit. Try its nearby top or
  // underside at the same X/Z, subject to ground and full-body clearance.
  const groundY = groundHeight(x, z)
  let exitY = feetY, bestDistance = 3, hitUnderside = false
  for (const obstacle of nearby) {
    if (!obstacleBodyOverlaps(obstacle, x, z, feetY, height, radius, options)) continue
    const ramp = obstacle.walkSurface
    const solid = ramp && obstacle.solidBelow !== undefined
    const surfaceY = solid ? rampPlaneHeight(ramp, x, z) : admittedObstacleRamp(obstacle, options)
      ? getWalkRampHeight(ramp!, x, z)! : obstacle.box.max.y
    const baseY = solid ? rampBaseHeight(obstacle, x, z) : admittedObstacleRamp(obstacle, options)
      ? surfaceY - WALK_SURFACE_THICKNESS : obstacle.box.min.y
    const belowY = baseY - height
    if (Math.abs(surfaceY - feetY) <= bestDistance && canPlace(x, z, surfaceY, groundY)) {
      exitY = surfaceY
      bestDistance = Math.abs(surfaceY - feetY)
      hitUnderside = false
    }
    if (Math.abs(belowY - feetY) < bestDistance && canPlace(x, z, belowY, groundY)) {
      exitY = belowY
      bestDistance = Math.abs(belowY - feetY)
      hitUnderside = true
    }
  }
  if (exitY !== feetY) return finish(exitY, groundY, hitUnderside)
  return { velocityY, onGround }
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
  const worldBound = options.worldBound
  if (worldBound !== undefined && (Math.abs(position.x) > worldBound || Math.abs(position.z) > worldBound)) {
    clampToPlayableWorld(position, worldBound)
  }
  // Empty worlds have no support or contacts; preserve motion without building
  // a spatial query or running the recovery passes for every body sample.
  if (obstacles.length === 0) return { velocityY, onGround }
  const epsilon = BODY_CONTACT_EPSILON
  const initialBottomY = position.y - bottomOffset
  const initialVelocityY = velocityY
  const initialOnGround = onGround
  const previousBottomY = previousPosition.y - bottomOffset
  const travel = Math.hypot(position.x - previousPosition.x, position.z - previousPosition.z)
  const admittedRamp = (obstacle: ObstacleData) => admittedObstacleRamp(obstacle, options)

  const initialX = position.x
  const initialZ = position.z
  // No horizontal sweep needs no tighter envelope; retain the single-query
  // recovery path for stationary bodies (including loaded overlapping actors).
  const stationary = initialX === previousPosition.x && initialZ === previousPosition.z
  const candidates = stationary ? getLocalCollisionObstacles(obstacles, initialX, initialZ, radius) : getSweptCollisionObstacles(obstacles,
    Math.min(position.x, previousPosition.x) - radius, Math.min(position.z, previousPosition.z) - radius,
    Math.max(position.x, previousPosition.x) + radius, Math.max(position.z, previousPosition.z) + radius)

  if (options.recoverOnly) {
    if (bodyBlockedByObstacles(candidates, initialX, initialZ, initialBottomY, height, radius, options)) {
      return recoverObstaclePenetration(position, previousPosition, velocityY, onGround, radius, height, bottomOffset, obstacles, options)
    }
    return { velocityY, onGround }
  }

  // Select support from the unmodified frame position. Sequential snaps can
  // otherwise climb several overlapping surfaces beyond the single-step limit.
  let supportY: number | null = null
  let supportRamp: WalkRampSurface | undefined
  let continuesAtPreviousHeight = false
  if (velocityY <= 0) {
    for (const obstacle of candidates) {
      if (obstacle.physicalPassable) continue
      const ramp = admittedRamp(obstacle)
      if (!ramp) {
        // A grounded body crossing a seam at the same elevation must sweep
        // at that elevation. Gravity alone would put its feet into the next
        // box before the vertical landing pass can see the supporting top.
        if (obstacle.solidBelow === undefined && initialBottomY <= previousBottomY + epsilon &&
          Math.abs(previousBottomY - obstacle.box.max.y) <= epsilon) {
          continuesAtPreviousHeight ||= overlapsExpandedBox(initialX, initialZ, radius, obstacle.box)
        }
        continue
      }
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
  if (continuesAtPreviousHeight && (supportY === null || supportY < previousBottomY) &&
    candidates.some(obstacle => obstacleSupportsFeet(obstacle, previousPosition.x, previousPosition.z, previousBottomY, radius, options))) {
    supportY = previousBottomY
    supportRamp = undefined
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
      if (obstacle.physicalPassable) continue
      const ramp = obstacle.solidBelow !== undefined ? obstacle.walkSurface : admittedRamp(obstacle)
      const solidRamp = ramp && obstacle.solidBelow !== undefined
      if (ramp && !solidRamp) continue
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
      if (solidRamp) {
        const x = sweepX + dx * entry, z = sweepZ + dz * entry
        const top = rampPlaneHeight(ramp, x, z)
        if (feetY >= top - epsilon || feetY + height <= rampBaseHeight(obstacle, x, z) + epsilon) continue
        if (admittedRamp(obstacle) && feetY >= top - WALK_SURFACE_STEP_UP &&
          (supportRamp === ramp || clearsRampFringe(ramp, x, z, feetY, top, () => {
            const approachY = supportRamp ? getWalkRampHeight(supportRamp, x, z) : null
            return approachY !== null && feetY >= approachY - epsilon
          }))) continue
      } else if (feetY >= box.max.y - epsilon || feetY + height <= box.min.y + epsilon) continue
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
  // Revalidate dropped support before checking the final body volume. The
  // slide may have moved outside the original support's walk lane.
  if (supportY !== null && (position.x !== initialX || position.z !== initialZ)) {
    const y = supportRamp ? getWalkRampHeight(supportRamp, position.x, position.z) : null
    if (y !== null) position.y = (supportY = y) + bottomOffset
    else if (!candidates.some(obstacle => obstacleSupportsFeet(obstacle, position.x, position.z, supportY!, radius, options))) {
      position.y = initialBottomY + bottomOffset
      velocityY = initialVelocityY
      onGround = initialOnGround
      supportY = null
    }
  }

  // Settle vertical contacts first. If one changes Y, another collider
  // visited earlier may now overlap the body and must be checked again.
  const verticalStartY = position.y
  let penetrates = false, hasFringeSupport: boolean | undefined
  for (const obstacle of candidates) {
    const box = obstacle.box
    if (obstacle.physicalPassable || !overlapsExpandedBox(position.x, position.z, radius, box)) continue
    const bottomY = position.y - bottomOffset
    const topY = bottomY + height
    const solidRamp = obstacle.solidBelow !== undefined ? obstacle.walkSurface : undefined
    const thinRamp = solidRamp ? undefined : admittedRamp(obstacle)
    const volumeTop = solidRamp ? rampPlaneHeight(solidRamp, position.x, position.z)
      : thinRamp ? getWalkRampHeight(thinRamp, position.x, position.z) : box.max.y
    if (volumeTop === null) continue
    const volumeBottom = solidRamp ? rampBaseHeight(obstacle, position.x, position.z)
      : thinRamp ? volumeTop - WALK_SURFACE_THICKNESS : box.min.y

    if (!solidRamp && !thinRamp && velocityY <= 0 && previousBottomY >= volumeTop - epsilon && bottomY <= volumeTop + epsilon) {
      position.y = volumeTop + bottomOffset
      velocityY = 0
      onGround = true
    } else if (bottomY < volumeTop - epsilon && previousBottomY + height <= volumeBottom + epsilon && topY > volumeBottom + epsilon) {
      position.y = volumeBottom - height + bottomOffset
      if (velocityY > 0) velocityY = 0
      onGround = false
    } else if (!penetrates && bottomY < volumeTop - epsilon && topY > volumeBottom + epsilon) {
      if (solidRamp && admittedRamp(obstacle) && clearsRampFringe(solidRamp, position.x, position.z, bottomY, volumeTop,
        () => hasFringeSupport ??= candidates.some(support => obstacleSupportsFeet(support, position.x, position.z, bottomY, radius, options)))) continue
      penetrates = true
    }
  }
  if (position.y !== verticalStartY) {
    penetrates = bodyBlockedByObstacles(candidates, position.x, position.z, position.y - bottomOffset, height, radius, options)
  }
  if (penetrates) {
    const recovered = recoverObstaclePenetration(position, previousPosition, velocityY, onGround, radius, height, bottomOffset, obstacles, options)
    if (supportY !== null && !recovered.onGround && Math.abs(position.y - bottomOffset - supportY) <= epsilon) {
      const local = getLocalCollisionObstacles(obstacles, position.x, position.z, radius)
      const groundY = (options.groundHeight ?? getTerrainHeight)(position.x, position.z)
      if (initialBottomY >= groundY - epsilon &&
        !bodyBlockedByObstacles(local, position.x, position.z, initialBottomY, height, radius, options)) {
        position.y = initialBottomY + bottomOffset
        const supported = initialVelocityY <= 0 && (Math.abs(initialBottomY - groundY) <= epsilon ||
          local.some(obstacle => obstacleSupportsFeet(obstacle, position.x, position.z, initialBottomY, radius, options)))
        return { velocityY: supported ? 0 : initialVelocityY, onGround: supported, recovered: recovered.recovered }
      }
    }
    return recovered
  }

  return { velocityY, onGround }
}

export function createTerrain(
  scene: THREE.Scene,
  options: TerrainOptions = {},
): TerrainResult {
  activeFortifiedCampFaction = options.fortifiedCampFaction ?? null
  activeFlatTerrainY = null
  flatTerrainOwner = null
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
