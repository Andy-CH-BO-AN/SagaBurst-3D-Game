import { Ray, Sphere, Vector3 } from 'three'
import { projectileTerrainContactTime } from './ProjectileBallistics'
import { traceCombatSegment, type CombatContact, type PhysicalCombatTarget } from './ShieldBlocking'
import { findBlockingProjectileObstacleAlongPath, projectileObstacleEntryFraction, queryProjectilePathObstacles, type ObstacleData } from '../world/Terrain'
import type { DamageableObstacle } from '../world/DamageableObstacle'

export interface ProjectileSiegeContact {
  target: DamageableObstacle
  point: Vector3
  distance: number
}

type ProjectileWorld =
  | { kind: 'battle'; travelledDistance: number }
  | { kind: 'town'; practiceTargets: readonly Vector3[];
      traceSiege(from: Vector3, to: Vector3, maximum: number): ProjectileSiegeContact | null }

/** Ordered target arrays visited in place, without a per-shot generator or concatenation. */
export interface ProjectileTargetGroups<T> { readonly groups: readonly (readonly T[])[] }

/** Every hittable primitive (body, limbs, shield, seat) lies within this distance of its target origin;
 * mount colliders add their own combat radius. */
const TARGET_REACH = 4

type IndexedTarget = PhysicalCombatTarget & { combatRadius?: number }
const targetReach = (target: IndexedTarget): number => TARGET_REACH + (target.mountCollider ? target.combatRadius ?? 0 : 0)

const CELL_SIZE = 8
const CELL_SPAN = 4096
const MAX_QUERY_CELLS = 64
/**
 * Per-frame XZ grid over ordered target groups. A query yields every target the linear capsule
 * broad phase could accept (cells cover the segment's XZ bounds grown by the largest reach) in
 * the original group order, so the exact phase and its tie-breaking are unchanged.
 *
 * Contract: positions are sampled at the first query after `reset`/`invalidate`. The owner calls
 * `updateTarget` for each target a hit may have moved (or `invalidate` when it cannot say which),
 * and `reset` each frame. A cell move keeps every target's original group ordinal, so candidate
 * order and tie-breaking are identical to a full rebuild.
 */
export class ProjectileTargetIndex<T extends IndexedTarget> {
  private groups: readonly (readonly T[])[] = []
  private dirty = true
  private readonly ordered: T[] = []
  private readonly cells = new Map<number, number[]>()
  private readonly usedCells: number[][] = []
  private readonly unplaced: number[] = []
  private readonly ordinals = new Map<T, number>()
  /** Cell key per ordinal, or -1 when the target is outside the grid (kept in `unplaced`). */
  private cellKeys: number[] = []
  private hasDuplicates = false
  private readonly candidates: number[] = []
  private readonly selected: T[] = []
  private readonly selectedGroups: readonly (readonly T[])[] = [this.selected]
  private readonly allGroups: readonly (readonly T[])[] = [this.ordered]
  private maxReach = TARGET_REACH

  reset(groups: readonly (readonly T[])[]): void { this.groups = groups; this.dirty = true }
  invalidate(): void { this.dirty = true }

  /** Re-samples one target's cell after a hit may have moved it. Unknown targets fall back to a rebuild. */
  updateTarget(target: T): void {
    if (this.dirty) return
    // One object listed in several groups owns several cells; only a rebuild can move all of them.
    if (this.hasDuplicates) { this.dirty = true; return }
    const ordinal = this.ordinals.get(target)
    if (ordinal === undefined) { this.dirty = true; return }
    const key = this.keyOf(target)
    this.maxReach = Math.max(this.maxReach, targetReach(target))
    if (!Number.isFinite(this.maxReach)) this.maxReach = Infinity
    const previous = this.cellKeys[ordinal]
    if (key === previous) return
    if (previous === -1) removeOrdinal(this.unplaced, ordinal)
    else removeOrdinal(this.cells.get(previous)!, ordinal)
    this.cellKeys[ordinal] = key
    if (key === -1) { this.unplaced.push(ordinal); return }
    let cell = this.cells.get(key)
    if (!cell) { cell = []; this.cells.set(key, cell) }
    if (cell.length === 0) this.usedCells.push(cell)
    cell.push(ordinal)
  }

  private keyOf(target: T): number {
    const { x, z } = target.group.position
    const cx = Math.floor(x / CELL_SIZE), cz = Math.floor(z / CELL_SIZE)
    if (!Number.isFinite(cx + cz) || Math.abs(cx) >= CELL_SPAN / 2 || Math.abs(cz) >= CELL_SPAN / 2) return -1
    return cellKey(cx, cz)
  }

