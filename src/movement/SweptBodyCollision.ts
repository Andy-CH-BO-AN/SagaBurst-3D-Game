import type * as THREE from 'three'
import type { EntityCollisionBody } from '../world/Terrain'

/** Conservative cylinder vs moving oriented part. Project body extents onto each
 * part axis, including the relative sweep; unlike a world envelope this retains
 * the underside of an elevated/sloping board. Matrices may contain mesh scale. */
export function intersectsSweptPart(body: EntityCollisionBody, box: THREE.Box3,
  worldToLocal: THREE.Matrix4, travelZ: number): boolean {
  const e = worldToLocal.elements
  const x = body.position.x
  const y = body.position.y - body.bottomOffset + body.height / 2
  const z = body.position.z - travelZ / 2
  for (let axis = 0; axis < 3; axis++) {
    const center = e[axis] * x + e[axis + 4] * y + e[axis + 8] * z + e[axis + 12]
    const extent = body.radius * Math.hypot(e[axis], e[axis + 8])
      + body.height / 2 * Math.abs(e[axis + 4]) + Math.abs(travelZ * e[axis + 8]) / 2
    const min = axis === 0 ? box.min.x : axis === 1 ? box.min.y : box.min.z
    const max = axis === 0 ? box.max.x : axis === 1 ? box.max.y : box.max.z
    if (center + extent < min || center - extent > max) return false
  }
  return true
}
