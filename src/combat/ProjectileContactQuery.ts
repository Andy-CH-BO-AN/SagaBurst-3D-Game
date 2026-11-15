import { Ray, Sphere, Vector3 } from 'three'
import { projectileTerrainContactTime } from './ProjectileBallistics'
import { traceCombatSegment, type CombatContact, type PhysicalCombatTarget } from './ShieldBlocking'
import { findBlockingProjectileObstacleAlongPath, projectileObstacleEntryFraction, type ObstacleData } from '../world/Terrain'
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
    targets: Iterable<T> | ProjectileTargetGroups<T>
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
      } else for (const entry of input.obstacles) {
        const time = projectileObstacleEntryFraction(entry, from, to)
        if (time !== null && time < nearest) { nearest = time; obstacle = entry; kind = 'obstacle' }
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
    const groups: readonly Iterable<T>[] = 'groups' in targets ? targets.groups : [targets]
    for (const group of groups) for (const target of group) {
      const reach = TARGET_REACH + (target.mountCollider ? target.combatRadius ?? 0 : 0)
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
