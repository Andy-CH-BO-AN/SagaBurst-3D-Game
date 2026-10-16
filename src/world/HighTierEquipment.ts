import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { publicAssetUrl } from '../assets/publicAssetUrl'
import { DEFAULT_BOW_GRIP_PROFILE } from './BowAttachmentContract'

export const HIGH_TIER_WEAPON_ASSETS = {
  spear_t4: 'models/weapons/high-tier/spear.glb',
  bow_t5: 'models/weapons/high-tier/bow.glb',
  sword_t5: 'models/weapons/t5/sword.glb',
  axe_t5: 'models/weapons/t5/axe.glb',
  spear_t5: 'models/weapons/t5/lance.glb',
} as const
const templates = new Map<string, GLTF>()
let bowBody: THREE.Group | undefined
let pending: Promise<void> | undefined
export function preloadHighTierEquipment(): Promise<void> {
  pending ??= Promise.all([...new Set(Object.values(HIGH_TIER_WEAPON_ASSETS))].map(async path => {
    const gltf = await new GLTFLoader().loadAsync(publicAssetUrl(path))
    gltf.scene.traverse(object => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
    })
    templates.set(path, gltf)
    if (path === HIGH_TIER_WEAPON_ASSETS.bow_t5) {
      bowBody = new THREE.Group()
      gltf.scene.updateMatrixWorld(true)
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        const geometry = object.geometry.clone()
        const point = new THREE.Vector3()
        if (object instanceof THREE.SkinnedMesh) {
          const positions = geometry.attributes.position
          for (let i = 0; i < positions.count; i++) {
            object.getVertexPosition(i, point)
            positions.setXYZ(i, point.x, point.y, point.z)
          }
        }
        geometry.applyMatrix4(object.matrixWorld)
        bowBody!.add(new THREE.Mesh(geometry, object.material))
      })
    }
  })).then(() => undefined).catch(error => { pending = undefined; throw error })
  return pending
}
function template(id: keyof typeof HIGH_TIER_WEAPON_ASSETS): GLTF {
  const asset = templates.get(HIGH_TIER_WEAPON_ASSETS[id])
  if (!asset) throw new Error(`High tier equipment was not preloaded: ${id}`)
  return asset
}
export function createT4Polearm(): THREE.Group {
  return template('spear_t4').scene.clone(true)
}
/** Instances own transforms only; immutable geometry/materials stay in the preload cache. */
export function createT5Melee(id: 'sword_t5' | 'axe_t5' | 'spear_t5'): THREE.Group {
  return template(id).scene.clone(true)
}
/** Static drop/preview body uses cached bind geometry without allocating a skeleton. */
export function createT5BowBody(): THREE.Group {
  if (!bowBody) throw new Error('T5 bow was not preloaded')
  return bowBody.clone(true)
}

/** Shared geometry/material/clips, per-owner bones and a mixer created only on equip. */
export function createT5Bow() {
  const asset = template('bow_t5')
  const model = clone(asset.scene)
  const clip = asset.animations[0]
  const mixer = clip ? new THREE.AnimationMixer(model) : undefined
  const action = clip && mixer?.clipAction(clip)
  action?.setLoop(THREE.LoopOnce, 1).play()
  const topTip = new THREE.Vector3(0, .85, .21), bottomTip = new THREE.Vector3(0, -.85, .21)
  const meshes: THREE.SkinnedMesh[] = []
  model.traverse(object => { if (object instanceof THREE.SkinnedMesh) meshes.push(object) })
  model.updateMatrixWorld(true)
  // Cache only the two endpoint vertices; animation updates never traverse the mesh graph.
  const endpoints: { mesh: THREE.SkinnedMesh; index: number; high: boolean }[] = []
  const point = new THREE.Vector3()
  for (const mesh of meshes) {
    let high = -Infinity, low = Infinity, highIndex = 0, lowIndex = 0
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld)
      if (point.y > high) { high = point.y; highIndex = i }
      if (point.y < low) { low = point.y; lowIndex = i }
    }
    endpoints.push({ mesh, index: highIndex, high: true }, { mesh, index: lowIndex, high: false })
  }
  let previousRatio = -1
  return {
    model, topTip, bottomTip, profile: { ...DEFAULT_BOW_GRIP_PROFILE, id: 'bow_t5' },
    sampleDraw(ratio: number) {
      if (ratio === previousRatio) return
      previousRatio = ratio
      // Source take draws then releases. Its first half is the complete draw.
      if (mixer && clip) mixer.setTime(THREE.MathUtils.clamp(ratio, 0, 1) * clip.duration / 2)
      // Refresh ancestors first, then use updateMatrixWorld so attached
      // SkinnedMeshes also refresh bindMatrixInverse before CPU skin sampling.
      // updateWorldMatrix alone leaves the previous render's inverse in place.
      model.updateWorldMatrix(true, false)
      model.updateMatrixWorld(true)
      for (const endpoint of endpoints) {
        endpoint.mesh.getVertexPosition(endpoint.index, point)
        endpoint.mesh.localToWorld(point)
        model.parent?.worldToLocal(point)
        ;(endpoint.high ? topTip : bottomTip).copy(point)
      }
    },
    dispose() {
      // Detach before the actor's humanoid cleanup traverses its own skeletons.
      model.removeFromParent()
      mixer?.stopAllAction()
      mixer?.uncacheRoot(model)
      for (const skeleton of new Set(meshes.map(mesh => mesh.skeleton))) skeleton.dispose()
    },
  }
}
