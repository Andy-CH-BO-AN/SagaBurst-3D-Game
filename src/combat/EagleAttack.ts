import * as THREE from 'three'
import { traceCombatSegment, type CombatContact, type PhysicalCombatTarget } from './ShieldBlocking'
import type { Mount } from '../world/Mount'
import { XONGKORO } from '../movement/XongkoroConfig'
import { segmentBoxTime } from './ShieldBlocking'
import type { ObstacleData } from '../world/Terrain'
type EagleAttackOwner = PhysicalCombatTarget & Pick<Mount, 'riderNpc' | 'riderPlayer'>
const sweepOffsets: THREE.Vector3[] = [new THREE.Vector3()]
for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
  sweepOffsets.push(new THREE.Vector3().setComponent(axis, sign * XONGKORO.attackRadius))
  for (let second = axis + 1; second < 3; second++) for (const otherSign of [-1, 1]) {
    sweepOffsets.push(new THREE.Vector3().setComponent(axis, sign * XONGKORO.attackRadius / Math.SQRT2)
      .setComponent(second, otherSign * XONGKORO.attackRadius / Math.SQRT2))
  }
}

/** One attack instance owns all head/claw contacts, including shield absorption. */
export class EagleAttack {
  private elapsed = Infinity
  private previousElapsed = Infinity
  private cooldown = 0
  private readonly victims = new Set<object>()
  private readonly previous = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  private readonly current = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  private readonly from = new THREE.Vector3()
  private readonly to = new THREE.Vector3()
  private readonly candidate: CombatContact = { kind: 'body', time: Infinity }
  private readonly contacts: CombatContact[] = []

  get active(): boolean {
    return this.previousElapsed < XONGKORO.attackWindup + XONGKORO.attackWindow && this.elapsed >= XONGKORO.attackWindup
  }
  get weight(): number {
    if (this.elapsed < XONGKORO.attackWindup) return this.elapsed / XONGKORO.attackWindup
    if (this.elapsed < XONGKORO.attackWindup + XONGKORO.attackWindow) return 1
    return Math.max(0, 1 - (this.elapsed - XONGKORO.attackWindup - XONGKORO.attackWindow) / XONGKORO.attackRecovery)
  }
  start(sockets: readonly THREE.Object3D[]): boolean {
    if (this.cooldown > 0) return false
    this.elapsed = this.previousElapsed = 0
    this.cooldown = XONGKORO.attackCooldown
    this.victims.clear()
    sockets.forEach((socket, i) => socket.getWorldPosition(this.current[i]))
    this.current.forEach((point, i) => this.previous[i].copy(point))
    return true
  }
  cancel(): void { this.elapsed = this.previousElapsed = Infinity; this.contacts.length = 0 }
  advance(dt: number): void {
    this.previousElapsed = this.elapsed
    this.elapsed += dt
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.current.forEach((point, i) => this.previous[i].copy(point))
  }
  sample(sockets: readonly THREE.Object3D[]): void { sockets.forEach((socket, i) => socket.getWorldPosition(this.current[i])) }
  trace(targets: readonly PhysicalCombatTarget[], mounts: readonly Mount[], ownMount: EagleAttackOwner, obstacles: readonly ObstacleData[] = []): readonly CombatContact[] {
    this.contacts.length = 0
    if (!this.active) return this.contacts
    for (const target of targets) this.traceTarget(target, ownMount, obstacles)
    for (const mount of mounts) if (!mount.dead && !mount.disposed) this.traceTarget(mount, ownMount, obstacles)
    return this.contacts
  }
  private traceTarget(target: PhysicalCombatTarget, ownMount: EagleAttackOwner, obstacles: readonly ObstacleData[]): void {
    if (target === ownMount || target === ownMount.riderNpc || target === ownMount.riderPlayer || this.victims.has(target)) return
    const dt = this.elapsed - this.previousElapsed
    const begin = THREE.MathUtils.clamp((XONGKORO.attackWindup - this.previousElapsed) / Math.max(dt, .000001), 0, 1)
    const end = THREE.MathUtils.clamp((XONGKORO.attackWindup + XONGKORO.attackWindow - this.previousElapsed) / Math.max(dt, .000001), 0, 1)
    let first: CombatContact | undefined
    for (let i = 0; i < this.current.length; i++) {
      // Centre, cardinal and diagonal rails cover the claw's swept rounded volume.
      for (const offset of sweepOffsets) {
        this.from.lerpVectors(this.previous[i], this.current[i], begin)
        this.to.lerpVectors(this.previous[i], this.current[i], end)
        this.from.add(offset); this.to.add(offset)
        if (traceCombatSegment(target, this.from, this.to, this.candidate) && (!first || this.candidate.time < first.time)
          && !obstacles.some(({ box }) => segmentBoxTime(this.from, this.to, box) <= this.candidate.time)) first = { ...this.candidate, attackSource: 'xongkoro' }
      }
    }
    if (!first) return
    const victim = first.mount ?? target
    if (this.victims.has(victim)) return
    this.victims.add(victim)
    this.contacts.push(first)
  }
}
