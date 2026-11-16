import * as THREE from 'three'

/** Lightweight ground ring; each owner disposes only its own geometry and material. */
export class PickupRing {
  readonly mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  constructor(color: number) {
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.7, 12), new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0.5,
    }))
    this.mesh.rotation.x = -Math.PI / 2
  }
  setSelected(selected: boolean): void { this.mesh.material.opacity = selected ? 1 : 0.5 }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose() }
}
