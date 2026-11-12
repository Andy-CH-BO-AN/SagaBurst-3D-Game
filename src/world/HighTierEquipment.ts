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

export interface HighTierEquipmentServiceOptions {
  loader?: (id: ByzantineEquipmentId, signal: AbortSignal) => Promise<GLTF>
  onNotice?: (name: string) => void
}

export class HighTierEquipmentService {
  private readonly activeDemands = new Map<ByzantineEquipmentId, Set<unknown>>()
  private readonly templates = new Map<string, GLTF>()
  private bowBody: THREE.Group | undefined
  private pendingPreload: Promise<void> | undefined
  private preloadGeneration = 0
  readonly byzantineEquipment: OnDemandAssets<ByzantineEquipmentId, GLTF>
  private readonly showNotice: (name: string) => void

  constructor(options?: HighTierEquipmentServiceOptions) {
    this.showNotice = options?.onNotice ?? showEquipmentLoadNotice
    const defaultLoader = async (id: ByzantineEquipmentId, signal: AbortSignal) => {
      const url = publicAssetUrl(BYZANTINE_EQUIPMENT_ASSETS[id])
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
      const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), THREE.LoaderUtils.extractUrlBase(url))
      gltf.scene.traverse(object => {
        if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
      })
      return gltf
    }

    this.byzantineEquipment = new OnDemandAssets<ByzantineEquipmentId, GLTF>(
      options?.loader ?? defaultLoader,
      {
        timeoutMs: BYZANTINE_EQUIPMENT_WAIT_MS,
        retryDelayMs: BYZANTINE_EQUIPMENT_RETRY_MS,
        onFailure: id => {
          if (this.isEquipmentDemanded(id)) {
            this.showNotice(WEAPONS[id]?.name ?? ARMORS[id]?.name ?? id)
          }
        },
      }
    )
  }

  isEquipmentDemanded(id: unknown): boolean {
    return isByzantineEquipmentId(id) && Boolean(this.activeDemands.get(id)?.size)
  }

  acquireEquipmentDemand(id: unknown, owner: unknown): void {
    if (!isByzantineEquipmentId(id) || !owner) return
    let owners = this.activeDemands.get(id)
    if (!owners) {
      owners = new Set()
      this.activeDemands.set(id, owners)
    }
    const wasDemanded = owners.size > 0
    owners.add(owner)
    this.byzantineEquipment.poll(id)
    if (!wasDemanded && this.byzantineEquipment.status(id) === 'failed') {
      this.showNotice(WEAPONS[id]?.name ?? ARMORS[id]?.name ?? id)
    }
  }

  releaseEquipmentDemand(id: unknown, owner: unknown): void {
    if (!isByzantineEquipmentId(id) || !owner) return
    const owners = this.activeDemands.get(id)
    if (owners) {
      owners.delete(owner)
      if (owners.size === 0) this.activeDemands.delete(id)
    }
  }

  releaseAllEquipmentDemands(owner: unknown): void {
    if (!owner) return
    for (const [id, owners] of this.activeDemands) {
      owners.delete(owner)
      if (owners.size === 0) this.activeDemands.delete(id)
    }
  }

  createByzantineEquipment(id: ByzantineEquipmentId, owner?: unknown): THREE.Group | undefined {
    if (owner) this.acquireEquipmentDemand(id, owner)
    return this.byzantineEquipment.get(id)?.scene.clone(true)
  }

  requestByzantineEquipment(id: ByzantineEquipmentId, owner?: unknown): Promise<THREE.Group> {
    if (owner) this.acquireEquipmentDemand(id, owner)
    return this.byzantineEquipment.load(id).then(gltf => gltf.scene.clone(true))
  }

  byzantineEquipmentStatus(id: ByzantineEquipmentId): OnDemandAssetStatus {
    return this.byzantineEquipment.status(id)
  }

  isEquipmentReady(id: string): boolean {
    if (!isByzantineEquipmentId(id)) return true
    return this.byzantineEquipment.get(id) !== undefined
  }

  isEquipmentUsable(id: string, owner?: unknown): boolean {
    if (isByzantineEquipmentId(id)) {
      if (owner) this.acquireEquipmentDemand(id, owner)
      return this.byzantineEquipment.get(id) !== undefined || (this.isEquipmentDemanded(id) && this.byzantineEquipment.poll(id) !== undefined)
    }
    return true
  }

  resolveEquipmentSlot<T extends string>(selected: T | null | undefined, held: T | null, owner?: unknown): T | null {
    if (!selected) return null
    if (owner && isByzantineEquipmentId(selected)) this.acquireEquipmentDemand(selected, owner)
    return this.isEquipmentUsable(selected) ? selected : held
  }

  retryEquipmentNow(id: string, owner?: unknown): void {
    if (isByzantineEquipmentId(id)) {
      if (owner) this.acquireEquipmentDemand(id, owner)
      void this.byzantineEquipment.load(id).catch(() => {})
    }
  }

  async prepareByzantineEquipment(ids: Iterable<unknown>): Promise<'ready' | 'failed' | 'timed-out'> {
    const needed = [...new Set(ids)].filter(isByzantineEquipmentId)
    const results = await Promise.allSettled(needed.map(id => this.byzantineEquipment.load(id)))
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (!failures.length) return 'ready'
    return failures.some(reason => reason instanceof AssetLoadTimeout) ? 'timed-out' : 'failed'
  }

  preloadHighTierEquipment(loaderInstance?: { loadAsync(url: string): Promise<GLTF> }): Promise<void> {
    // Warming: Byzantine equipment is kicked off in background to populate cache without blocking scene-entry
    for (const id of Object.keys(BYZANTINE_EQUIPMENT_ASSETS) as ByzantineEquipmentId[]) {
      void this.byzantineEquipment.load(id).catch(error => {
        console.warn(`[HighTierEquipment] Non-blocking preload failure for ${id}:`, error)
      })
    }
    if (this.pendingPreload) return this.pendingPreload

    const runGeneration = ++this.preloadGeneration
    const stagingTemplates = new Map<string, GLTF>()
    let stagingBowBody: THREE.Group | undefined

    const loader = loaderInstance ?? new GLTFLoader()

    this.pendingPreload = Promise.all(
      [...new Set(Object.values(HIGH_TIER_WEAPON_ASSETS))].map(async path => {
        const gltf = await loader.loadAsync(publicAssetUrl(path))
        if (runGeneration !== this.preloadGeneration) return
        gltf.scene.traverse(object => {
          if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
        })
        stagingTemplates.set(path, gltf)
        if (path === HIGH_TIER_WEAPON_ASSETS.bow_t5) {
          const body = new THREE.Group()
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
            body.add(new THREE.Mesh(geometry, object.material))
          })
          stagingBowBody = body
        }
      })
    ).then(() => {
      if (runGeneration === this.preloadGeneration) {
        this.templates.clear()
        for (const [key, value] of stagingTemplates) {
          this.templates.set(key, value)
        }
        this.bowBody = stagingBowBody
      }
    }).catch(error => {
      if (runGeneration === this.preloadGeneration) {
        this.pendingPreload = undefined
      }
      throw error
    })

    return this.pendingPreload
  }

  template(id: keyof typeof HIGH_TIER_WEAPON_ASSETS): GLTF {
    const asset = this.templates.get(HIGH_TIER_WEAPON_ASSETS[id])
    if (!asset) throw new Error(`High tier equipment was not preloaded: ${id}`)
    return asset
  }

  hasTemplate(id: keyof typeof HIGH_TIER_WEAPON_ASSETS): boolean {
    return this.templates.has(HIGH_TIER_WEAPON_ASSETS[id])
  }

  createT4Polearm(): THREE.Group {
    return this.template('spear_t4').scene.clone(true)
  }

  createT5Melee(id: 'sword_t5' | 'axe_t5' | 'spear_t5'): THREE.Group {
    return this.template(id).scene.clone(true)
  }

  createT5Shield(): THREE.Group {
    return this.template('commander_shield_t5').scene.clone(true)
  }

  createFactionShield(id: 'roman_officer_shield_t4' | 'viking_berserker_shield_t5'): THREE.Group {
    return this.template(id).scene.clone(true)
  }

  createT5BowBody(): THREE.Group {
    if (!this.bowBody) throw new Error('T5 bow was not preloaded')
    return this.bowBody.clone(true)
  }

  createT5Bow() {
    const asset = this.template('bow_t5')
    const model = clone(asset.scene)
    const clip = asset.animations[0]
    const mixer = clip ? new THREE.AnimationMixer(model) : undefined
    const action = clip && mixer?.clipAction(clip)
    action?.setLoop(THREE.LoopOnce, 1).play()
    const topTip = new THREE.Vector3(0, .85, .21), bottomTip = new THREE.Vector3(0, -.85, .21)
    const meshes: THREE.SkinnedMesh[] = []
    model.traverse(object => { if (object instanceof THREE.SkinnedMesh) meshes.push(object) })
    model.updateMatrixWorld(true)
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
        if (mixer && clip) mixer.setTime(THREE.MathUtils.clamp(ratio, 0, 1) * clip.duration / 2)
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
        model.removeFromParent()
        mixer?.stopAllAction()
        mixer?.uncacheRoot(model)
        for (const skeleton of new Set(meshes.map(mesh => mesh.skeleton))) skeleton.dispose()
      },
    }
  }

  dispose(): void {
    this.preloadGeneration++
    this.pendingPreload = undefined
    this.bowBody = undefined
    this.templates.clear()
    this.activeDemands.clear()
    this.byzantineEquipment.dispose()
  }
}

