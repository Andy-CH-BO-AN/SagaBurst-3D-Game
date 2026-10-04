import * as THREE from 'three'

/** Bounded movement history lets a long follow column bend around the leader's actual path. */
export class FollowTrail {
  private points: THREE.Vector3[] = []
  reset(position: THREE.Vector3, yaw: number): void {
    this.points = [position.clone().add(new THREE.Vector3(-Math.sin(yaw) * 55, 0, -Math.cos(yaw) * 55)), position.clone()]
  }
  /** Keep the curved trail behind a replacement leader instead of rotating the whole column. */
  rebase(position: THREE.Vector3, yaw: number): void {
    let nearest = -1, distance = Infinity
    for (let i = 0; i < this.points.length; i++) {
      const d = this.points[i].distanceToSquared(position)
      if (d < distance) { nearest = i; distance = d }
    }
    if (nearest < 1 || distance > 20 * 20) { this.reset(position, yaw); return }
    this.points.splice(nearest + 1)
    this.record(position)
  }
  record(position: THREE.Vector3): void {
    const last = this.points[this.points.length - 1]
    if (!last || Math.hypot(last.x - position.x, last.z - position.z) >= .8) this.points.push(position.clone())
    // Keep at least the longest mounted column plus recovery room, independent of play duration.
    let length = 0
    for (let i = this.points.length - 1; i > 0; i--) {
      length += this.points[i].distanceTo(this.points[i - 1])
      if (length > 90) { this.points.splice(0, i - 1); break }
    }
  }
  sample(behind: number, out: { position: THREE.Vector3; yaw: number }): void {
    for (let i = this.points.length - 1; i > 0; i--) {
      const a = this.points[i - 1], b = this.points[i], length = Math.hypot(b.x - a.x, b.z - a.z)
      if (length >= behind || i === 1) {
        out.position.copy(b).lerp(a, Math.min(1, behind / Math.max(.001, length)))
        out.yaw = Math.atan2(b.x - a.x, b.z - a.z)
        return
      }
      behind -= length
    }
  }
}
