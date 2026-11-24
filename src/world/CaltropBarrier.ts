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
export function createCaltropBarrier(parent: THREE.Object3D, rects: readonly { minX: number; maxX: number; minZ: number; maxZ: number; alongZ?: boolean }[],
  obstacles: ObstacleData[]): THREE.Group {
  beamGeometry ??= new THREE.BoxGeometry(.16, BARRIER_HEIGHT * 1.25, .16)
  railGeometry ??= new THREE.BoxGeometry(1, .14, .14)
  material ??= new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: .9, metalness: 0 })
  const root = new THREE.Group(); root.name = 'caltrop-barriers'
  for (const rect of rects) {
    const centerX = (rect.minX + rect.maxX) / 2, centerZ = (rect.minZ + rect.maxZ) / 2
    const ground = getTerrainHeight(centerX, centerZ)
    obstacles.push({ box: new THREE.Box3(new THREE.Vector3(rect.minX, ground - 1, rect.minZ), new THREE.Vector3(rect.maxX, ground + BARRIER_HEIGHT, rect.maxZ)), isBarricade: false })
    const length = rect.alongZ ? rect.maxZ - rect.minZ : rect.maxX - rect.minX, count = Math.max(2, Math.round(length / 1.4))
    for (let i = 0; i < count; i++) {
      const offset = length / count * (i + .5)
      const x = rect.alongZ ? centerX : rect.minX + offset
      const z = rect.alongZ ? rect.minZ + offset : centerZ
      const y = getTerrainHeight(x, z)
      for (const tilt of [Math.PI / 4, -Math.PI / 4]) {
        const beam = new THREE.Mesh(beamGeometry, material)
        beam.position.set(x, y + BARRIER_HEIGHT / 2, z)
        if (rect.alongZ) beam.rotation.x = tilt
        else beam.rotation.z = tilt
        beam.castShadow = true
        root.add(beam)
      }
    }
    const rail = new THREE.Mesh(railGeometry, material)
    rail.scale.x = length
    if (rect.alongZ) rail.rotation.y = Math.PI / 2
    rail.position.set(centerX, ground + BARRIER_HEIGHT * .55, centerZ); rail.castShadow = true
    root.add(rail)
  }
  parent.add(root)
  return root
}
