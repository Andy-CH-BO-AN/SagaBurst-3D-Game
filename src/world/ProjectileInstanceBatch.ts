import * as THREE from 'three'

/** One drawable piece of a projectile, positioned relative to the projectile origin. */
export interface ProjectileInstancePart {
  readonly geometry: THREE.BufferGeometry
  readonly material: THREE.Material
  readonly local: THREE.Matrix4
  /** Only this part of a player-fired projectile casts a shadow. */
  readonly castsPlayerShadow?: boolean
}

/** Anything with a pose; the batch reads it at render time, so callers may move it freely. */
export interface ProjectileInstanceSource {
  readonly mesh: THREE.Object3D
  instanceSlot: number
}

const INITIAL_CAPACITY = 128
const POSE_STRIDE = 7
const UNIT_SCALE = new THREE.Vector3(1, 1, 1)
const sourceMatrix = new THREE.Matrix4()
const partMatrix = new THREE.Matrix4()

/**
 * All live projectiles of one visual (arrow or pilum, player or NPC) drawn as one
 * InstancedMesh per part instead of a Group of Meshes per projectile.
 */
class ProjectileInstanceSet {
  private readonly sources: ProjectileInstanceSource[] = []
  private meshes: THREE.InstancedMesh[] = []
  private pose = new Float64Array(INITIAL_CAPACITY * POSE_STRIDE)
  private capacity = 0

  constructor(
    private readonly root: THREE.Group,
    private readonly parts: readonly ProjectileInstancePart[],
    private readonly playerFired: boolean,
  ) { this.allocate(INITIAL_CAPACITY) }

  get size(): number { return this.sources.length }

  add(source: ProjectileInstanceSource): void {
    if (this.sources.length >= this.capacity) this.allocate(this.capacity * 2)
    source.instanceSlot = this.sources.length
    this.sources.push(source)
    this.pose[source.instanceSlot * POSE_STRIDE] = Number.NaN
  }

  remove(source: ProjectileInstanceSource): void {
    const slot = source.instanceSlot
    if (slot < 0 || this.sources[slot] !== source) return
    const last = this.sources.pop()!
    source.instanceSlot = -1
    if (last !== source) {
      this.sources[slot] = last
      last.instanceSlot = slot
      this.pose[slot * POSE_STRIDE] = Number.NaN
    }
    for (const mesh of this.meshes) {
      mesh.count = this.sources.length
      mesh.visible = this.sources.length > 0
    }
  }

  /** Writes only instances whose pose changed since the last sync. */
  sync(): void {
    const { sources, pose, meshes, parts } = this
    let changed = false
    for (let i = 0; i < sources.length; i++) {
      const { position: p, quaternion: q } = sources[i].mesh
      const o = i * POSE_STRIDE
      if (pose[o] === p.x && pose[o + 1] === p.y && pose[o + 2] === p.z
        && pose[o + 3] === q.x && pose[o + 4] === q.y && pose[o + 5] === q.z && pose[o + 6] === q.w) continue
      pose[o] = p.x; pose[o + 1] = p.y; pose[o + 2] = p.z
      pose[o + 3] = q.x; pose[o + 4] = q.y; pose[o + 5] = q.z; pose[o + 6] = q.w
      sourceMatrix.compose(p, q, UNIT_SCALE)
      for (let part = 0; part < parts.length; part++) {
        partMatrix.multiplyMatrices(sourceMatrix, parts[part].local)
        meshes[part].setMatrixAt(i, partMatrix)
      }
      changed = true
    }
    const visible = sources.length > 0
    for (const mesh of meshes) {
      mesh.count = sources.length
      mesh.visible = visible
    }
    if (changed) for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.sources.length = 0
    for (const mesh of this.meshes) {
      this.root.remove(mesh)
      mesh.dispose()
    }
    this.meshes.length = 0
  }

  private allocate(capacity: number): void {
    const previous = this.meshes
    this.meshes = this.parts.map((part, index) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity)
      mesh.name = 'projectile-instances'
      mesh.frustumCulled = false
      mesh.castShadow = this.playerFired && part.castsPlayerShadow === true
      mesh.receiveShadow = false
      mesh.matrixAutoUpdate = false
      mesh.userData.ignoreAimRaycast = true
      mesh.count = this.sources.length
      mesh.visible = this.sources.length > 0
      const old = previous[index]
      if (old) mesh.instanceMatrix.array.set(old.instanceMatrix.array)
      this.root.add(mesh)
      return mesh
    })
    for (const old of previous) { this.root.remove(old); old.dispose() }
    const pose = new Float64Array(capacity * POSE_STRIDE)
    pose.fill(Number.NaN)
    this.pose = pose
    this.capacity = capacity
  }
}

/** Scene child that flushes projectile poses just before the renderer projects the scene. */
class ProjectileInstanceRoot extends THREE.Group {
  readonly sets: ProjectileInstanceSet[] = []
  override updateMatrixWorld(force?: boolean): void {
    for (const set of this.sets) set.sync()
    super.updateMatrixWorld(force)
  }
}

export type ProjectileInstanceKind = 'arrow' | 'pilum'

export class ProjectileInstanceBatch {
  private static readonly byScene = new WeakMap<THREE.Scene, ProjectileInstanceBatch>()

  static for(scene: THREE.Scene, definitions: Readonly<Record<ProjectileInstanceKind, readonly ProjectileInstancePart[]>>): ProjectileInstanceBatch {
    let batch = this.byScene.get(scene)
    if (!batch) this.byScene.set(scene, batch = new ProjectileInstanceBatch(definitions))
    // A scene that was cleared keeps working: the root is simply re-attached.
    if (batch.root.parent !== scene) scene.add(batch.root)
    return batch
  }

  static dispose(scene: THREE.Scene): void {
    const batch = this.byScene.get(scene)
    if (!batch) return
    this.byScene.delete(scene)
    batch.root.removeFromParent()
    for (const set of batch.root.sets) set.dispose()
  }

  readonly root = new ProjectileInstanceRoot()
  private readonly sets: Record<`${ProjectileInstanceKind}:${'player' | 'npc'}`, ProjectileInstanceSet>

  private constructor(definitions: Readonly<Record<ProjectileInstanceKind, readonly ProjectileInstancePart[]>>) {
    this.root.name = 'projectile-instance-batch'
    this.root.userData.ignoreAimRaycast = true
    this.root.userData.projectileInstanceRoot = true
    const make = (kind: ProjectileInstanceKind, playerFired: boolean) => {
      const set = new ProjectileInstanceSet(this.root, definitions[kind], playerFired)
      this.root.sets.push(set)
      return set
    }
    this.sets = {
      'arrow:player': make('arrow', true), 'arrow:npc': make('arrow', false),
      'pilum:player': make('pilum', true), 'pilum:npc': make('pilum', false),
    }
  }

  add(kind: ProjectileInstanceKind, playerFired: boolean, source: ProjectileInstanceSource): void {
    this.setFor(kind, playerFired).add(source)
  }

  remove(kind: ProjectileInstanceKind, playerFired: boolean, source: ProjectileInstanceSource): void {
    this.setFor(kind, playerFired).remove(source)
  }

  count(): number { return this.root.sets.reduce((sum, set) => sum + set.size, 0) }

  private setFor(kind: ProjectileInstanceKind, playerFired: boolean): ProjectileInstanceSet {
    return this.sets[`${kind}:${playerFired ? 'player' : 'npc'}`]
  }
}
