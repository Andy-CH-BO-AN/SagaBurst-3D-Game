import { Quaternion, Vector3 } from 'three'

export interface PoseTransform {
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
}

const identity = new Quaternion()

/** Fixed local offsets, applied before equipment layers. No dynamic source/target slerp. */
export class InertialPoseTransition {
  private readonly entries: Array<{
    target: PoseTransform
    originPosition: Vector3; originRotation: Quaternion; originScale: Vector3
    basePosition: Vector3; baseRotation: Quaternion; baseScale: Vector3
    offsetPosition: Vector3; offsetRotation: Quaternion; offsetScale: Vector3
  }>
  private readonly rotation = new Quaternion()
  private elapsed = 0
  private duration = 0
  private applied = false

  constructor(targets: readonly PoseTransform[]) {
    this.entries = targets.map(target => ({
      target,
      originPosition: new Vector3(), originRotation: new Quaternion(), originScale: new Vector3(),
      basePosition: new Vector3(), baseRotation: new Quaternion(), baseScale: new Vector3(),
      offsetPosition: new Vector3(), offsetRotation: new Quaternion(), offsetScale: new Vector3(),
    }))
  }

  get active(): boolean { return this.elapsed < this.duration }
  get blend(): number {
    if (!this.active) return 1
    const phase = this.elapsed / this.duration
    return phase * phase * (3 - 2 * phase)
  }

  /** Equipment must already be restored; retain the currently visible offset. */
  capture(): void {
    for (const entry of this.entries) {
      entry.originPosition.copy(entry.target.position)
      entry.originRotation.copy(entry.target.quaternion)
      entry.originScale.copy(entry.target.scale)
    }
    this.restore()
  }

  /** Call after evaluating the new, fully weighted target at its starting time. */
  begin(duration: number): void {
    this.duration = Number.isFinite(duration) ? Math.max(0, duration) : 0
    this.elapsed = 0
    for (const entry of this.entries) {
      entry.offsetPosition.subVectors(entry.originPosition, entry.target.position)
      entry.offsetScale.subVectors(entry.originScale, entry.target.scale)
      const offset = entry.offsetRotation.copy(entry.target.quaternion).invert().premultiply(entry.originRotation).normalize()
      // Choose a hemisphere once. A later target crossing 180 degrees cannot
      // change the decay route as it does in a live idle/attack crossfade.
      if (offset.w < 0) offset.set(-offset.x, -offset.y, -offset.z, -offset.w)
    }
    this.apply()
  }

  advance(dt: number): void { this.elapsed = Math.min(this.duration, this.elapsed + dt) }

  /** Restore even for update(0): unchanged/paused PropertyMixers may skip writes. */
  restore(): void {
    if (!this.applied) return
    for (const entry of this.entries) {
      entry.target.position.copy(entry.basePosition)
      entry.target.quaternion.copy(entry.baseRotation)
      entry.target.scale.copy(entry.baseScale)
    }
    this.applied = false
  }

  apply(): void {
    this.restore()
    if (!this.active) return
    const blend = this.blend
    for (const entry of this.entries) {
      entry.basePosition.copy(entry.target.position)
      entry.baseRotation.copy(entry.target.quaternion)
      entry.baseScale.copy(entry.target.scale)
      entry.target.position.addScaledVector(entry.offsetPosition, 1 - blend)
      entry.target.scale.addScaledVector(entry.offsetScale, 1 - blend)
      this.rotation.copy(entry.offsetRotation).slerp(identity, blend)
      entry.target.quaternion.premultiply(this.rotation).normalize()
    }
    this.applied = true
  }

  clear(): void { this.restore(); this.duration = this.elapsed = 0 }
}
