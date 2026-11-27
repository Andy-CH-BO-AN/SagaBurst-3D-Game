import * as THREE from 'three'
import type { EquipmentVisualLODController } from './EquipmentVisualLODController'

export const LOD2_BATCHED_SOURCE_LAYER = 31
const INITIAL_POOL_CAPACITY = 64

export interface Lod2EquipmentBatchActor {
  readonly group: THREE.Object3D
  readonly characterVisualGroup?: { readonly visible: boolean }
  readonly equipmentVisualLOD: EquipmentVisualLODController
}

interface InstancedBatchPool {
  readonly key: string
  readonly batcher: Lod2EquipmentBatcher
  readonly geometry: THREE.BufferGeometry
  readonly material: THREE.Material
  mesh: THREE.InstancedMesh
  capacity: number
  count: number
  disposed: boolean
}

/** LOD1 pools keep the source shadow flags and build their InstancedMesh only once shared. */
interface Lod1BatchPool {
  readonly key: string
  readonly batcher: Lod2EquipmentBatcher
  readonly geometry: THREE.BufferGeometry
  readonly material: THREE.Material
  readonly castShadow: boolean
  readonly receiveShadow: boolean
  mesh: THREE.InstancedMesh | null
  capacity: number
  /** Visible LOD1 candidates this frame; a pool batches only when at least two share it. */
  pending: number
  count: number
  idleFrames: number
  disposed: boolean
}

/** Unused LOD1 pools (equipment churn, disposed per-instance geometry) are released after this. */
const LOD1_POOL_IDLE_FRAMES = 300

/**
 * Batches visible NPC LOD2 (> 30m) rigid single-material equipment proxy meshes
 * across the scene into shared InstancedMesh draw calls without mutating source
 * `.visible` flags or affecting <= 30m LOD0/LOD1 visuals and shadows.
 *
 * LOD1 rigid equipment (shields, lances, swords, bows) is batched the same way, keeping
 * each source mesh's castShadow/receiveShadow in its pool: the instanced draw is
 * identical in the main and shadow passes. Only geometry+material pairs shared by at
 * least two visible meshes in the frame are batched; LOD0 equipment is never touched.
 */
export class Lod2EquipmentBatcher {
  readonly root = new THREE.Group()
  private readonly pools = new Map<string, InstancedBatchPool>()
  private readonly lod1Pools = new Map<string, Lod1BatchPool>()
  private readonly lod1Controllers: EquipmentVisualLODController[] = []
  private readonly lod1Indices: number[] = []
  private readonly lod1Candidates: Lod1BatchPool[] = []
  private lod1Enabled = true

