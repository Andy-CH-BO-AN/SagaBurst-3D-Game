import * as THREE from 'three'
import type { Mount } from '../world/Mount'

export interface HorseLodDistribution {
  lod0: number
  lod1: number
  lod2: number
}

export interface HorseRenderCensus {
  horseCount: number
  totalObject3DCount: number
  meshCount: number
  skinnedMeshCount: number
  visibleMeshCount: number
  visibleSkinnedMeshCount: number
  shadowCasterCount: number
  receiveShadowCount: number
  uniqueGeometryCount: number
  uniqueMaterialCount: number
  lodDistribution: HorseLodDistribution
  avgDrawableMeshesPerHorse: number
  avgShadowCastersPerHorse: number
  meshCountPerLod: HorseLodDistribution
  materialCountPerLod: HorseLodDistribution
}

export function isEffectivelyVisible(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj
  while (cur) {
    if (!cur.visible) return false
    cur = cur.parent
  }
  return true
}

export function setHorseVisualsHidden(mounts: Mount[], hidden: boolean): void {
  for (const m of mounts) {
    if (m.setVisualHidden) {
      m.setVisualHidden(hidden)
    } else if (m.horseVisual) {
      m.horseVisual.root.visible = !hidden
    }
  }
}

export function isHorseVisualHidden(mount: Mount): boolean {
  if (mount.isVisualHidden) {
    return mount.isVisualHidden()
  }
  return mount.horseVisual ? !mount.horseVisual.root.visible : false
}

export function collectHorseRenderCensus(mounts: Mount[]): HorseRenderCensus {
  const horseMounts = mounts.filter((m) => m.horseVisual !== null && m.horseVisual !== undefined)
  const horseCount = horseMounts.length

  let totalObject3DCount = 0
  let meshCount = 0
  let skinnedMeshCount = 0
  let visibleMeshCount = 0
  let visibleSkinnedMeshCount = 0
  let shadowCasterCount = 0
  let receiveShadowCount = 0

  const uniqueGeometries = new Set<string>()
  const uniqueMaterials = new Set<string>()
  const lodDistribution: HorseLodDistribution = { lod0: 0, lod1: 0, lod2: 0 }

  const meshCountPerLod: HorseLodDistribution = { lod0: 0, lod1: 0, lod2: 0 }
  const materialCountPerLod: HorseLodDistribution = { lod0: 0, lod1: 0, lod2: 0 }

  // Inspect representative LOD structure if horses exist
  if (horseMounts.length > 0) {
    const rep = horseMounts[0].horseVisual!
    if (rep.lod && rep.lod.levels) {
      const keys: Array<keyof HorseLodDistribution> = ['lod0', 'lod1', 'lod2']
      for (let i = 0; i < 3 && i < rep.lod.levels.length; i++) {
        const levelObj = rep.lod.levels[i]?.object
        if (levelObj) {
          let count = 0
          const matSet = new Set<string>()
          levelObj.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              count++
              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material.forEach((mat) => matSet.add(mat.uuid))
                } else {
                  matSet.add(child.material.uuid)
                }
              }
            }
          })
          meshCountPerLod[keys[i]] = count
          materialCountPerLod[keys[i]] = matSet.size
        }
      }
    }
  }

  for (const mount of horseMounts) {
    const visual = mount.horseVisual!
    const debug = visual.debugState ? visual.debugState() : null
    const currentLod = debug ? debug.lod : visual.lod?.getCurrentLevel() ?? 0
    if (currentLod === 0) lodDistribution.lod0++
    else if (currentLod === 1) lodDistribution.lod1++
    else if (currentLod === 2) lodDistribution.lod2++

    visual.root.traverse((obj) => {
      totalObject3DCount++

      if (obj instanceof THREE.Mesh) {
        meshCount++
        if (obj instanceof THREE.SkinnedMesh) {
          skinnedMeshCount++
        }

        if (isEffectivelyVisible(obj)) {
          visibleMeshCount++
          if (obj instanceof THREE.SkinnedMesh) {
            visibleSkinnedMeshCount++
          }
        }

        if (obj.castShadow) shadowCasterCount++
        if (obj.receiveShadow) receiveShadowCount++

        if (obj.geometry) {
          uniqueGeometries.add(obj.geometry.uuid)
        }

        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((mat) => uniqueMaterials.add(mat.uuid))
          } else {
            uniqueMaterials.add(obj.material.uuid)
          }
        }
      }
    })
  }

  const avgDrawableMeshesPerHorse = horseCount > 0
    ? Number((visibleMeshCount / horseCount).toFixed(2))
    : 0
  const avgShadowCastersPerHorse = horseCount > 0
    ? Number((shadowCasterCount / horseCount).toFixed(2))
    : 0

  return {
    horseCount,
    totalObject3DCount,
    meshCount,
    skinnedMeshCount,
    visibleMeshCount,
    visibleSkinnedMeshCount,
    shadowCasterCount,
    receiveShadowCount,
    uniqueGeometryCount: uniqueGeometries.size,
    uniqueMaterialCount: uniqueMaterials.size,
    lodDistribution,
    avgDrawableMeshesPerHorse,
    avgShadowCastersPerHorse,
    meshCountPerLod,
    materialCountPerLod,
  }
}
