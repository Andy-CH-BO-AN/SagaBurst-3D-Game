import * as THREE from 'three'

/**
 * World-matrix reads that start from an ancestor whose `matrixWorld` is already current.
 *
 * Three's `getWorldPosition`/`getWorldQuaternion`/`localToWorld`/`worldToLocal` re-run
 * `updateWorldMatrix(true, false)` up to the scene root on every call, with no dirty check.
 * Pose code issues dozens of these per actor per frame while nothing above its rig root moves.
 *
 * Contract: the caller guarantees `anchor.matrixWorld` is current and that neither the anchor
 * nor any of its ancestors changed local transform since it was computed. Every node below the
 * anchor then runs exactly the per-node work of Three's walk (`updateMatrix` when auto-updating,
 * then `parent.matrixWorld × matrix`), top-down, so the resulting matrices are bit-identical.
 * A node outside the anchor's subtree falls back to Three's full walk.
 */
const chain: THREE.Object3D[] = []
const scratchPosition = new THREE.Vector3()
const scratchScale = new THREE.Vector3()
const scratchInverse = new THREE.Matrix4()

export function refreshWorldBelow(node: THREE.Object3D, anchor: THREE.Object3D): void {
  let count = 0
  let current: THREE.Object3D | null = node
  while (current !== null && current !== anchor) { chain[count++] = current; current = current.parent }
  if (current === null) {
    for (let i = 0; i < count; i++) chain[i] = undefined!
    node.updateWorldMatrix(true, false)
    return
  }
  for (let i = count - 1; i >= 0; i--) { chain[i].updateWorldMatrix(false, false); chain[i] = undefined! }
}

export function worldPositionBelow(node: THREE.Object3D, anchor: THREE.Object3D, target: THREE.Vector3): THREE.Vector3 {
  refreshWorldBelow(node, anchor)
  return target.setFromMatrixPosition(node.matrixWorld)
}

export function worldQuaternionBelow(node: THREE.Object3D, anchor: THREE.Object3D, target: THREE.Quaternion): THREE.Quaternion {
  refreshWorldBelow(node, anchor)
  return currentWorldQuaternion(node, target)
}

/** Decomposes an already-current `matrixWorld`, as `getWorldQuaternion` does after its refresh. */
export function currentWorldQuaternion(node: THREE.Object3D, target: THREE.Quaternion): THREE.Quaternion {
  node.matrixWorld.decompose(scratchPosition, target, scratchScale)
  return target
}

export function localToWorldBelow(node: THREE.Object3D, anchor: THREE.Object3D, vector: THREE.Vector3): THREE.Vector3 {
  refreshWorldBelow(node, anchor)
  return vector.applyMatrix4(node.matrixWorld)
}

export function worldToLocalBelow(node: THREE.Object3D, anchor: THREE.Object3D, vector: THREE.Vector3): THREE.Vector3 {
  refreshWorldBelow(node, anchor)
  return vector.applyMatrix4(scratchInverse.copy(node.matrixWorld).invert())
}

const visited: THREE.Object3D[] = []
const pending: THREE.Object3D[] = []
/**
 * Refreshes several nodes' ancestor chains as successive `updateWorldMatrix(true, false)` calls
 * would, but recomputes each shared ancestor once. Valid only while no transform in these chains
 * changes between the reads the caller replaces.
 */
export function refreshWorldChains(nodes: readonly THREE.Object3D[], count: number): void {
  let visitedCount = 0
  for (let i = 0; i < count; i++) {
    let pendingCount = 0
    let current: THREE.Object3D | null = nodes[i]
    while (current !== null && !isVisited(current, visitedCount)) { pending[pendingCount++] = current; current = current.parent }
    for (let j = pendingCount - 1; j >= 0; j--) {
      pending[j].updateWorldMatrix(false, false)
      visited[visitedCount++] = pending[j]
      pending[j] = undefined!
    }
  }
  for (let i = 0; i < visitedCount; i++) visited[i] = undefined!
}

function isVisited(node: THREE.Object3D, count: number): boolean {
  for (let i = 0; i < count; i++) if (visited[i] === node) return true
  return false
}
