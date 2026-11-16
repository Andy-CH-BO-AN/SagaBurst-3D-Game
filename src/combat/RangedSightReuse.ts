import { obstacleTopologyRevision } from '../world/ObstacleTopology'

/** How long one ranged line-of-sight trace stays valid for the same shooter/target pair. */
export const RANGED_SIGHT_REUSE_SECONDS = 0.2
/** Either end moving further than this (metres) forces a fresh trace. */
export const RANGED_SIGHT_REUSE_MOVE = 0.5

interface Point { x: number; y: number; z: number }

/**
 * Per-shooter reuse of one ranged clear/blocked decision for a few frames. Only an
 * identified target (an NPC or the player) is reused; the same obstacle collection at
 * the same topology revision is required, and the clock is simulation time, so low
 * frame rates never stretch the window. Moving obstacles (siege carriers) are seen
 * at most RANGED_SIGHT_REUSE_SECONDS late — the accepted shot-timing trade-off.
 */
export class RangedSightReuse {
  private target: object | null = null
  private obstacles: object | null = null
  private revision = -1
  private tracedAt = -Infinity
  private clear = false
  private readonly shooterAt = { x: 0, y: 0, z: 0 }
  private readonly targetAt = { x: 0, y: 0, z: 0 }

  isClear(now: number, target: object | null, shooter: Point, targetPosition: Point, obstacles: object, trace: () => boolean): boolean {
    const revision = obstacleTopologyRevision(obstacles)
    if (target !== null && target === this.target && obstacles === this.obstacles && revision === this.revision
      && now - this.tracedAt < RANGED_SIGHT_REUSE_SECONDS && now >= this.tracedAt
      && distanceSq(shooter, this.shooterAt) <= RANGED_SIGHT_REUSE_MOVE ** 2
      && distanceSq(targetPosition, this.targetAt) <= RANGED_SIGHT_REUSE_MOVE ** 2) return this.clear
    this.clear = trace()
    this.target = target
    this.obstacles = obstacles
    this.revision = revision
    this.tracedAt = now
    copy(this.shooterAt, shooter)
    copy(this.targetAt, targetPosition)
    return this.clear
  }
}

function distanceSq(a: Point, b: Point): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function copy(out: Point, from: Point): void {
  out.x = from.x; out.y = from.y; out.z = from.z
}
