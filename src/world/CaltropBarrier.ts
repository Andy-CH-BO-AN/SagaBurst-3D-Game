import * as THREE from 'three'
import { getTerrainHeight, type ObstacleData } from './Terrain'

const BARRIER_HEIGHT = 1.9
let beamGeometry: THREE.BoxGeometry | undefined
let railGeometry: THREE.BoxGeometry | undefined
let material: THREE.MeshStandardMaterial | undefined

/**
 * Scattered caltrop (chevaux-de-frise) segments: one solid navigation/collision box per
 * segment plus crossed-beam visuals. The boxes join the shared obstacle list, so the existing
 * A* topology and body collision route every actor around them through the planned gaps.
 */
export function createCaltropBarrier(scene: THREE.Scene, rects: readonly { minX: number; maxX: number; minZ: number; maxZ: number }[],
  obstacles: ObstacleData[]): THREE.Group {
  beamGeometry ??= new THREE.BoxGeometry(.16, BARRIER_HEIGHT * 1.25, .16)
  railGeometry ??= new THREE.BoxGeometry(1, .14, .14)
  material ??= new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: .9, metalness: 0 })
  const root = new THREE.Group(); root.name = 'veteran-caltrop-barrier'
  for (const rect of rects) {
    const centerX = (rect.minX + rect.maxX) / 2, centerZ = (rect.minZ + rect.maxZ) / 2
    const ground = getTerrainHeight(centerX, centerZ)
    obstacles.push({ box: new THREE.Box3(new THREE.Vector3(rect.minX, ground - 1, rect.minZ), new THREE.Vector3(rect.maxX, ground + BARRIER_HEIGHT, rect.maxZ)), isBarricade: false })
    const length = rect.maxX - rect.minX, count = Math.max(2, Math.round(length / 1.4))
    for (let i = 0; i < count; i++) {
      const x = rect.minX + length / count * (i + .5), y = getTerrainHeight(x, centerZ)
      for (const tilt of [Math.PI / 4, -Math.PI / 4]) {
        const beam = new THREE.Mesh(beamGeometry, material)
        beam.position.set(x, y + BARRIER_HEIGHT / 2, centerZ); beam.rotation.z = tilt; beam.castShadow = true
        root.add(beam)
      }
    }
    const rail = new THREE.Mesh(railGeometry, material)
    rail.scale.x = length; rail.position.set(centerX, getTerrainHeight(centerX, centerZ) + BARRIER_HEIGHT * .55, centerZ); rail.castShadow = true
    root.add(rail)
  }
  scene.add(root)
  return root
}
