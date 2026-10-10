import type * as THREE from 'three'
import { LocalBoxCollider } from './ShieldBlocking'

/** Separate anatomical boxes share one first-contact query, leaving intervening air empty. */
export class CompoundLocalBoxCollider extends LocalBoxCollider {
  constructor(proxy: THREE.Object3D, box: THREE.Box3, private readonly parts: readonly LocalBoxCollider[]) {
    super(proxy, box)
  }

  override prepare(): void {
    super.prepare()
    for (const part of this.parts) part.prepare()
  }

  override preparedTime(from: THREE.Vector3, to: THREE.Vector3): number {
    let time = super.preparedTime(from, to)
    for (const part of this.parts) time = Math.min(time, part.preparedTime(from, to))
    return time
  }
}