  /** Candidates for one swept segment, as one ordered group (scratch, valid until the next query). */
  candidateGroups(from: Vector3, to: Vector3): readonly (readonly T[])[] {
    if (this.dirty) this.rebuild()
    const reach = this.maxReach
    const minX = Math.floor((Math.min(from.x, to.x) - reach) / CELL_SIZE), maxX = Math.floor((Math.max(from.x, to.x) + reach) / CELL_SIZE)
    const minZ = Math.floor((Math.min(from.z, to.z) - reach) / CELL_SIZE), maxZ = Math.floor((Math.max(from.z, to.z) + reach) / CELL_SIZE)
    if (!Number.isFinite(minX + maxX + minZ + maxZ) || (maxX - minX + 1) * (maxZ - minZ + 1) > MAX_QUERY_CELLS) return this.allGroups
    const ordinals = this.candidates
    ordinals.length = 0
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const cell = this.cells.get(cellKey(x, z))
      if (cell) for (let i = 0; i < cell.length; i++) ordinals.push(cell[i])
    }
    for (let i = 0; i < this.unplaced.length; i++) ordinals.push(this.unplaced[i])
    // Each target sits in one cell, so ordinals are unique; restore group order.
    if (ordinals.length > 1) ordinals.sort(ascending)
    const selected = this.selected
    selected.length = ordinals.length
    for (let i = 0; i < ordinals.length; i++) selected[i] = this.ordered[ordinals[i]]
    return this.selectedGroups
  }

  private rebuild(): void {
    this.dirty = false
    for (const cell of this.usedCells) cell.length = 0
    this.usedCells.length = 0
    this.unplaced.length = 0
    this.selected.length = 0
    const ordered = this.ordered
    ordered.length = 0
    this.ordinals.clear()
    this.hasDuplicates = false
    this.cellKeys.length = 0
    let maxReach = TARGET_REACH
    for (const group of this.groups) for (const target of group) {
      const ordinal = ordered.length
      ordered.push(target)
      if (this.ordinals.has(target)) this.hasDuplicates = true
      else this.ordinals.set(target, ordinal)
      maxReach = Math.max(maxReach, targetReach(target))
      const key = this.keyOf(target)
      this.cellKeys.push(key)
      if (key === -1) { this.unplaced.push(ordinal); continue }
      let cell = this.cells.get(key)
      if (!cell) { cell = []; this.cells.set(key, cell) }
      if (cell.length === 0) this.usedCells.push(cell)
      cell.push(ordinal)
    }
    // A non-finite reach makes the linear test accept every distance; keep that.
    this.maxReach = Number.isFinite(maxReach) ? maxReach : Infinity
  }
}
const cellKey = (x: number, z: number): number => (x + CELL_SPAN / 2) * CELL_SPAN + (z + CELL_SPAN / 2)
const ascending = (a: number, b: number): number => a - b
function removeOrdinal(list: number[], ordinal: number): void {
  const index = list.indexOf(ordinal)
  if (index >= 0) list.splice(index, 1)
}

function segmentPointDistanceSq(from: Vector3, to: Vector3, point: Vector3): number {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z
  const px = point.x - from.x, py = point.y - from.y, pz = point.z - from.z
  const lengthSq = dx * dx + dy * dy + dz * dz
  const t = lengthSq > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy + pz * dz) / lengthSq)) : 0
  const ex = px - dx * t, ey = py - dy * t, ez = pz - dz * t
  return ex * ex + ey * ey + ez * ez
}

export type ProjectileContact<T> =
  | { kind: 'terrain' | 'practice'; point: Vector3 }
  | { kind: 'obstacle'; obstacle: ObstacleData; point: Vector3 }
  | { kind: 'siege'; target: DamageableObstacle; point: Vector3 }
  | { kind: 'actor'; target: T; contact: CombatContact; point: Vector3 }

/** Resolves one swept shot before its caller applies damage. Scene membership and
 * hostility stay live inputs; geometry, broad-phase and first-contact precedence
 * are shared. Ties retain terrain, source obstacle order, then target order, except
 * Town siege meshes retain their authored 1mm precedence over world blockers.
 */
export class ProjectileContactQuery {
  private readonly candidate: CombatContact = { kind: 'body', time: Infinity }
  private readonly best: CombatContact = { kind: 'body', time: Infinity }
  private readonly obstacleContact = { fraction: Infinity, point: new Vector3() }
  private readonly direction = new Vector3()
  private readonly ray = new Ray()
  private readonly sphere = new Sphere(undefined, .6)
  private readonly spherePoint = new Vector3()

