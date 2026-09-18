/**
 * Terrain.ts
 * Creates a procedural 3D heightmap terrain with undulating hills and valleys.
 * Exports getTerrainHeight(x, z) to calibrate all 3D entity & obstacle positions.
 */
import * as THREE from 'three'

export const TERRAIN_SIZE = 400
export const PLAYABLE_WORLD_BOUND = 180

/** Keeps actors on the rendered terrain while leaving a 20m safety margin at each edge. */
export function clampToPlayableWorld(position: THREE.Vector3): void {
  position.x = THREE.MathUtils.clamp(position.x, -PLAYABLE_WORLD_BOUND, PLAYABLE_WORLD_BOUND)
  position.z = THREE.MathUtils.clamp(position.z, -PLAYABLE_WORLD_BOUND, PLAYABLE_WORLD_BOUND)
}

/**
 * Calculates terrain Y height at any (x, z) world coordinate using smooth sine/cosine wave superposition.
 */
export function getTerrainHeight(x: number, z: number): number {
  const h1 = Math.sin(x * 0.04) * Math.cos(z * 0.04) * 2.5
  const h2 = Math.sin(x * 0.09 + 1.2) * Math.cos(z * 0.08 + 0.5) * 1.2
  return h1 + h2
}

export interface ObstacleData {
  box: THREE.Box3
  isBarricade: boolean
}

export interface TerrainResult {
  terrainMesh: THREE.Mesh
  obstacles: ObstacleData[]
  obstacleMeshes: THREE.Object3D[]
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

export function createTerrain(scene: THREE.Scene): TerrainResult {
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

  // ── Pine trees (Phase 0~5 hardcoded positions calibrated with getTerrainHeight) ──
  const treeTrunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e })
  const treeLeafMat  = new THREE.MeshLambertMaterial({ color: 0x2d5a27 })
  const treePositions: [number, number][] = [
    [18, -22], [-28, 18], [40, -5], [-12, 35], [25, 15],
  ]

  treePositions.forEach(([tx, tz]) => {
    const terrainY = getTerrainHeight(tx, tz)

    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 8)
    trunkGeo.computeBoundingSphere()
    const trunk = new THREE.Mesh(trunkGeo, treeTrunkMat)
    trunk.position.set(tx, terrainY + 1, tz)
    trunk.castShadow = true
    scene.add(trunk)
    obstacleMeshes.push(trunk)

    const leavesGeo = new THREE.ConeGeometry(2, 4, 8)
    leavesGeo.computeBoundingSphere()
    const leaves = new THREE.Mesh(leavesGeo, treeLeafMat)
    leaves.position.set(tx, terrainY + 4, tz)
    leaves.castShadow = true
    scene.add(leaves)
    obstacleMeshes.push(leaves)

    // Trunk collision box calibrated to terrain height
    const box = new THREE.Box3(
      new THREE.Vector3(tx - 0.4, terrainY, tz - 0.4),
      new THREE.Vector3(tx + 0.4, terrainY + 6, tz + 0.4)
    )
    obstacles.push({ box, isBarricade: false })
  })

  return { terrainMesh, obstacles, obstacleMeshes }
}
