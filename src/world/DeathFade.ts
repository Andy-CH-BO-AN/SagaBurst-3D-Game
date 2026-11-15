import * as THREE from 'three'

export const DEATH_DESPAWN_DELAY_SECONDS = 3.0

/**
 * A finished corpse is hidden but stays in its scene, and Three still walks hidden
 * subtrees in scene.updateMatrixWorld (a skeleton per corpse, every frame). Skip
 * the root's world-matrix pass while it is hidden and `asleep()`; explicit
 * updateWorldMatrix/getWorldPosition queries still refresh their own chain, and a
 * root shown again (reset/restore) is updated by the next scene pass.
 */
export function skipHiddenCorpseMatrices(root: THREE.Object3D, asleep: () => boolean): void {
  const update = root.updateMatrixWorld
  root.updateMatrixWorld = function (this: THREE.Object3D, force?: boolean): void {
    if (!this.visible && asleep()) return
    update.call(this, force)
  }
}

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

  get completed(): boolean { return this.finished }

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
