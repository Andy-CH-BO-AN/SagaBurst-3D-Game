import * as THREE from 'three'
import type { DamageReceiver } from '../combat/DamageReceiver'
import type { CombatTargetRef } from '../combat/CombatAttribution'
import { getTerrainHeight } from '../world/Terrain'
import type { TrainingDummyPlacement } from './TrainingGroundPlan'

/** Static physical target: no NPC, AI, HP/death state or per-frame simulation. */
export class TrainingDummy implements DamageReceiver {
  readonly group = new THREE.Group()
  readonly isMounted = false
  readonly damageTarget: CombatTargetRef
  readonly labelPosition = new THREE.Vector3()
  private disposed = false
  get combatPosition() { return this.group.position }

  constructor(scene: THREE.Scene, readonly placement: TrainingDummyPlacement) {
    this.damageTarget = { targetType: 'training', targetId: `training:${placement.distance}`, name: `${placement.distance}m Dummy · 假人` }
    this.group.name = this.damageTarget.targetId
    this.group.position.set(placement.x, getTerrainHeight(placement.x, placement.z), placement.z)
    const straw = new THREE.MeshStandardMaterial({ color: 0xbba069, roughness: .96 })
    const wood = new THREE.MeshStandardMaterial({ color: 0x59402d, roughness: .95 })
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.y = y; mesh.castShadow = true; this.group.add(mesh)
      return mesh
    }
    add(new THREE.CylinderGeometry(.075, .1, 1.55, 8), wood, .775)
    add(new THREE.BoxGeometry(.6, .75, .4), straw, 1.08)
    add(new THREE.SphereGeometry(.24, 12, 8), straw, 1.67)
    const arms = add(new THREE.CylinderGeometry(.085, .085, 1.15, 8), wood, 1.25)
    arms.rotation.z = Math.PI / 2
    add(new THREE.CylinderGeometry(.42, .45, .12, 12), wood, .06)
    this.labelPosition.copy(this.group.position).y += 2.25
    scene.add(this.group)
  }

  receiveDamage(amount: number): number {
    return !this.disposed && Number.isFinite(amount) ? Math.max(0, amount) : 0
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const materials = new Set<THREE.Material>()
    this.group.traverse(node => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose()
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material)
      }
    })
    for (const material of materials) material.dispose()
    this.group.removeFromParent()
  }
}
