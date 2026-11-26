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

/**
 * Caches SkinnedMesh bone matrices in mesh-local space (`DetachedBindMode`) so
 * moving/rotating actors on throttled animation frames skip `Skeleton.update()`
 * and `boneTexture` GPU uploads unless bones or visible meshes actually changed.
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

  const markers: Array<() => void> = []

  for (const [skeleton, meshes] of bySkeleton) {
    if (!meshesShareBindTransform(meshes)) continue
    for (const mesh of meshes) {
      mesh.bindMode = THREE.DetachedBindMode
      mesh.bindMatrixInverse.copy(mesh.bindMatrix).invert()
      const origApplyBoneTransform = mesh.applyBoneTransform.bind(mesh)
      mesh.applyBoneTransform = (index: number, target: THREE.Vector3) => {
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
      const refMesh = meshes.find(mesh => mesh.visible) ?? meshes[0]
      if (!refMesh) {
        origUpdate()
        dirty = false
        return
      }
      if (Math.abs(refMesh.matrixWorld.determinant()) < 1e-12) {
        refMesh.updateWorldMatrix(true, false)
      }
      if (Math.abs(refMesh.matrixWorld.determinant()) < 1e-12) {
        origUpdate()
        dirty = false
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
    }

    markers.push(() => { dirty = true })
  }

  return {
    markDirty: () => {
      for (let i = 0; i < markers.length; i++) markers[i]()
    },
  }
}
