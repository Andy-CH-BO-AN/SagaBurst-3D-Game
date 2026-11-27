import type * as THREE from 'three'

/**
 * An actor whose LOD1 and LOD2 skinned meshes provably share the same skeleton and bind space:
 * LOD2 then holds the same bone pose as LOD1 on every frame, so its cheaper mesh can stand in
 * for LOD1 while the shadow map is rendered (the main pass keeps drawing LOD1).
 */
export interface Lod1ShadowProxyPlan {
  readonly level1: THREE.Object3D
  readonly level2: THREE.Object3D
  readonly casters: readonly THREE.Mesh[]
  /** For each caster, the LOD1 mesh whose (always current) world matrix it shares. */
  readonly counterparts: readonly THREE.Mesh[]
  /** Scratch state for the pass in flight, reused to avoid per-frame allocation. */
  savedCasterFlags: boolean[]
  savedLevel1Visible: boolean
  savedLevel2Visible: boolean
}

const BIND_TOLERANCE = 1e-6

function sameElements(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > BIND_TOLERANCE) return false
  return true
}

/** Same depth below their levels and equal local matrices at every step, so both worlds are equal. */
function sameChain(a: THREE.Object3D, levelA: THREE.Object3D, b: THREE.Object3D, levelB: THREE.Object3D): boolean {
  let x: THREE.Object3D | null = a, y: THREE.Object3D | null = b
  while (x !== levelA && y !== levelB) {
    if (x === null || y === null || !sameElements(x.matrix.elements, y.matrix.elements)) return false
    x = x.parent
    y = y.parent
  }
  return x === levelA && y === levelB
}

/** Skinned meshes below `level`; null when it holds any other mesh kind (not representable by a proxy). */
function skinnedMeshesOf(level: THREE.Object3D): THREE.SkinnedMesh[] | null {
  const meshes: THREE.SkinnedMesh[] = []
  let pure = true
  level.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh && !(object as THREE.Line).isLine && !(object as THREE.Points).isPoints) return
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh && !Array.isArray(mesh.material)) meshes.push(mesh as THREE.SkinnedMesh)
    else pure = false
  })
  return pure && meshes.length > 0 ? meshes : null
}

/**
 * Proof that a three-level humanoid `THREE.LOD` under `visual` can use its LOD2 meshes as the
 * LOD1 shadow caster: every LOD2 skinned mesh uses a Skeleton instance that LOD1 also uses, with
 * the same bind matrix and bind mode, and neither level contains rigid or multi-material meshes
 * (which a proxy would drop). Returns null when any condition fails; callers keep LOD1 shadows.
 */
export function proveLod1ShadowProxy(visual: THREE.Object3D): Lod1ShadowProxyPlan | null {
  let lod: THREE.LOD | null = null
  visual.traverse(object => { if (!lod && (object as THREE.LOD).isLOD) lod = object as THREE.LOD })
  const found = lod as THREE.LOD | null
  if (!found || found.levels.length !== 3) return null
  const level1 = found.levels[1].object, level2 = found.levels[2].object
  if (level1 === level2 || level1.parent === null || level1.parent !== level2.parent) return null
  const lod1Meshes = skinnedMeshesOf(level1), lod2Meshes = skinnedMeshesOf(level2)
  if (!lod1Meshes || !lod2Meshes) return null
  // Equal local transforms down an identical chain (levels under the shared parent, meshes at the
  // same depth below their level) make the proxy's world matrix equal to its LOD1 counterpart's, so the pass
  // copies it instead of recomputing the hidden level's matrices.
  if (!sameElements(level1.matrix.elements, level2.matrix.elements)) return null
  const counterparts: THREE.Mesh[] = []
  for (const proxy of lod2Meshes) {
    const same = lod1Meshes.filter(mesh => mesh.skeleton === proxy.skeleton)
    if (same.length === 0) return null
    for (const mesh of same) {
      if (mesh.bindMode !== proxy.bindMode || !sameElements(mesh.bindMatrix.elements, proxy.bindMatrix.elements)
        || !sameChain(mesh, level1, proxy, level2)) return null
    }
    counterparts.push(same[0])
  }
  return {
    level1, level2, casters: lod2Meshes, counterparts,
    savedCasterFlags: lod2Meshes.map(() => false), savedLevel1Visible: false, savedLevel2Visible: false,
  }
}

/** True while the LOD currently draws level 1 and level 2 is hidden (the only state a swap applies to). */
export function lod1ProxyApplicable(plan: Lod1ShadowProxyPlan): boolean {
  return plan.level1.visible && !plan.level2.visible && plan.level1.parent !== null && plan.level1.parent === plan.level2.parent
}

/**
 * Swaps LOD1 for its LOD2 proxy for the duration of one shadow pass: LOD1 is hidden, LOD2 is shown
 * with `castShadow` on and its world matrices copied from LOD1 (hidden levels skip their matrix updates).
 */
export function applyLod1ShadowProxy(plan: Lod1ShadowProxyPlan): void {
  plan.savedLevel1Visible = plan.level1.visible
  plan.savedLevel2Visible = plan.level2.visible
  plan.level1.visible = false
  plan.level2.visible = true
  for (let i = 0; i < plan.casters.length; i++) {
    const caster = plan.casters[i]
    caster.matrixWorld.copy(plan.counterparts[i].matrixWorld)
    plan.savedCasterFlags[i] = caster.castShadow
    caster.castShadow = true
  }
}

export function restoreLod1ShadowProxy(plan: Lod1ShadowProxyPlan): void {
  plan.level1.visible = plan.savedLevel1Visible
  plan.level2.visible = plan.savedLevel2Visible
  for (let i = 0; i < plan.casters.length; i++) plan.casters[i].castShadow = plan.savedCasterFlags[i]
}
