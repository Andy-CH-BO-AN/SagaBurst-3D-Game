import * as THREE from 'three'

const keepEulerStale = (): void => {}

/**
 * Animation, pose overlays and IK write bone quaternions tens of thousands of
 * times per frame, and Three re-derives every bone's Euler `.rotation` on each
 * write (rotation-matrix build plus asin/atan2). Rigs here are driven through
 * quaternions only, so instance bones stop that quaternion→Euler sync.
 *
 * Contract: never read a bone's `.rotation`; use `.quaternion`. Writing a whole
 * Euler (`rotation.set(x, y, z)`, as setRigRotation does) still updates the
 * quaternion. Single-axis writes such as `bone.rotation.x = a` would mix stale
 * axes and are not allowed on these bones.
 */
export function stopBoneEulerSync(root: THREE.Object3D): void {
  root.traverse(object => {
    if ((object as THREE.Bone).isBone) object.quaternion._onChange(keepEulerStale)
  })
}
