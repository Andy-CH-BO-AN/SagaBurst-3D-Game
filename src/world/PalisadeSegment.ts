import * as THREE from 'three'
import { getTerrainHeight } from './Terrain'
import { bakedMesh, beamBetween } from './EnvironmentVisuals'

export function createPalisadeStakeGeometry(height: number, radius = .15): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(radius * (11 / 15), radius, height, 7, 2)
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    if (Math.abs(positions.getY(i)) < .001) positions.setY(i, height / 2 - .18)
    else if (positions.getY(i) > height * .49) {
      positions.setX(i, positions.getX(i) * .16)
      positions.setZ(i, positions.getZ(i) * .16)
    }
  }
  geometry.computeVertexNormals()
  return geometry
}

/** Shared terrain-following Outpost/City visual and continuous collision envelope. */
export function createPalisadeSegment(options: {
  name: string; x: number; z: number; widthX: number; depthZ: number; height: number
  stakeGeometry: THREE.BufferGeometry; woodMaterial: THREE.Material; railMaterial: THREE.Material
  spacing?: number; railRadius?: number; railOffset?: number
}) {
  const { name, x, z, widthX, depthZ, height, stakeGeometry, woodMaterial, railMaterial } = options
  const root = new THREE.Group(); root.name = name
  const horizontal = widthX >= depthZ, length = horizontal ? widthX : depthZ
  const count = Math.max(2, Math.ceil(length / (options.spacing ?? .2)))
  const stakes = new THREE.InstancedMesh(stakeGeometry, woodMaterial, count)
  stakes.name = `${name}-stakes`; stakes.castShadow = true; stakes.receiveShadow = true
  const matrix = new THREE.Matrix4(), color = new THREE.Color()
  let minY = Infinity, maxY = -Infinity
  for (let i = 0; i < count; i++) {
    const offset = -length / 2 + length / count * (i + .5)
    const px = horizontal ? x + offset : x, pz = horizontal ? z : z + offset, y = getTerrainHeight(px, pz)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    stakes.setMatrixAt(i, matrix.makeTranslation(px, y + height / 2, pz))
    stakes.setColorAt(i, color.setHSL(.09, .12, .65 + Math.sin(i * 13.7) * .12))
  }
  stakes.instanceMatrix.needsUpdate = true; stakes.computeBoundingSphere(); root.add(stakes)
  const rails = [.42, .76].map(ratio => {
    const parts: THREE.BufferGeometry[] = [], sections = Math.ceil(length / 2), railOffset = options.railOffset ?? .17
    const point = (offset: number) => {
      const px = horizontal ? x + offset : x + railOffset, pz = horizontal ? z + railOffset : z + offset
      return new THREE.Vector3(px, getTerrainHeight(px, pz) + height * ratio, pz)
    }
    for (let i = 0; i < sections; i++) parts.push(beamBetween(point(-length / 2 + length * i / sections), point(-length / 2 + length * (i + 1) / sections), options.railRadius ?? .075))
    return bakedMesh(parts, railMaterial)
  })
  root.add(...rails)
  return { root, hitMeshes: [stakes, ...rails], box: new THREE.Box3(
    new THREE.Vector3(x - widthX / 2, minY, z - depthZ / 2),
    new THREE.Vector3(x + widthX / 2, maxY + height, z + depthZ / 2)),
  }
}
