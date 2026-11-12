import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { publicAssetUrl } from '../assets/publicAssetUrl'
import { AssetLoadTimeout, OnDemandAssets, type OnDemandAssetStatus } from '../assets/OnDemandAssets'
import { ARMORS } from '../rpg/ArmorDatabase'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { showEquipmentLoadNotice } from '../ui/EquipmentLoadNotice'
import { DEFAULT_BOW_GRIP_PROFILE } from './BowAttachmentContract'

export const HIGH_TIER_WEAPON_ASSETS = {
  spear_t4: 'models/weapons/high-tier/spear.glb',
  bow_t5: 'models/weapons/high-tier/bow.glb',
  sword_t5: 'models/weapons/t5/sword.glb',
  axe_t5: 'models/weapons/t5/axe.glb',
  spear_t5: 'models/weapons/t5/lance.glb',
  commander_shield_t5: 'models/weapons/t5/shield.glb',
  roman_officer_shield_t4: 'models/weapons/faction-shields/roman-officer.glb',
  viking_berserker_shield_t5: 'models/weapons/faction-shields/viking-berserker.glb',
} as const
/** Elite-only equipment: never part of the shared preload, so ordinary scenes neither wait on it nor fail with it.
 * The Centurion Aquila and Viking Dragonward shields share this on-demand contract (optional, purchased equipment). */
export const BYZANTINE_EQUIPMENT_ASSETS = {
  byzantine_standard_lance_t5: 'models/weapons/byzantine/standard-lance.glb',
  byzantine_eagle_shield_t5: 'models/weapons/faction-shields/byzantine-eagle.glb',
  centurion_aquila_shield_t4: 'models/weapons/faction-shields/centurion-aquila.glb',
  viking_dragonward_shield_t4: 'models/weapons/faction-shields/viking-dragonward.glb',
} as const
export type ByzantineEquipmentId = keyof typeof BYZANTINE_EQUIPMENT_ASSETS
export const isByzantineEquipmentId = (id: unknown): id is ByzantineEquipmentId => typeof id === 'string' && id in BYZANTINE_EQUIPMENT_ASSETS
/** Longest one load may stay pending before it counts as failed and the next attempt starts a new request. */
export const BYZANTINE_EQUIPMENT_WAIT_MS = 20000
/** Gap between automatic retries while an actor still has one of these items selected. */
export const BYZANTINE_EQUIPMENT_RETRY_MS = 15000

const byzantineEquipment = new OnDemandAssets<ByzantineEquipmentId, GLTF>(async (id, signal) => {
  // Fetched here, not by GLTFLoader: its FileLoader queues a repeat URL behind a hung request, so a retry would hang too.
  const url = publicAssetUrl(BYZANTINE_EQUIPMENT_ASSETS[id])
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), THREE.LoaderUtils.extractUrlBase(url))
  gltf.scene.traverse(object => {
    if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
  })
  return gltf
}, {
  timeoutMs: BYZANTINE_EQUIPMENT_WAIT_MS,
  retryDelayMs: BYZANTINE_EQUIPMENT_RETRY_MS,
  onFailure: id => showEquipmentLoadNotice(WEAPONS[id]?.name ?? ARMORS[id]?.name ?? id),
})

/** Instances own transforms only. Undefined until loaded: callers must not substitute another model. */
export const createByzantineEquipment = (id: ByzantineEquipmentId): THREE.Group | undefined => byzantineEquipment.get(id)?.scene.clone(true)
export const requestByzantineEquipment = (id: ByzantineEquipmentId): Promise<THREE.Group> => byzantineEquipment.load(id).then(gltf => gltf.scene.clone(true))
export const byzantineEquipmentStatus = (id: ByzantineEquipmentId): OnDemandAssetStatus => byzantineEquipment.status(id)

/** An item whose model is not loaded has no combat effect yet; asking keeps a paced load going. */
export function isEquipmentUsable(id: string): boolean {
  return !isByzantineEquipmentId(id) || byzantineEquipment.get(id) !== undefined || byzantineEquipment.poll(id) !== undefined
}

/** What a slot really holds: the selection once usable, otherwise whatever it already held. Never an invented fallback. */
export function resolveEquipmentSlot<T extends string>(selected: T | null | undefined, held: T | null): T | null {
  if (!selected) return null
  return isEquipmentUsable(selected) ? selected : held
}

/** An explicit re-equip retries at once rather than waiting for the paced retry. */
export function retryEquipmentNow(id: string): void {
  if (isByzantineEquipmentId(id)) void byzantineEquipment.load(id).catch(() => {})
}

/** For a scene that knows it will use these items: waits before actors are built, but always lets the scene open. */
export async function prepareByzantineEquipment(ids: Iterable<unknown>): Promise<'ready' | 'failed' | 'timed-out'> {
  const needed = [...new Set(ids)].filter(isByzantineEquipmentId)
  const results = await Promise.allSettled(needed.map(id => byzantineEquipment.load(id)))
  const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  if (!failures.length) return 'ready'
  return failures.some(reason => reason instanceof AssetLoadTimeout) ? 'timed-out' : 'failed'
}

const templates = new Map<string, GLTF>()
let bowBody: THREE.Group | undefined
let pending: Promise<void> | undefined
export function preloadHighTierEquipment(): Promise<void> {
  // Warming: Byzantine equipment is kicked off in background to populate cache without blocking scene-entry
  for (const id of Object.keys(BYZANTINE_EQUIPMENT_ASSETS) as ByzantineEquipmentId[]) {
    void byzantineEquipment.load(id).catch(error => {
      console.warn(`[HighTierEquipment] Non-blocking preload failure for ${id}:`, error)
    })
  }
  pending ??= Promise.all(
    [...new Set(Object.values(HIGH_TIER_WEAPON_ASSETS))].map(async path => {
      const gltf = await new GLTFLoader().loadAsync(publicAssetUrl(path))
      gltf.scene.traverse(object => {
        if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
      })
      templates.set(path, gltf)
      if (path === HIGH_TIER_WEAPON_ASSETS.bow_t5) {
        try {
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
        } catch {
          // Logic-only test environment guards prevent THREE.Group/Mesh construction
        }
      }
    })
  ).then(() => undefined).catch(error => { pending = undefined; throw error })
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
/** Original 1.20m Laurelguard body; no rescale, material rewrite or per-owner resources. */
export function createT5Shield(): THREE.Group {
  return template('commander_shield_t5').scene.clone(true)
}
export function createFactionShield(id: 'roman_officer_shield_t4' | 'viking_berserker_shield_t5'): THREE.Group {
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
