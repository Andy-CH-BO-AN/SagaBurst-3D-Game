import * as THREE from 'three'
import { Mount } from '../world/Mount'
import { getTerrainHeight } from '../world/Terrain'
import { createTrainingGroundPlan } from './TrainingGroundPlan'
import { TrainingDummy } from './TrainingDummy'

/** Owns only training props and mounts. Game remains the movement/combat owner. */
export class TrainingGround {
  readonly plan = createTrainingGroundPlan()
  readonly dummies: TrainingDummy[] = []
  readonly mounts: Mount[] = []
  readonly markers = new THREE.Group()
  readonly labels: { text: string; position: THREE.Vector3 }[] = []
  private disposed = false

  constructor(scene: THREE.Scene) {
    scene.add(this.markers)
    try {
      for (const placement of this.plan.dummies) {
        const dummy = new TrainingDummy(scene, placement)
        this.dummies.push(dummy)
        this.labels.push({ text: `${placement.distance}m${placement.distance === 0 ? ' · 近戰' : ''}`, position: dummy.labelPosition })
      }
      for (const placement of this.plan.mounts) {
        const mount = new Mount(scene, placement.type, placement.x, placement.z)
        this.mounts.push(mount)
        mount.resetForScene(placement.x, placement.z, placement.yaw)
        mount.visualHold = true
        this.labels.push({ text: mount.displayName, position: mount.group.position.clone().add(new THREE.Vector3(0, 4, 0)) })
        this.addMarker(placement.x, placement.z, 3, 0x9bbbcc)
      }
      const { firingPoint, referencePoint, weaponArea, runwayStart } = this.plan
      this.addMarker(firingPoint.x, firingPoint.z, .8, 0xe4c86d)
      this.addMarker(weaponArea.x, weaponArea.z, 2, 0xe4c86d)
      this.labels.push({ text: '武器區 · Tab 裝備', position: new THREE.Vector3(weaponArea.x, getTerrainHeight(weaponArea.x, weaponArea.z) + 2, weaponArea.z) })
      this.labels.push({ text: '射擊點 · 距離以 0m 假人中心為準', position: new THREE.Vector3(firingPoint.x, getTerrainHeight(firingPoint.x, firingPoint.z) + .2, firingPoint.z) })
      this.labels.push({ text: '衝撞跑道 · 125m', position: new THREE.Vector3(runwayStart.x, getTerrainHeight(runwayStart.x, runwayStart.z) + 2, runwayStart.z) })
      for (let z = referencePoint.z + 5; z <= runwayStart.z; z += 5) {
        this.addMarker(referencePoint.x - 3, z, .18, 0xe4c86d)
        this.addMarker(referencePoint.x + 3, z, .18, 0xe4c86d)
      }
    } catch (error) { this.dispose(); throw error }
  }

  private addMarker(x: number, z: number, radius: number, color: number): void {
    const marker = new THREE.Mesh(new THREE.RingGeometry(radius * .85, radius, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))
    marker.rotation.x = -Math.PI / 2
    // Conform the marker to the unmodified battlefield's procedural ground.
    const positions = marker.geometry.attributes.position
    for (let i = 0; i < positions.count; i++) positions.setZ(i, getTerrainHeight(x + positions.getX(i), z - positions.getY(i)) + .04)
    marker.position.set(x, 0, z)
    this.markers.add(marker)
  }

  resetMounts(): void {
    this.mounts.forEach((mount, index) => {
      const placement = this.plan.mounts[index]
      mount.resetForScene(placement.x, placement.z, placement.yaw)
      mount.visualHold = true
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const dummy of this.dummies) dummy.dispose()
    for (const mount of this.mounts) mount.dispose()
    this.markers.traverse(node => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose()
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose()
      }
    })
    this.markers.removeFromParent()
    this.dummies.length = this.mounts.length = this.labels.length = 0
  }
}
