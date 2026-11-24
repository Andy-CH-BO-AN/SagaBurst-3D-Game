import * as THREE from 'three'
import { DamageableObstacle, DAMAGEABLE_OBSTACLE_HP } from '../world/DamageableObstacle'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { NPC } from '../world/NPC'
import { SIEGE_RAMP_WHEEL, type MobileSiegeRampCarrier, type MobileSiegeRampRenderPort } from './MobileSiegeRampCarrier'
import type { MobileSiegeRampId } from './MobileSiegeRampPolicy'

/** What the facade needs from the render side; the production implementation is `MobileSiegeRampRenderer`. */
export interface MobileSiegeRampRender extends MobileSiegeRampRenderPort {
  readonly root: THREE.Object3D
  /** HP/hit owner covering the render's hit meshes; the carrier binds its collision volumes to it. */
  readonly damageable: DamageableObstacle
  dispose(): void
}

interface PartMesh {
  mesh: THREE.Mesh
  renderMatrix: THREE.Matrix4
}

/** Meshes, instanced timber and hit proxies that mirror the carrier's numeric transforms. */
export class MobileSiegeRampRenderer implements MobileSiegeRampRender {
  readonly root = new THREE.Group()
  readonly damageable: DamageableObstacle
  private readonly parts: PartMesh[] = []
  private readonly wheels: THREE.Mesh[] = []
  private readonly timber: THREE.InstancedMesh
  private readonly timberMatrix = new THREE.Matrix4()
  private readonly wood = new THREE.MeshStandardMaterial({ color: 0x795334, roughness: .9 })
  private readonly iron = new THREE.MeshStandardMaterial({ color: 0x343238, roughness: .7 })

  constructor(private readonly carrier: MobileSiegeRampCarrier<MobileSiegeRampId, NPC>, scene: THREE.Scene, faction: CharacterFaction) {
    this.root.name = carrier.assignment.id
    scene.add(this.root)
    this.root.position.copy(carrier.position)
    this.root.rotation.y = carrier.heading
    for (const part of carrier.parts) {
      const geometry = new THREE.BoxGeometry(part.size.x, part.size.y, part.size.z)
      geometry.computeBoundingBox()
      // Hidden proxies skip render warmup; prepare the first precise hit here.
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, this.wood)
      mesh.castShadow = true; mesh.receiveShadow = true
      // Three raycasts these original layer-0 targets independently of visibility.
      mesh.visible = false
      // The carrier composes this board's matrices once per update; the mesh only receives them.
      mesh.matrixAutoUpdate = false
      this.root.add(mesh)
      this.parts.push({ mesh, renderMatrix: new THREE.Matrix4() })
    }
    const { radius, height, radialSegments } = SIEGE_RAMP_WHEEL
    for (let i = 0; i < carrier.wheels.length; i++) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, radialSegments), this.iron)
      wheel.matrixAutoUpdate = false
      this.root.add(wheel); this.wheels.push(wheel)
    }
    // Render only: original part meshes retain their collision and hit ownership.
    this.timber = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.wood, this.parts.length)
    this.timber.castShadow = true; this.timber.receiveShadow = true
    this.timber.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.root.add(this.timber)
    this.damageable = new DamageableObstacle({ kind: 'siege_ramp', maxHp: DAMAGEABLE_OBSTACLE_HP.siege_ramp,
      root: this.root, hitMeshes: [...this.parts.map(p => p.mesh), ...this.wheels], ownerFaction: faction })
  }

  /** Copies the carrier's already-composed matrices onto the hit meshes; nothing is recomposed here. */
  syncGeometry(): void {
    this.root.position.copy(this.carrier.position)
    this.root.updateWorldMatrix(true, false)
    const parts = this.carrier.parts
    for (let i = 0; i < parts.length; i++) {
      const { mesh } = this.parts[i]
      mesh.matrix.copy(parts[i].local)
      mesh.matrixWorld.copy(parts[i].world)
    }
    const wheels = this.carrier.wheels
    for (let i = 0; i < this.wheels.length; i++) {
      this.wheels[i].matrix.copy(wheels[i].local)
      this.wheels[i].matrixWorld.copy(wheels[i].world)
    }
    this.updateTimberInstances()
  }

  hide(): void { this.root.visible = false }

  private updateTimberInstances(): void {
    const initial = this.timber.boundingSphere === null
    let changed = false
    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i]
      // Parts are direct root children. Their original box dimensions precede
      // the authored local transform, including its nonuniform scale/rotation.
      this.timberMatrix.copy(this.carrier.parts[i].local).scale(this.carrier.parts[i].size)
      if (!initial && this.timberMatrix.equals(part.renderMatrix)) continue
      part.renderMatrix.copy(this.timberMatrix)
      this.timber.setMatrixAt(i, this.timberMatrix)
      changed = true
    }
    // Root translation alone needs no instance upload or bounds rebuild.
    if (!changed) return
    this.timber.instanceMatrix.needsUpdate = true
    this.timber.computeBoundingBox()
    this.timber.computeBoundingSphere()
  }

  dispose(): void {
    this.root.removeFromParent()
    for (const part of this.parts) part.mesh.geometry.dispose()
    for (const wheel of this.wheels) wheel.geometry.dispose()
    this.timber.dispose()
    this.timber.geometry.dispose()
    this.wood.dispose(); this.iron.dispose()
  }
}
