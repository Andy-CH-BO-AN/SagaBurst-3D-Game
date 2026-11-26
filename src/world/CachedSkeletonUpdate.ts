import * as THREE from 'three'

export interface CachedSkeletonController {
  markDirty(): void
}

const IDENTITY_MATRIX = new THREE.Matrix4()
const INV_MESH_WORLD = new THREE.Matrix4()
const TO_BIND_SPACE = new THREE.Matrix4()
const LOCAL_BONE = new THREE.Matrix4()
const OFFSET_MATRIX = new THREE.Matrix4()
const APPLY_BONE_INV = new THREE.Matrix4()

function sameMatrixElements(a: THREE.Matrix4, b: THREE.Matrix4, epsilon = 1e-4): boolean {
  const ae = a.elements
  const be = b.elements
  for (let i = 0; i < 16; i++) {
    if (Math.abs(ae[i] - be[i]) > epsilon) return false
  }
  return true
}

function meshesShareBindTransform(meshes: readonly THREE.SkinnedMesh[]): boolean {
  if (meshes.length <= 1) return true
  const baseInv = new THREE.Matrix4()
  const baseBind = new THREE.Matrix4()
  const otherInv = new THREE.Matrix4()
  const otherBind = new THREE.Matrix4()
  const first = meshes[0]
  if (Math.abs(first.matrixWorld.determinant()) < 1e-12) return false
  baseInv.copy(first.matrixWorld).invert()
  baseBind.multiplyMatrices(first.bindMatrix, baseInv)
  for (let i = 1; i < meshes.length; i++) {
    const mesh = meshes[i]
    if (Math.abs(mesh.matrixWorld.determinant()) < 1e-12) return false
    otherInv.copy(mesh.matrixWorld).invert()
    otherBind.multiplyMatrices(mesh.bindMatrix, otherInv)
    if (!sameMatrixElements(baseBind, otherBind)) return false
  }
  return true
}

interface BoneSubtreeEntry {
  bone: THREE.Object3D
  orig: (force?: boolean) => void
  updatedSinceDirty: boolean
}

function collectBoneOnlyRoots(root: THREE.Object3D): THREE.Object3D[] {
  const roots: THREE.Object3D[] = []
  const isEmptySocketPlaceholder = (object: THREE.Object3D): boolean =>
    object.children.length === 0
    && !(object instanceof THREE.Mesh || object instanceof THREE.Sprite || object instanceof THREE.Light || object instanceof THREE.Line || object instanceof THREE.Points)
  const isBoneOnly = (object: THREE.Object3D): boolean => {
    if ((object as THREE.Bone).isBone !== true) {
      return isEmptySocketPlaceholder(object)
    }
    for (let i = 0; i < object.children.length; i++) {
      if (!isBoneOnly(object.children[i])) return false
    }
    return true
  }
  const visit = (object: THREE.Object3D): void => {
    if ((object as THREE.Bone).isBone === true && isBoneOnly(object)) {
      roots.push(object)
      return
    }
    for (let i = 0; i < object.children.length; i++) visit(object.children[i])
  }
  visit(root)
  return roots
}

/**
 * Caches SkinnedMesh bone matrices in mesh-local space (`DetachedBindMode`) so
 * moving/rotating actors on throttled animation frames skip `Skeleton.update()`,
 * `boneTexture` GPU uploads, and clean bone-only `updateMatrixWorld` subtree walks
 * unless bones or visible meshes actually changed.
 */
