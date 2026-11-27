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

/**
 * Batches visible NPC LOD2 (> 30m) rigid single-material equipment proxy meshes
 * across the scene into shared InstancedMesh draw calls without mutating source
 * `.visible` flags or affecting <= 30m LOD0/LOD1 visuals and shadows.
 */
export class Lod2EquipmentBatcher {
  readonly root = new THREE.Group()
  private readonly pools = new Map<string, InstancedBatchPool>()

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

  private buildInstancedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity)
    mesh.name = `lod2-equipment-batch-${geometry.name || 'part'}`
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.castShadow = false
    mesh.receiveShadow = true
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

    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i]
      if (!actor.group.visible || actor.group.parent === null || actor.characterVisualGroup?.visible === false) continue
      const controller = actor.equipmentVisualLOD
      controller.enableBatchLayer()
      controller.syncInitialCameraLOD(camera)
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
    this.root.removeFromParent()
  }
}
