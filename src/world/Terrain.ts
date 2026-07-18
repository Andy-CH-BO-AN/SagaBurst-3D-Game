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
      const spike1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.5, 0.2), woodMat)
      spike1.position.set(i, 0.5, 0)
      spike1.rotation.x = Math.PI / 4
      spike1.castShadow = true
      barricadeGroup.add(spike1)

      const spike2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.5, 0.2), woodMat)
      spike2.position.set(i, 0.5, 0)
      spike2.rotation.x = -Math.PI / 4
      spike2.castShadow = true
      barricadeGroup.add(spike2)
    }

    scene.add(barricadeGroup)
    
    // Create collision box slightly smaller than the spikes to feel fair
    const box = new THREE.Box3().setFromObject(barricadeGroup)
    box.expandByScalar(-0.2)
    obstacles.push({ box, isBarricade: true })
  })

  return { terrainMesh, obstacles }
}