export function installCachedSkeletonUpdate(root: THREE.Object3D): CachedSkeletonController {
  root.updateMatrixWorld(true)
  const bySkeleton = new Map<THREE.Skeleton, THREE.SkinnedMesh[]>()
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh) || !object.skeleton) return
    let list = bySkeleton.get(object.skeleton)
    if (!list) {
      list = []
      bySkeleton.set(object.skeleton, list)
    }
    list.push(object)
  })

  const skeletonStates: Array<{ isDirty: () => boolean; markDirty: () => void }> = []
  const boneEntries: BoneSubtreeEntry[] = []
  let anyDirty = true
  let appliedWorldValid = false
  const lastAppliedMeshWorld = new THREE.Matrix4()

  const refreshStaleBoneOnlyRoots = (forceAll = false): void => {
    for (let i = 0; i < boneEntries.length; i++) {
      const entry = boneEntries[i]
      if (!forceAll && entry.updatedSinceDirty) continue
      entry.bone.parent?.updateWorldMatrix(true, false)
      entry.orig.call(entry.bone, true)
      entry.updatedSinceDirty = true
    }
  }

  for (const [skeleton, meshes] of bySkeleton) {
    if (!meshesShareBindTransform(meshes)) continue
    for (const mesh of meshes) {
      mesh.bindMode = THREE.DetachedBindMode
      mesh.bindMatrixInverse.copy(mesh.bindMatrix).invert()
      const origApplyBoneTransform = mesh.applyBoneTransform.bind(mesh)
      mesh.applyBoneTransform = (index: number, target: THREE.Vector3) => {
        if (!anyDirty && boneEntries.length > 0 && (!appliedWorldValid || !sameMatrixElements(mesh.matrixWorld, lastAppliedMeshWorld, 1e-6))) {
          mesh.updateWorldMatrix(true, false)
          refreshStaleBoneOnlyRoots(true)
          lastAppliedMeshWorld.copy(mesh.matrixWorld)
          appliedWorldValid = true
        }
        const saved = mesh.bindMatrixInverse
        mesh.bindMatrixInverse = APPLY_BONE_INV.copy(mesh.matrixWorld).invert()
        try {
          return origApplyBoneTransform(index, target)
        } finally {
          mesh.bindMatrixInverse = saved
        }
      }
    }
    let dirty = true
    let lastBoneTexture: THREE.DataTexture | null = skeleton.boneTexture
    const origUpdate = skeleton.update.bind(skeleton)

    skeleton.update = () => {
      if (!dirty) {
        if (skeleton.boneTexture !== null && skeleton.boneTexture !== lastBoneTexture) {
          lastBoneTexture = skeleton.boneTexture
          skeleton.boneTexture.needsUpdate = true
        }
        return
      }
      refreshStaleBoneOnlyRoots(false)
      const refMesh = meshes.find(mesh => mesh.visible) ?? meshes[0]
      if (!refMesh) {
        origUpdate()
        dirty = false
        anyDirty = skeletonStates.some(state => state.isDirty())
        return
      }
      if (Math.abs(refMesh.matrixWorld.determinant()) < 1e-12) {
        refMesh.updateWorldMatrix(true, false)
      }
      if (Math.abs(refMesh.matrixWorld.determinant()) < 1e-12) {
        origUpdate()
        dirty = false
        anyDirty = skeletonStates.some(state => state.isDirty())
        return
      }
      INV_MESH_WORLD.copy(refMesh.matrixWorld).invert()
      TO_BIND_SPACE.multiplyMatrices(refMesh.bindMatrix, INV_MESH_WORLD)
      const bones = skeleton.bones
      const boneInverses = skeleton.boneInverses
      const boneMatrices = skeleton.boneMatrices
      for (let i = 0, il = bones.length; i < il; i++) {
        const boneMatrix = bones[i] ? bones[i].matrixWorld : IDENTITY_MATRIX
        LOCAL_BONE.multiplyMatrices(TO_BIND_SPACE, boneMatrix)
        OFFSET_MATRIX.multiplyMatrices(LOCAL_BONE, boneInverses[i])
        OFFSET_MATRIX.toArray(boneMatrices, i * 16)
      }
      if (skeleton.boneTexture !== null) {
        lastBoneTexture = skeleton.boneTexture
        skeleton.boneTexture.needsUpdate = true
      }
      dirty = false
      anyDirty = skeletonStates.some(state => state.isDirty())
    }

    skeletonStates.push({
      isDirty: () => dirty,
      markDirty: () => { dirty = true },
    })
  }

  if (bySkeleton.size > 0 && skeletonStates.length === bySkeleton.size) {
    for (const bone of collectBoneOnlyRoots(root)) {
      const orig = bone.updateMatrixWorld
      const entry: BoneSubtreeEntry = { bone, orig, updatedSinceDirty: true }
      boneEntries.push(entry)
      bone.updateMatrixWorld = function cachedBoneUpdateMatrixWorld(force?: boolean) {
        if (!anyDirty) return
        entry.orig.call(this, force)
        entry.updatedSinceDirty = true
      }
    }
  }

  return {
    markDirty: () => {
      for (let i = 0; i < skeletonStates.length; i++) skeletonStates[i].markDirty()
      anyDirty = true
      appliedWorldValid = false
      for (let i = 0; i < boneEntries.length; i++) boneEntries[i].updatedSinceDirty = false
    },
  }
}
