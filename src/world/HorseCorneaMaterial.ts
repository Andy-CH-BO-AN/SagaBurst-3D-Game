import * as THREE from 'three'

const HORSE_CORNEA_MATERIAL_MARKER = 'horse_cornea'

export interface HorseCorneaMaterialSnapshot {
  name: string
  materialType: string
  transmission: number
  opacity: number
  transparent: boolean
  roughness: number
  metalness: number
  ior: number
  thickness: number
  clearcoat: number
  clearcoatRoughness: number
  envMap: boolean
}

function isHorseCorneaMaterial(material: THREE.Material): material is THREE.MeshPhysicalMaterial {
  return material instanceof THREE.MeshPhysicalMaterial
    && material.name.toLowerCase().includes(HORSE_CORNEA_MATERIAL_MARKER)
}

function horseCorneaMaterials(root: THREE.Object3D): THREE.MeshPhysicalMaterial[] {
  const result = new Set<THREE.MeshPhysicalMaterial>()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (isHorseCorneaMaterial(material)) result.add(material)
    }
  })
  return [...result]
}

/**
 * Keeps the glTF-authored transparent cornea surface, clearcoat, IOR and
 * reflectivity while opting it out of Three.js' costly transmission prepass.
 * This deliberately touches only materials named by the horse asset itself.
 */
export function setHorseCorneaTransmission(root: THREE.Object3D, enabled: boolean): number {
  const materials = horseCorneaMaterials(root)
  for (const material of materials) {
    const nextTransmission = enabled ? 1 : 0
    if (material.transmission !== nextTransmission) {
      material.transmission = nextTransmission
      material.needsUpdate = true
    }
  }
  return materials.length
}

export function inspectHorseCorneaMaterials(root: THREE.Object3D): HorseCorneaMaterialSnapshot[] {
  return horseCorneaMaterials(root).map((material) => ({
    name: material.name,
    materialType: material.type,
    transmission: material.transmission,
    opacity: material.opacity,
    transparent: material.transparent,
    roughness: material.roughness,
    metalness: material.metalness,
    ior: material.ior,
    thickness: material.thickness,
    clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness,
    envMap: material.envMap !== null,
  }))
}