  find<T extends PhysicalCombatTarget & { combatRadius?: number }>(from: Vector3, to: Vector3, input: {
    world: ProjectileWorld
    obstacles: readonly ObstacleData[]
    /** Iteration order breaks equal actor contacts; do not deduplicate or sort. */
    targets: Iterable<T> | ProjectileTargetGroups<T> | ProjectileTargetIndex<T>
    /** Read after broad-phase, once per candidate in this shot; never cached. */
    acceptsTarget(target: T): boolean
  }): ProjectileContact<T> | null {
    const { world } = input, town = world.kind === 'town', length = from.distanceTo(to)
    // Battle compares segment fractions, including stationary initial contacts.
    // Town historically compares metres and allows practice targets 1cm past the tip.
    const scale = town ? length : 1
    const worldEnabled = town || world.travelledDistance >= .12
    const terrain = worldEnabled ? projectileTerrainContactTime(from, to) : Infinity
    let nearest = town ? Math.min(length + .01, terrain * length) : terrain
    let kind: ProjectileContact<T>['kind'] | undefined = Number.isFinite(terrain) ? 'terrain' : undefined
    let obstacle: ObstacleData | undefined, actor: T | undefined, siege: ProjectileSiegeContact | null = null
    if (worldEnabled) {
      if (town) {
        const hit = findBlockingProjectileObstacleAlongPath(from, to, input.obstacles, this.obstacleContact)
        if (hit && this.obstacleContact.fraction * length < nearest) {
          nearest = this.obstacleContact.fraction * length; obstacle = hit; kind = 'obstacle'
        }
      } else {
        // Same exact reject the Town finder uses, applied before the slab test; source order and the
        // strict `<` keep first-in-source tie-breaking. Registered sources narrow to their grid cells.
        const minX = Math.min(from.x, to.x) - 1e-6, maxX = Math.max(from.x, to.x) + 1e-6
        const minY = Math.min(from.y, to.y) - 1e-6, maxY = Math.max(from.y, to.y) + 1e-6
        const minZ = Math.min(from.z, to.z) - 1e-6, maxZ = Math.max(from.z, to.z) + 1e-6
        const candidates = Number.isFinite(minX + maxX + minY + maxY + minZ + maxZ)
          ? queryProjectilePathObstacles(input.obstacles, minX, minZ, maxX, maxZ) ?? input.obstacles : input.obstacles
        for (const entry of candidates) {
          if (entry.projectilePassable) continue
          const bounds = entry.projectileBounds ?? (entry.projectileWorldToLocal ? null : entry.box)
          if (bounds && (maxX < bounds.min.x || minX > bounds.max.x || maxY < bounds.min.y
            || minY > bounds.max.y || maxZ < bounds.min.z || minZ > bounds.max.z)) continue
          const time = projectileObstacleEntryFraction(entry, from, to)
          if (time !== null && time < nearest) { nearest = time; obstacle = entry; kind = 'obstacle' }
        }
      }
    }
    if (world.kind === 'town') {
      const hit = world.traceSiege(from, to, Math.min(length, nearest + .001))
      if (hit && hit.distance <= nearest + .001) { nearest = hit.distance; siege = hit; kind = 'siege' }
      this.ray.set(from, this.direction.subVectors(to, from).normalize())
      for (const center of world.practiceTargets) {
        this.sphere.center.copy(center)
        const point = this.ray.intersectSphere(this.sphere, this.spherePoint)
        const distance = point?.distanceTo(from) ?? Infinity
        if (distance < nearest) { nearest = distance; kind = 'practice' }
      }
    }
    // Capsule broad-phase around the swept segment: a target whose origin is farther than
    // its reach from every point of the segment cannot be touched by it.
    const { targets } = input
    const groups: readonly Iterable<T>[] = targets instanceof ProjectileTargetIndex ? targets.candidateGroups(from, to)
      : 'groups' in targets ? targets.groups : [targets]
    for (const group of groups) for (const target of group) {
      const reach = targetReach(target)
      if (segmentPointDistanceSq(from, to, target.group.position) > reach * reach || !input.acceptsTarget(target)) continue
      if (traceCombatSegment(target, from, to, this.candidate) && this.candidate.time * scale < nearest) {
        nearest = this.candidate.time * scale; actor = target; kind = 'actor'
        Object.assign(this.best, this.candidate)
      }
    }
    if (!kind) return null
    // One owned result per hit, never per target. Damage may synchronously mutate
    // live geometry; neither its point nor contact may alias query scratch state.
    const point = kind === 'siege' ? siege!.point.clone()
      : kind === 'obstacle' && town ? this.obstacleContact.point.clone()
      : town && length === 0 ? from.clone()
      : new Vector3().lerpVectors(from, to, town ? nearest / length : nearest)
    if (kind === 'actor') return { kind, target: actor!, contact: { ...this.best }, point }
    if (kind === 'obstacle') return { kind, obstacle: obstacle!, point }
    if (kind === 'siege') return { kind, target: siege!.target, point }
    return { kind, point }
  }
}
