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
  const beamMatrices: THREE.Matrix4[] = []
  const railMatrices: THREE.Matrix4[] = []
  const dummy = new THREE.Object3D()
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
        dummy.position.set(x, y + BARRIER_HEIGHT / 2, z)
        dummy.rotation.set(rect.alongZ ? tilt : 0, 0, rect.alongZ ? 0 : tilt)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        beamMatrices.push(dummy.matrix.clone())
      }
    }
    dummy.position.set(centerX, ground + BARRIER_HEIGHT * .55, centerZ)
    dummy.rotation.set(0, rect.alongZ ? Math.PI / 2 : 0, 0)
    dummy.scale.set(length, 1, 1)
    dummy.updateMatrix()
    railMatrices.push(dummy.matrix.clone())
  }
  if (beamMatrices.length > 0) {
    const beams = new THREE.InstancedMesh(beamGeometry, material, beamMatrices.length)
    beams.name = 'caltrop-beams'
    beams.castShadow = true
    beams.receiveShadow = false
    for (let i = 0; i < beamMatrices.length; i++) beams.setMatrixAt(i, beamMatrices[i])
    beams.instanceMatrix.needsUpdate = true
    beams.computeBoundingSphere()
    root.add(beams)
  }
  if (railMatrices.length > 0) {
    const rails = new THREE.InstancedMesh(railGeometry, material, railMatrices.length)
    rails.name = 'caltrop-rails'
    rails.castShadow = true
    rails.receiveShadow = false
    for (let i = 0; i < railMatrices.length; i++) rails.setMatrixAt(i, railMatrices[i])
    rails.instanceMatrix.needsUpdate = true
    rails.computeBoundingSphere()
    root.add(rails)
  }
  parent.add(root)
  return root
}
