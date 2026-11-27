import type { Camera, Object3D, LOD, Mesh, SkinnedMesh } from 'three'
import { skipMatrixWorldWhenHidden } from './DeathFade'
import { Object3D as ThreeObject3D } from 'three'
import { LOD2_BATCHED_SOURCE_LAYER } from './Lod2EquipmentBatcher'

const MESH_ON_BEFORE_RENDER = ThreeObject3D.prototype.onBeforeRender

export type EquipmentVisualLOD = 0 | 1 | 2
export type EquipmentKind = 'sword' | 'shield' | 'bow' | 'lance' | 'pilum'
export type EquipmentShadowPolicy = -1 | 0 | 1

/** Builder annotation only: shared Player/pickup builders remain full detail. */
export function equipmentDetail<T extends Object3D>(object: T, lastVisibleLOD: 0 | 1): T {
  object.userData.equipmentLastVisibleLOD = lastVisibleLOD
  return object
}

/**
 * Annotation defining up to which EquipmentVisualLOD this mesh should cast shadows.
 * -1: Never cast shadows (LOD0, LOD1, LOD2 all false)
 *  0: Cast shadow only at LOD0 (LOD1 and LOD2 false)
 *  1: Cast shadow at LOD0 and LOD1 (LOD2 false)
 */
export function equipmentShadowUntil<T extends Object3D>(object: T, lastShadowLOD: EquipmentShadowPolicy): T {
  object.userData.equipmentLastShadowLOD = lastShadowLOD
  return object
}

/** Proxy mesh shown only at LOD2 (> 30m) on NPCs; stays hidden on Player/pickups and at LOD0/LOD1. */
export function equipmentLod2Proxy<T extends Object3D>(object: T): T {
  object.userData.equipmentLod2Only = true
  object.visible = false
  return object
}

/** Rigid, opaque, single-material leaf meshes; instancing them keeps their exact look. */
function isLod1BatchCandidate(mesh: Mesh): boolean {
  const material = mesh.material
  return !(mesh as SkinnedMesh).isSkinnedMesh && !Array.isArray(material) && mesh.children.length === 0
    && !material.transparent && !(mesh.morphTargetInfluences?.length)
    && mesh.onBeforeRender === MESH_ON_BEFORE_RENDER
}

/** Owns static detail visibility and NPC mesh shadows, never gameplay/dynamic visibility. */
export class EquipmentVisualLODController {
  private readonly entries = new Map<EquipmentKind, {
    root: Object3D
    details: Array<{ object: Object3D; lastLOD: number }>
    lod2Only: Object3D[]
    batchedMeshes: Mesh[]
    lod1Meshes: Mesh[]
    shadows: Array<{ mesh: Mesh; lastShadowLOD: EquipmentShadowPolicy; originalCastShadow: boolean }>
  }>()
  // Re-registering an existing mesh at LOD2 must not capture our temporary false.
  private readonly originalShadows = new WeakMap<Mesh, boolean>()
  private readonly batchedFlat: Mesh[] = []
  private readonly batchEntriesFlat: Array<{ readonly root: Object3D; readonly batchedMeshes: readonly Mesh[] }> = []
  private readonly lod1Flat: Mesh[] = []
  private readonly lod1Masks: number[] = []
  private lod1LayersMoved = false
  private batchLayerEnabled = false
  private initialLodSynced = false
  private followedLod: LOD | null = null
  private level: EquipmentVisualLOD = 0

  get currentLevel(): EquipmentVisualLOD { return this.level }
  get lod2BatchedMeshes(): readonly Mesh[] { return this.batchedFlat }
  get lod2BatchEntries(): ReadonlyArray<{ readonly root: Object3D; readonly batchedMeshes: readonly Mesh[] }> {
    return this.batchEntriesFlat
  }
  /** Rigid single-material leaf meshes that the scene batcher may draw instanced at LOD1. */
  get lod1BatchMeshes(): readonly Mesh[] { return this.lod1Flat }

  /** Batcher-owned: move one LOD1 candidate to the batched source layer, or back to its own mask. */
  setLod1MeshBatched(index: number, batched: boolean): void {
    const mesh = this.lod1Flat[index]
    if (batched) {
      mesh.layers.set(LOD2_BATCHED_SOURCE_LAYER)
      this.lod1LayersMoved = true
    } else {
      mesh.layers.mask = this.lod1Masks[index]
    }
  }

  /** Returns every LOD1 candidate to its original layers (cheap no-op when none moved). */
  restoreLod1Layers(): void {
    if (!this.lod1LayersMoved) return
    this.lod1LayersMoved = false
    for (let i = 0; i < this.lod1Flat.length; i++) this.lod1Flat[i].layers.mask = this.lod1Masks[i]
  }

  enableBatchLayer(): void {
    if (this.batchLayerEnabled) return
    this.batchLayerEnabled = true
    for (let i = 0; i < this.batchedFlat.length; i++) {
      this.batchedFlat[i].layers.set(LOD2_BATCHED_SOURCE_LAYER)
    }
  }

