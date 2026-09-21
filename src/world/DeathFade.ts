import * as THREE from 'three'

export const DEATH_DESPAWN_DELAY_SECONDS = 3.0

/**
 * Keeps a dead actor visible for a fixed delay, then hides the whole actor root.
 *
 * There is intentionally no fade/material/shader work here. Weapons and shields
 * disappear with the actor because they are children of the same root hierarchy.
 */
export class DeathFadeController {
  private elapsed = 0
  private active = false
  private finished = false

  start(root: THREE.Object3D): void {
    this.elapsed = 0
    this.active = true
    this.finished = false
    root.visible = true
  }

  update(root: THREE.Object3D, dt: number): boolean {
    if (!this.active || this.finished) return this.finished

    this.elapsed += Math.max(0, dt)
    if (this.elapsed >= DEATH_DESPAWN_DELAY_SECONDS) {
      root.visible = false
      this.finished = true
    }

    return this.finished
  }

  reset(root: THREE.Object3D): void {
    this.elapsed = 0
    this.active = false
    this.finished = false
    root.visible = true
  }
}
