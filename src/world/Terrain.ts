/**
 * Terrain.ts
 * Creates a procedural 3D heightmap terrain with undulating hills and valleys.
 * Exports getTerrainHeight(x, z) to calibrate all 3D entity & obstacle positions.
 */
import * as THREE from 'three'

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
  // 200x200 Plane with 64x64 subdivisions for smooth hill curves
  const geometry = new THREE.PlaneGeometry(200, 200, 64, 64)
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

  const material = new THREE.MeshLambertMaterial({
    color: 0x4a7c3f,
    flatShading: true,
  })

  const terrainMesh = new THREE.Mesh(geometry, material)
  terrainMesh.name = 'terrain'
  terrainMesh.receiveShadow = true
  scene.add(terrainMesh)

  const obstacles: ObstacleData[] = []

  // ── Decorative rocks (Phase 0~5 hardcoded positions calibrated with getTerrainHeight) ──
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x888888 })
  const rockPositions: [number, number][] = [
    [10, -15],
    [-20, 10],
    [30, 25],
    [-35, -20],
    [5, 40],
  ]

  rockPositions.forEach(([x, z]) => {
    const size = 1.2
    const terrainY = getTerrainHeight(x, z)
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(size, 0),
      rockMat
    )
    rock.position.set(x, terrainY + size * 0.5, z)
    rock.rotation.set(0.3, 0.7, 0.2)
    rock.castShadow = true
    rock.receiveShadow = true
    scene.add(rock)

    // AABB collision box calibrated to terrain height
    const halfSize = size * 0.85
    const box = new THREE.Box3(
      new THREE.Vector3(x - halfSize, terrainY, z - halfSize),
      new THREE.Vector3(x + halfSize, terrainY + size * 2, z + halfSize)
    )
    obstacles.push({ box, isBarricade: false })
  })

  // ── Pine trees (Phase 0~5 hardcoded positions calibrated with getTerrainHeight) ──
  const treeTrunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e })
  const treeLeafMat  = new THREE.MeshLambertMaterial({ color: 0x2d5a27 })
  const treePositions: [number, number][] = [
    [18, -22], [-28, 18], [40, -5], [-12, 35], [25, 15],
  ]

  treePositions.forEach(([tx, tz]) => {
    const terrainY = getTerrainHeight(tx, tz)

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 8), treeTrunkMat)
    trunk.position.set(tx, terrainY + 1, tz)
    trunk.castShadow = true
    scene.add(trunk)

    const leaves = new THREE.Mesh(new THREE.ConeGeometry(2, 4, 8), treeLeafMat)
    leaves.position.set(tx, terrainY + 4, tz)
    leaves.castShadow = true
    scene.add(leaves)

    // Trunk collision box calibrated to terrain height
    const box = new THREE.Box3(
      new THREE.Vector3(tx - 0.4, terrainY, tz - 0.4),
      new THREE.Vector3(tx + 0.4, terrainY + 6, tz + 0.4)
    )
    obstacles.push({ box, isBarricade: false })
  })

  // ── Cheval-de-frise (Barricades) for Phase 12 ──
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x5c4033, flatShading: true })
  const barricadePositions: [number, number, number][] = [
    [15, -5, Math.PI / 4],
    [20, 5, -Math.PI / 6],
    [-15, 15, Math.PI / 2],
  ]

  barricadePositions.forEach(([x, z, rot]) => {
    const barricadeGroup = new THREE.Group()
    const ty = getTerrainHeight(x, z)
    barricadeGroup.position.set(x, ty, z)
    barricadeGroup.rotation.y = rot

    // Base log
    const base = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 0.4), woodMat)
    base.position.y = 0.2
    base.castShadow = true
    barricadeGroup.add(base)

    // Cross spikes
    for (let i = -1.5; i <= 1.5; i += 1.5) {
      const spike1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.5, 0.3), woodMat)
      spike1.position.set(i, 1.0, 0)
      spike1.rotation.x = Math.PI / 4
      spike1.castShadow = true
      barricadeGroup.add(spike1)

      const spike2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.5, 0.3), woodMat)
      spike2.position.set(i, 1.0, 0)
      spike2.rotation.x = -Math.PI / 4
      spike2.castShadow = true
      barricadeGroup.add(spike2)
    }

    scene.add(barricadeGroup)
    
    // Collision box for the barricade
    const box = new THREE.Box3(
      new THREE.Vector3(x - 2, ty, z - 2),
      // The rotated spikes reach roughly 2.7m above the ground.
      new THREE.Vector3(x + 2, ty + 3.0, z + 2)
    )
    obstacles.push({ box, isBarricade: true })
  })

  return { terrainMesh, obstacles }
}
