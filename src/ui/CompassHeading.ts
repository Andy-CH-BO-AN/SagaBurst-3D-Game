import { Vector3, type Camera } from 'three'

const FULL_TURN = Math.PI * 2

/** World north is -Z and east is +X, independent of actor/controller yaw. */
export function resolveCompassHeading(forward: Readonly<Vector3>, previous: number): number {
  if (!Number.isFinite(forward.x) || !Number.isFinite(forward.y) || !Number.isFinite(forward.z)
    || forward.x * forward.x + forward.z * forward.z < 1e-6) return previous
  const heading = Math.atan2(forward.x, -forward.z)
  return (heading + FULL_TURN) % FULL_TURN
}

/** Owns reusable math data, but never retains the scene's camera. */
export class CompassHeading {
  private readonly forward = new Vector3()
  private heading = 0

  update(camera: Pick<Camera, 'getWorldDirection'>): number {
    camera.getWorldDirection(this.forward)
    this.heading = resolveCompassHeading(this.forward, this.heading)
    return this.heading
  }
}
