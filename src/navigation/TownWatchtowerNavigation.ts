import { Box3, Vector3 } from 'three'
import { getWalkRampHeight, type WalkRampSurface } from '../world/Terrain'
import { surfaceBox } from '../town/TownRamparts'
import type { CommandWatchtowerLayout } from '../town/TownCommandWatchtowerLayout'

type Point = { x: number; y: number; z: number }
const HEIGHT_TOLERANCE = 1.3 // Player origin is above its feet; adjacent circuits are >16m apart.
const ELEVATED_STEP = { ground: false, tower: true } as const
const GROUND_STEP = { ground: true, tower: true } as const

/** Small immutable surface graph. Portals are built once from real, height-matched
 * shared boundaries; queries inspect only the actor's height bucket, never all flights.
 * Ground approach remains owned by the existing budgeted NavigationWorld A*. */
export class TownWatchtowerNavigation {
  private readonly surfaces: WalkRampSurface[]
  private readonly centers: Vector3[]
  private readonly buckets = new Map<number, number[]>()
  private readonly portals: (Vector3 | undefined)[][]
  private readonly next: number[][]
  readonly approach: Vector3
  private readonly bounds: Box3

  constructor(readonly layout: CommandWatchtowerLayout) {
    this.surfaces = [layout.entrance, ...layout.landings, ...layout.ramps, ...layout.platform]
    const boxes = this.surfaces.map(s => surfaceBox(s))
    this.centers = this.surfaces.map(s => new Vector3(s.startX + s.dirX * s.length / 2,
      (s.startY + s.topY) / 2, s.startZ + s.dirZ * s.length / 2))
    this.bounds = layout.footprint.clone().union(boxes[0])
    const entry = layout.entrance
    this.approach = new Vector3(entry.startX - entry.dirX * 1.5, entry.startY, entry.startZ - entry.dirZ * 1.5)
    this.portals = this.surfaces.map(() => [])
    for (let i = 0; i < this.surfaces.length; i++) {
      const s = this.surfaces[i]
      for (let bucket = Math.floor((Math.min(s.startY, s.topY) - HEIGHT_TOLERANCE) / 2);
        bucket <= Math.floor((Math.max(s.startY, s.topY) + HEIGHT_TOLERANCE) / 2); bucket++) {
        const list = this.buckets.get(bucket) ?? []
        list.push(i); this.buckets.set(bucket, list)
      }
      for (let j = 0; j < i; j++) {
        const a = boxes[i], b = boxes[j]
        const loX = Math.max(a.min.x, b.min.x), hiX = Math.min(a.max.x, b.max.x)
        const loZ = Math.max(a.min.z, b.min.z), hiZ = Math.min(a.max.z, b.max.z)
        if (loX > hiX + .001 || loZ > hiZ + .001 || Math.max(hiX - loX, hiZ - loZ) < 2) continue
        const x = (loX + hiX) / 2, z = (loZ + hiZ) / 2
        const y = getWalkRampHeight(s, x, z), otherY = getWalkRampHeight(this.surfaces[j], x, z)
        if (y === null || otherY === null || Math.abs(y - otherY) > .001) continue
        this.portals[i][j] = this.portals[j][i] = new Vector3(x, y, z)
      }
    }
    // All-pairs first hop on this tiny static topology; no runtime path search.
    this.next = this.surfaces.map((_, start) => {
      const hops = Array<number>(this.surfaces.length).fill(-1), queue = [start]
      hops[start] = start
      for (let head = 0; head < queue.length; head++) {
        const from = queue[head]
        for (let to = 0; to < this.surfaces.length; to++) {
          if (!this.portals[from][to] || hops[to] !== -1) continue
          hops[to] = from === start ? to : hops[from]; queue.push(to)
        }
      }
      return hops
    })
  }

  surfaceAt(p: Point): number {
    if (p.x < this.bounds.min.x || p.x > this.bounds.max.x || p.z < this.bounds.min.z || p.z > this.bounds.max.z) return -1
    const candidates = this.buckets.get(Math.floor(p.y / 2))
    if (!candidates) return -1
    let best = -1, gap = HEIGHT_TOLERANCE
    for (const index of candidates) {
      const y = getWalkRampHeight(this.surfaces[index], p.x, p.z)
      if (y !== null && Math.abs(p.y - y) < gap) { best = index; gap = Math.abs(p.y - y) }
    }
    return best
  }

  /** Contact across disconnected floors never grants melee reach or arrival. */
  sameLevel(a: Point, b: Point): boolean {
    const from = this.surfaceAt(a), to = this.surfaceAt(b)
    if (from < 0 && to < 0) return true
    if (from < 0 || to < 0) {
      const known = from < 0 ? to : from, other = from < 0 ? a : b
      // The entrance meets ordinary ground. Jumping above the same supported
      // surface also remains legal; the caller retains its actual 3D weapon reach.
      if (known === 0) return true
      const y = getWalkRampHeight(this.surfaces[known], other.x, other.z)
      return y !== null && other.y >= y - HEIGHT_TOLERANCE
    }
    return from === to || from >= 0 && to >= 0 && Boolean(this.portals[from][to])
  }

  near(p: Point, radius: number): boolean {
    return p.x >= this.bounds.min.x - radius && p.x <= this.bounds.max.x + radius
      && p.z >= this.bounds.min.z - radius && p.z <= this.bounds.max.z + radius
  }

  resolve(current: Point, goal: Point, out: Vector3): { ground: boolean; tower: true } | null {
    const from = this.surfaceAt(current), destination = this.surfaceAt(goal)
    if (from < 0 && destination < 0) return null
    if (from < 0) {
      const entry = this.layout.entrance
      const along = (current.x - entry.startX) * entry.dirX + (current.z - entry.startZ) * entry.dirZ
      const lateral = Math.abs((current.x - entry.startX) * -entry.dirZ + (current.z - entry.startZ) * entry.dirX)
      if (!(along >= -2 && along <= .1 && lateral < entry.halfWidth - 1.1)) {
        out.copy(this.approach); return GROUND_STEP
      }
      out.copy(this.centers[0]); return ELEVATED_STEP
    }
    if (destination === from) { out.copy(goal); return ELEVATED_STEP }
    if (from === 0 && destination < 0) { out.copy(this.approach); return ELEVATED_STEP }
    const to = this.next[from][destination < 0 ? 0 : destination]
    const portal = this.portals[from][to]
    if (!portal) { out.copy(current); return ELEVATED_STEP }
    out.copy(portal)
    // Cross the shared boundary before selecting the next surface. Steering via
    // its centre keeps both directions away from the outside corner railing.
    if (Math.hypot(current.x - portal.x, current.z - portal.z) < .45) out.copy(this.centers[to])
    return ELEVATED_STEP
  }

  clampFollow(out: Vector3, leader: Point): boolean {
    const index = this.surfaceAt(leader)
    if (index < 0) return false
    const s = this.surfaces[index]
    const along = Math.max(.5, Math.min(s.length - .5,
      (out.x - s.startX) * s.dirX + (out.z - s.startZ) * s.dirZ))
    const lateral = Math.max(-s.halfWidth + 1.1, Math.min(s.halfWidth - 1.1,
      (out.x - s.startX) * -s.dirZ + (out.z - s.startZ) * s.dirX))
    out.set(s.startX + s.dirX * along - s.dirZ * lateral,
      s.startY + (s.topY - s.startY) * along / s.length,
      s.startZ + s.dirZ * along + s.dirX * lateral)
    return true
  }
}