  syncInitialCameraLOD(camera: Camera): void {
    if (this.initialLodSynced) return
    this.initialLodSynced = true
    this.followedLod?.update(camera)
  }

  private rebuildBatchedFlat(): void {
    this.restoreLod1Layers()
    this.batchedFlat.length = 0
    this.batchEntriesFlat.length = 0
    this.lod1Flat.length = 0
    this.lod1Masks.length = 0
    for (const { lod1Meshes } of this.entries.values()) {
      for (const mesh of lod1Meshes) { this.lod1Flat.push(mesh); this.lod1Masks.push(mesh.layers.mask) }
    }
    for (const { root, batchedMeshes } of this.entries.values()) {
      if (batchedMeshes.length === 0) continue
      this.batchEntriesFlat.push({ root, batchedMeshes })
      for (let i = 0; i < batchedMeshes.length; i++) {
        const mesh = batchedMeshes[i]
        if (this.batchLayerEnabled) mesh.layers.set(LOD2_BATCHED_SOURCE_LAYER)
        this.batchedFlat.push(mesh)
      }
    }
  }

  /** Called at construction / equipment rebuild, never during steady-state updates. */
  register(kind: EquipmentKind, root: Object3D): void {
    const details: Array<{ object: Object3D; lastLOD: number }> = []
    const lod2Only: Object3D[] = []
    const batchedMeshes: Mesh[] = []
    const lod1Meshes: Mesh[] = []
    const shadows: Array<{ mesh: Mesh; lastShadowLOD: EquipmentShadowPolicy; originalCastShadow: boolean }> = []
    root.traverse(object => {
      if (object.userData.equipmentLod2Only === true) {
        lod2Only.push(object)
        object.visible = this.level === 2
        if (typeof (object as { updateMatrixWorld?: unknown }).updateMatrixWorld === 'function') {
          skipMatrixWorldWhenHidden(object)
        }
        const candidate = object as Mesh
        if (candidate.isMesh && !(candidate as SkinnedMesh).isSkinnedMesh
          && !Array.isArray(candidate.material) && candidate.children.length === 0) {
          batchedMeshes.push(candidate)
        }
      }
      const lastLOD = object.userData.equipmentLastVisibleLOD
      if (lastLOD === 0 || lastLOD === 1) {
        details.push({ object, lastLOD })
        object.visible = this.level <= lastLOD
        if (typeof (object as { updateMatrixWorld?: unknown }).updateMatrixWorld === 'function') {
          skipMatrixWorldWhenHidden(object)
        }
      }
      const mesh = object as Mesh
      if (mesh.isMesh && object.userData.equipmentLod2Only !== true && isLod1BatchCandidate(mesh)) lod1Meshes.push(mesh)
      if (mesh.isMesh) {
        if (!this.originalShadows.has(mesh)) this.originalShadows.set(mesh, mesh.castShadow)
        const originalCastShadow = this.originalShadows.get(mesh)!

        // Resolve shadow policy from mesh or nearest ancestor inside root
        let current: Object3D | null = object
        let policy: EquipmentShadowPolicy | undefined = undefined
        while (current && current !== root.parent) {
          if (current.userData.equipmentLastShadowLOD !== undefined) {
            policy = current.userData.equipmentLastShadowLOD
            break
          }
          current = current.parent
        }
        const lastShadowLOD: EquipmentShadowPolicy = policy !== undefined ? policy : 1

        shadows.push({ mesh, lastShadowLOD, originalCastShadow })
        mesh.castShadow = this.level !== 2 && this.level <= lastShadowLOD && originalCastShadow
      }
    })
    this.entries.set(kind, { root, details, lod2Only, batchedMeshes, lod1Meshes, shadows })
    this.rebuildBatchedFlat()
  }

  setLOD(level: EquipmentVisualLOD): void {
    if (level === this.level) return
    this.level = level
    for (const { details, lod2Only, shadows } of this.entries.values()) {
      for (const { object, lastLOD } of details) object.visible = level <= lastLOD
      for (const object of lod2Only) object.visible = level === 2
      for (const { mesh, lastShadowLOD, originalCastShadow } of shadows) {
        mesh.castShadow = level !== 2 && level <= lastShadowLOD && originalCastShadow
      }
    }
  }

  /** NPC instance only. Preserve Three's thresholds, zoom, and existing animation hook. */
  followHumanoid(lod: LOD): void {
    this.followedLod = lod
    const update = lod.update.bind(lod)
    lod.update = camera => {
      update(camera)
      this.setLOD(lod.getCurrentLevel() as EquipmentVisualLOD)
    }
    this.setLOD(lod.getCurrentLevel() as EquipmentVisualLOD)
  }

  /** On-demand DEV census; callers must not invoke it in the frame loop. */
  forEachRoot(visit: (kind: EquipmentKind, root: Object3D) => void): void {
    for (const [kind, { root }] of this.entries) visit(kind, root)
  }
}