  /** DEV A/B only: production keeps LOD1 batching on. */
  setLod1Enabled(enabled: boolean): boolean {
    this.lod1Enabled = Boolean(enabled)
    return this.lod1Enabled
  }

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'lod2-equipment-batcher'
    this.root.userData.lod2EquipmentBatchRoot = true
    this.scene.add(this.root)
  }

  private getOrCreatePool(proxy: THREE.Mesh): InstancedBatchPool {
    const cached = proxy.userData._lod2Pool as InstancedBatchPool | undefined
    if (cached && !cached.disposed && cached.batcher === this) return cached
    const geometry = proxy.geometry
    const material = proxy.material as THREE.Material
    const key = `${geometry.uuid}:${material.uuid}`
    let pool = this.pools.get(key)
    if (!pool) {
      const mesh = this.buildInstancedMesh(geometry, material, INITIAL_POOL_CAPACITY)
      this.root.add(mesh)
      pool = { key, batcher: this, geometry, material, mesh, capacity: INITIAL_POOL_CAPACITY, count: 0, disposed: false }
      this.pools.set(key, pool)
    }
    proxy.userData._lod2Pool = pool
    return pool
  }

  private getOrCreateLod1Pool(source: THREE.Mesh): Lod1BatchPool {
    const cached = source.userData._lod1Pool as Lod1BatchPool | undefined
    if (cached && !cached.disposed && cached.batcher === this && cached.geometry === source.geometry
      && cached.material === source.material && cached.castShadow === source.castShadow
      && cached.receiveShadow === source.receiveShadow) return cached
    const geometry = source.geometry
    const material = source.material as THREE.Material
    const key = `${geometry.uuid}:${material.uuid}:${source.castShadow ? 1 : 0}${source.receiveShadow ? 1 : 0}`
    let pool = this.lod1Pools.get(key)
    if (!pool) {
      pool = {
        key, batcher: this, geometry, material, castShadow: source.castShadow, receiveShadow: source.receiveShadow,
        mesh: null, capacity: 0, pending: 0, count: 0, idleFrames: 0, disposed: false,
      }
      this.lod1Pools.set(key, pool)
    }
    source.userData._lod1Pool = pool
    return pool
  }

  private ensureLod1Capacity(pool: Lod1BatchPool, needed: number): THREE.InstancedMesh {
    if (pool.mesh && pool.capacity >= needed) return pool.mesh
    let capacity = Math.max(INITIAL_POOL_CAPACITY, pool.capacity)
    while (capacity < needed) capacity *= 2
    const mesh = this.buildInstancedMesh(pool.geometry, pool.material, capacity, pool.castShadow, pool.receiveShadow)
    mesh.name = `lod1-equipment-batch-${pool.geometry.name || 'part'}`
    if (pool.mesh) {
      this.root.remove(pool.mesh)
      pool.mesh.dispose()
    }
    this.root.add(mesh)
    pool.mesh = mesh
    pool.capacity = capacity
    return mesh
  }

  private releaseLod1Pool(pool: Lod1BatchPool): void {
    pool.disposed = true
    if (pool.mesh) {
      this.root.remove(pool.mesh)
      pool.mesh.dispose()
      pool.mesh = null
    }
    this.lod1Pools.delete(pool.key)
  }

  private buildInstancedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    castShadow = false,
    receiveShadow = true,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity)
    mesh.name = `lod2-equipment-batch-${geometry.name || 'part'}`
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.castShadow = castShadow
    mesh.receiveShadow = receiveShadow
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.visible = false
    return mesh
  }

  private growPool(pool: InstancedBatchPool): void {
    const nextCapacity = pool.capacity * 2
    const nextMesh = this.buildInstancedMesh(pool.geometry, pool.material, nextCapacity)
    nextMesh.instanceMatrix.array.set(pool.mesh.instanceMatrix.array)
    this.root.remove(pool.mesh)
    pool.mesh.dispose()
    this.root.add(nextMesh)
    pool.mesh = nextMesh
    pool.capacity = nextCapacity
  }

  syncActors(camera: THREE.Camera, actors: readonly Lod2EquipmentBatchActor[]): void {
    if (this.scene.matrixWorldAutoUpdate) this.scene.updateMatrixWorld()
    if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld()

    for (const pool of this.pools.values()) {
      pool.count = 0
    }
    for (const pool of this.lod1Pools.values()) {
      pool.pending = 0
      pool.count = 0
    }
    this.lod1Controllers.length = 0
    this.lod1Indices.length = 0
    this.lod1Candidates.length = 0

    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i]
      if (!actor.group.visible || actor.group.parent === null || actor.characterVisualGroup?.visible === false) {
        actor.equipmentVisualLOD.restoreLod1Layers()
        continue
      }
      const controller = actor.equipmentVisualLOD
      controller.enableBatchLayer()
      controller.syncInitialCameraLOD(camera)
      if (controller.currentLevel === 1 && this.lod1Enabled) {
        this.collectLod1(controller, actor.group)
        continue
      }
      controller.restoreLod1Layers()
      if (controller.currentLevel !== 2) continue
      const entries = controller.lod2BatchEntries
      for (let e = 0; e < entries.length; e++) {
        const entry = entries[e]
        const pivotRoot = entry.root
        if (!pivotRoot.visible || (pivotRoot.parent !== null && !pivotRoot.parent.visible)) continue
        const proxies = entry.batchedMeshes
        for (let j = 0; j < proxies.length; j++) {
          const proxy = proxies[j]
          if (!proxy.visible || (proxy.parent !== null && !proxy.parent.visible)) continue
          const pool = this.getOrCreatePool(proxy)
          if (pool.count >= pool.capacity) this.growPool(pool)
          proxy.matrixWorld.toArray(pool.mesh.instanceMatrix.array, pool.count * 16)
          pool.count += 1
        }
      }
    }

    for (const pool of this.pools.values()) {
      pool.mesh.count = pool.count
      pool.mesh.visible = pool.count > 0
      if (pool.count > 0) pool.mesh.instanceMatrix.needsUpdate = true
    }
    this.flushLod1()
  }

  /** Candidates whose whole parent chain up to the actor root is visible this frame. */
  private collectLod1(controller: EquipmentVisualLODController, actorRoot: THREE.Object3D): void {
    const meshes = controller.lod1BatchMeshes
    for (let index = 0; index < meshes.length; index++) {
      const mesh = meshes[index]
      let node: THREE.Object3D | null = mesh
      while (node !== null && node !== actorRoot && node.visible) node = node.parent
      if (node !== actorRoot) {
        // Hidden, or no longer carried by this actor: never leave it on the batched layer.
        controller.setLod1MeshBatched(index, false)
        continue
      }
      const pool = this.getOrCreateLod1Pool(mesh)
      pool.pending++
      this.lod1Controllers.push(controller)
      this.lod1Indices.push(index)
      this.lod1Candidates.push(pool)
    }
  }

  private flushLod1(): void {
    for (let c = 0; c < this.lod1Candidates.length; c++) {
      const pool = this.lod1Candidates[c]
      const controller = this.lod1Controllers[c]
      const index = this.lod1Indices[c]
      if (pool.pending < 2) {
        controller.setLod1MeshBatched(index, false)
        continue
      }
      const mesh = this.ensureLod1Capacity(pool, pool.pending)
      controller.lod1BatchMeshes[index].matrixWorld.toArray(mesh.instanceMatrix.array, pool.count * 16)
      pool.count += 1
      controller.setLod1MeshBatched(index, true)
    }
    for (const pool of this.lod1Pools.values()) {
      pool.idleFrames = pool.pending === 0 ? pool.idleFrames + 1 : 0
      if (pool.idleFrames > LOD1_POOL_IDLE_FRAMES) {
        this.releaseLod1Pool(pool)
        continue
      }
      if (!pool.mesh) continue
      pool.mesh.count = pool.count
      pool.mesh.visible = pool.count > 0
      if (pool.count > 0) pool.mesh.instanceMatrix.needsUpdate = true
    }
  }

  renderScene(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    actors: readonly Lod2EquipmentBatchActor[],
  ): void {
    this.syncActors(camera, actors)
    const prevAuto = this.scene.matrixWorldAutoUpdate
    this.scene.matrixWorldAutoUpdate = false
    try {
      renderer.render(this.scene, camera)
    } finally {
      this.scene.matrixWorldAutoUpdate = prevAuto
    }
  }

  dispose(): void {
    for (const pool of this.pools.values()) {
      pool.disposed = true
      this.root.remove(pool.mesh)
      pool.mesh.dispose()
    }
    this.pools.clear()
    for (const pool of [...this.lod1Pools.values()]) this.releaseLod1Pool(pool)
    this.root.removeFromParent()
  }
}