export let defaultHighTierEquipmentService = new HighTierEquipmentService()

export function resetHighTierEquipmentForTest(): void {
  defaultHighTierEquipmentService.dispose()
  defaultHighTierEquipmentService = new HighTierEquipmentService()
}

export function setHighTierEquipmentServiceForTest(service: HighTierEquipmentService | null): void {
  defaultHighTierEquipmentService = service ?? new HighTierEquipmentService()
}

export const isEquipmentDemanded = (id: unknown): boolean => defaultHighTierEquipmentService.isEquipmentDemanded(id)
export const acquireEquipmentDemand = (id: unknown, owner: unknown): void => defaultHighTierEquipmentService.acquireEquipmentDemand(id, owner)
export const releaseEquipmentDemand = (id: unknown, owner: unknown): void => defaultHighTierEquipmentService.releaseEquipmentDemand(id, owner)
export const releaseAllEquipmentDemands = (owner: unknown): void => defaultHighTierEquipmentService.releaseAllEquipmentDemands(owner)
export const createByzantineEquipment = (id: ByzantineEquipmentId, owner?: unknown): THREE.Group | undefined => defaultHighTierEquipmentService.createByzantineEquipment(id, owner)
export const requestByzantineEquipment = (id: ByzantineEquipmentId, owner?: unknown): Promise<THREE.Group> => defaultHighTierEquipmentService.requestByzantineEquipment(id, owner)
export const byzantineEquipmentStatus = (id: ByzantineEquipmentId): OnDemandAssetStatus => defaultHighTierEquipmentService.byzantineEquipmentStatus(id)
export const isEquipmentReady = (id: string): boolean => defaultHighTierEquipmentService.isEquipmentReady(id)
export const isEquipmentUsable = (id: string, owner?: unknown): boolean => defaultHighTierEquipmentService.isEquipmentUsable(id, owner)
export const resolveEquipmentSlot = <T extends string>(selected: T | null | undefined, held: T | null, owner?: unknown): T | null => defaultHighTierEquipmentService.resolveEquipmentSlot(selected, held, owner)
export const retryEquipmentNow = (id: string, owner?: unknown): void => defaultHighTierEquipmentService.retryEquipmentNow(id, owner)
export const prepareByzantineEquipment = (ids: Iterable<unknown>): Promise<'ready' | 'failed' | 'timed-out'> => defaultHighTierEquipmentService.prepareByzantineEquipment(ids)
export const preloadHighTierEquipment = (loader?: any): Promise<void> => defaultHighTierEquipmentService.preloadHighTierEquipment(loader)
export const createT4Polearm = (): THREE.Group => defaultHighTierEquipmentService.createT4Polearm()
export const createT5Melee = (id: 'sword_t5' | 'axe_t5' | 'spear_t5'): THREE.Group => defaultHighTierEquipmentService.createT5Melee(id)
export const createT5Shield = (): THREE.Group => defaultHighTierEquipmentService.createT5Shield()
export const createFactionShield = (id: 'roman_officer_shield_t4' | 'viking_berserker_shield_t5'): THREE.Group => defaultHighTierEquipmentService.createFactionShield(id)
export const createT5BowBody = (): THREE.Group => defaultHighTierEquipmentService.createT5BowBody()
export const createT5Bow = () => defaultHighTierEquipmentService.createT5Bow()
