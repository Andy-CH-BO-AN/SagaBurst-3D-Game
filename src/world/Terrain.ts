/**
 * Terrain.ts
 * Creates a procedural 3D heightmap terrain with undulating hills and valleys.
 * Exports getTerrainHeight(x, z) to calibrate all 3D entity & obstacle positions.
 */
import * as THREE from 'three'
import { DAMAGEABLE_OBSTACLE_HP, DamageableObstacle } from './DamageableObstacle'
import type { CharacterFaction } from './CharacterVisuals'

export const TERRAIN_SIZE = 400
export const PLAYABLE_WORLD_BOUND = 180

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
export function clampToPlayableWorld(position: THREE.Vector3): void {
  position.x = THREE.MathUtils.clamp(position.x, -PLAYABLE_WORLD_BOUND, PLAYABLE_WORLD_BOUND)
  position.z = THREE.MathUtils.clamp(position.z, -PLAYABLE_WORLD_BOUND, PLAYABLE_WORLD_BOUND)
}

let activeFortifiedCampFaction: CharacterFaction | null = null

export interface TerrainOptions {
  fortifiedCampFaction?: CharacterFaction | null
}

/**
 * Calculates terrain Y height at any (x, z) world coordinate using smooth sine/cosine wave superposition.
 */
export function getTerrainHeight(x: number, z: number): number {
  const h1 = Math.sin(x * 0.04) * Math.cos(z * 0.04) * 2.5
  const h2 = Math.sin(x * 0.09 + 1.2) * Math.cos(z * 0.08 + 0.5) * 1.2
  const campOffset = activeFortifiedCampFaction
    ? getFortifiedCampHeightOffset(x, z, activeFortifiedCampFaction)
    : 0
  return h1 + h2 + campOffset
}

export interface ObstacleData {
  box: THREE.Box3
  isBarricade: boolean
  damageable?: DamageableObstacle
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
  return true
}

export interface ObstacleCollisionResult {
  velocityY: number
  onGround: boolean
}

export interface EntityCollisionBody {
  position: THREE.Vector3
  radius: number
  height: number
  bottomOffset: number
  anchored?: boolean
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

  const overlapsObstacle = (pos: THREE.Vector3, offsetX: number, offsetZ: number, radius: number, bottomOffset: number, height: number): boolean => {
    const targetX = pos.x + offsetX
    const targetZ = pos.z + offsetZ
    const b = pos.y - bottomOffset
    const t = b + height
    for (const obs of obstacles) {
      if (b >= obs.box.max.y - 0.001 || t <= obs.box.min.y + 0.001) continue
      if (targetX + radius > obs.box.min.x && targetX - radius < obs.box.max.x &&
          targetZ + radius > obs.box.min.z && targetZ - radius < obs.box.max.z) {
        return true
      }
    }
    return false
  }

  // Direction B: Predictive Obstacle Check
  // If pushed into a wall, treat the entity as temporarily anchored
  const firstAnchored = first.anchored || overlapsObstacle(first.position, normalX * halfPush, normalZ * halfPush, first.radius, first.bottomOffset, first.height)
  const secondAnchored = second.anchored || overlapsObstacle(second.position, -normalX * halfPush, -normalZ * halfPush, second.radius, second.bottomOffset, second.height)

  if (firstAnchored && secondAnchored) return
  if (firstAnchored) {
    if (!overlapsObstacle(second.position, -normalX * pushDistance, -normalZ * pushDistance, second.radius, second.bottomOffset, second.height)) {
      second.position.x -= normalX * pushDistance
      second.position.z -= normalZ * pushDistance
    }
  } else if (secondAnchored) {
    if (!overlapsObstacle(first.position, normalX * pushDistance, normalZ * pushDistance, first.radius, first.bottomOffset, first.height)) {
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
): ObstacleCollisionResult {
  const epsilon = 0.001
  const bottomY = position.y - bottomOffset
  const topY = bottomY + height

  const overlapsHorizontally = (x: number, z: number, box: THREE.Box3): boolean =>
    x + radius > box.min.x && x - radius < box.max.x &&
    z + radius > box.min.z && z - radius < box.max.z

  for (const obstacle of obstacles) {
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
    }
  }

  return { velocityY, onGround }
}

export function createTerrain(
  scene: THREE.Scene,
  options: TerrainOptions = {},
): TerrainResult {
  activeFortifiedCampFaction = options.fortifiedCampFaction ?? null
  // 400x400 Plane with 128x128 subdivisions for smooth hill curves
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 128, 128)
  geometry.rotateX(-Math.PI / 2)

  // Apply procedural height function to PlaneGeometry vertices
  const posAttr = geometry.attributes.position
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i)
    const vz = posAttr.getZ(i)
    const vy = getTerrainHeight(vx, vz)
    posAttr.setY(i, vy)
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()

  const material = new THREE.MeshLambertMaterial({
    color: 0x4a7c3f,
    flatShading: true,
  })

  const terrainMesh = new THREE.Mesh(geometry, material)
  terrainMesh.name = 'terrain'
  terrainMesh.receiveShadow = true
  scene.add(terrainMesh)

  const obstacles: ObstacleData[] = []
  const obstacleMeshes: THREE.Object3D[] = []
  const damageableObstacles: DamageableObstacle[] = []

  // ── Pine trees (damageable, but AI destruction policy is implemented separately) ──
  const treeTrunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e })
  const treeLeafMat = new THREE.MeshLambertMaterial({ color: 0x2d5a27 })
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 8)
  const leavesGeo = new THREE.ConeGeometry(2, 4, 8)
  trunkGeo.computeBoundingSphere()
  leavesGeo.computeBoundingSphere()

  TERRAIN_TREE_POSITIONS.forEach(([tx, tz], index) => {
    const terrainY = getTerrainHeight(tx, tz)
    const root = new THREE.Group()
    root.name = `damageable-tree-${index + 1}`

    const trunk = new THREE.Mesh(trunkGeo, treeTrunkMat)
    trunk.position.set(tx, terrainY + 1, tz)
    trunk.castShadow = true
    root.add(trunk)

    const leaves = new THREE.Mesh(leavesGeo, treeLeafMat)
    leaves.position.set(tx, terrainY + 4, tz)
    leaves.castShadow = true
    root.add(leaves)

    scene.add(root)
    obstacleMeshes.push(trunk, leaves)

    const box = new THREE.Box3(
      new THREE.Vector3(tx - 0.4, terrainY, tz - 0.4),
      new THREE.Vector3(tx + 0.4, terrainY + 6, tz + 0.4),
    )
    const damageable = new DamageableObstacle({
      kind: 'tree',
      maxHp: DAMAGEABLE_OBSTACLE_HP.tree,
      root,
      hitMeshes: [trunk, leaves],
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