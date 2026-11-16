import * as THREE from 'three'

/** Headroom over the template rest pose for animated limbs, weapons and seated riders. */
export const SKINNED_TEMPLATE_BOUND_MARGIN = 1.2

/**
 * Three.js computes a null SkinnedMesh bound lazily on the first frustum test
 * by CPU-skinning every vertex. Per-instance clones would each pay that the
 * first time a LOD level becomes visible, so compute it once on the shared
 * template; SkeletonUtils clones copy the sphere. Idempotent.
 */
export function primeSkinnedTemplateBounds(root: THREE.Object3D): void {
  let matricesCurrent = false
  root.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh) || !object.skeleton || object.boundingSphere) return
    if (!matricesCurrent) {
      root.updateMatrixWorld(true)
      matricesCurrent = true
    }
    const mesh: THREE.SkinnedMesh = object
    mesh.computeBoundingSphere()
    mesh.boundingSphere!.radius *= SKINNED_TEMPLATE_BOUND_MARGIN
  })
}
