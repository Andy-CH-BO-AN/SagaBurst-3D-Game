import * as THREE from 'three'
import { ARMORS } from '../rpg/ArmorDatabase'
import { WEAPONS } from '../rpg/WeaponDatabase'

export const SHIELD_CONFIG = {
  impactByTier: { 1: 5, 2: 10, 3: 20 },
  axeImpactByTier: { 1: 2, 2: 4, 3: 8 },
  xpPerBlockedImpact: 20,
} as const
export function weaponShieldImpact(id?: string): number {
  const weapon = WEAPONS[id ?? '']
  return weapon?.animationKind === 'axe' ? SHIELD_CONFIG.axeImpactByTier[weapon.tier as 1 | 2 | 3] ?? 1 : 1
}
export function blockingReduction(level: number): number {
  return Math.min(.5, Math.max(0, Number.isFinite(level) ? Math.floor(level) : 0) * .01)
}
/** Battle-local state, deliberately excluded from inventory and Career saves. */
export class ShieldState {
  shieldImpactMax = 0
  shieldImpactRemaining = 0
  shieldRaised = false
  private id: string | null = null
  private readonly used = new Map<string, number>()
  get shieldBroken(): boolean { return this.shieldImpactMax > 0 && this.shieldImpactRemaining <= 0 }
  get active(): boolean { return this.shieldImpactRemaining > 0 }
  equip(id: string | null): void {
    if (id === this.id) return
    if (this.id) this.used.set(this.id, this.shieldImpactRemaining)
    this.id = id
    this.shieldImpactMax = id && ARMORS[id] ? SHIELD_CONFIG.impactByTier[ARMORS[id].tier] : 0
    this.shieldImpactRemaining = id ? this.used.get(id) ?? this.shieldImpactMax : 0
    this.shieldRaised = false
  }
  reset(): void { this.used.clear(); this.shieldImpactRemaining = this.shieldImpactMax; this.shieldRaised = false }
  absorb(damage: number, impact: number, level = 0): { damage: number; blockedImpact: number } {
    if (!this.active || !Number.isFinite(impact) || impact <= 0) return { damage, blockedImpact: 0 }
    const blockedImpact = Math.min(this.shieldImpactRemaining, impact)
    this.shieldImpactRemaining -= blockedImpact
    if (this.shieldBroken) this.shieldRaised = false
    return { damage: damage * (impact - blockedImpact) / impact * (1 - blockingReduction(level)), blockedImpact }
  }
}

const AXES = ['x', 'y', 'z'] as const
export function segmentBoxTime(a: THREE.Vector3, b: THREE.Vector3, box: THREE.Box3): number {
  let enter = 0, leave = 1
  for (const axis of AXES) {
    const d = b[axis] - a[axis]
    if (Math.abs(d) < 1e-9) {
      if (a[axis] < box.min[axis] || a[axis] > box.max[axis]) return Infinity
    } else {
      const t1 = (box.min[axis] - a[axis]) / d, t2 = (box.max[axis] - a[axis]) / d
      enter = Math.max(enter, Math.min(t1, t2)); leave = Math.min(leave, Math.max(t1, t2))
      if (enter > leave) return Infinity
    }
  }
  return enter
}

/** OBB in shield model space. Never reads triangles or traverses meshes. */
export class ShieldCollider {
  private readonly inverse = new THREE.Matrix4()
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly box = new THREE.Box3()
  constructor(private readonly pivot: THREE.Object3D, private readonly state: ShieldState) {}
  setModel(id: string | null): void {
    if (id?.startsWith('scutum')) this.box.set(this.a.set(-.31, -.51, -.01), this.b.set(.31, .51, .25))
    else this.box.set(this.a.set(-.43, -.43, .12), this.b.set(.43, .43, .28))
  }
  time(from: THREE.Vector3, to: THREE.Vector3): number {
    if (!this.state.active) return Infinity
    this.prepare()
    return this.preparedTime(from, to)
  }
  prepare(): void {
    if (!this.state.active) return
    this.pivot.updateWorldMatrix(true, false)
    this.inverse.copy(this.pivot.matrixWorld).invert()
  }
  preparedTime(from: THREE.Vector3, to: THREE.Vector3): number {
    if (!this.state.active) return Infinity
    this.a.copy(from).applyMatrix4(this.inverse); this.b.copy(to).applyMatrix4(this.inverse)
    return segmentBoxTime(this.a, this.b, this.box)
  }
  refreshVisibility(): void { this.pivot.visible = !this.state.shieldBroken }
}

export interface PhysicalCombatTarget {
  group: THREE.Object3D
  combatPosition: THREE.Vector3
  isMounted: boolean
  bodyBaseOffset?: number
  bodyHitNodes?: readonly THREE.Object3D[]
  shield?: ShieldState
  shieldCollider?: ShieldCollider
}
export interface CombatContact { kind: 'shield' | 'body'; time: number }
const bodyBox = new THREE.Box3()
// Shared synchronous scratch: sampled once per target query, not once per blade point.
const limbCenters = Array.from({ length: 6 }, () => new THREE.Vector3())
let limbCount = 0
function prepareTarget(target: PhysicalCombatTarget): void {
  limbCount = Math.min(limbCenters.length, target.bodyHitNodes?.length ?? 0)
  for (let i = 0; i < limbCount; i++) target.bodyHitNodes![i].getWorldPosition(limbCenters[i])
  target.shieldCollider?.prepare()
}
function segmentSphereTime(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, radius: number): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
  const ox = a.x - c.x, oy = a.y - c.y, oz = a.z - c.z
  const near = ox * ox + oy * oy + oz * oz - radius * radius
  if (near <= 0) return 0
  const len = dx * dx + dy * dy + dz * dz
  if (len < 1e-12) return Infinity
  const dot = ox * dx + oy * dy + oz * dz, disc = dot * dot - len * near
  if (disc < 0) return Infinity
  const t = (-dot - Math.sqrt(disc)) / len
  return t >= 0 && t <= 1 ? t : Infinity
}
function bodyTime(target: PhysicalCombatTarget, from: THREE.Vector3, to: THREE.Vector3): number {
  const p = target.group.position, base = p.y + (target.bodyBaseOffset ?? 0)
  bodyBox.min.set(p.x - .3, base + .06, p.z - .3)
  bodyBox.max.set(p.x + .3, base + 1.8, p.z + .3)
  let time = segmentBoxTime(from, to, bodyBox)
  // Small bone-following primitives include outstretched arms/hands and moving feet.
  for (let i = 0; i < limbCount; i++) time = Math.min(time, segmentSphereTime(from, to, limbCenters[i], .12))
  if (target.isMounted) {
    const m = target.combatPosition
    bodyBox.min.set(m.x - .55, m.y + .3, m.z - .55)
    bodyBox.max.set(m.x + .55, m.y + 1.4, m.z + .55)
    time = Math.min(time, segmentBoxTime(from, to, bodyBox))
  }
  return time
}
/** First contact only; a tie belongs to body, never magical shield mitigation. */
export function traceCombatSegment(target: PhysicalCombatTarget, from: THREE.Vector3, to: THREE.Vector3, out: CombatContact, prepared = false): boolean {
  if (!prepared) prepareTarget(target)
  const body = bodyTime(target, from, to), shield = target.shieldCollider?.preparedTime(from, to) ?? Infinity
  out.time = Math.min(body, shield); out.kind = shield < body ? 'shield' : 'body'
  return Number.isFinite(out.time)
}

/** Retained blade endpoints. Query only the existing nearby combat candidates. */
export class WeaponSweep {
  readonly contact: CombatContact = { kind: 'body', time: Infinity }
  private readonly previousGrip = new THREE.Vector3()
  private readonly previousTip = new THREE.Vector3()
  private readonly grip = new THREE.Vector3()
  private readonly tip = new THREE.Vector3()
  private readonly from = new THREE.Vector3()
  private readonly to = new THREE.Vector3()
  private readonly candidate: CombatContact = { kind: 'body', time: Infinity }
  private ready = false
  capture(grip: THREE.Vector3, tip: THREE.Vector3): void {
    this.previousGrip.copy(this.ready ? this.grip : grip); this.previousTip.copy(this.ready ? this.tip : tip)
    this.grip.copy(grip); this.tip.copy(tip); this.ready = true
  }
  reset(): void { this.ready = false }
  trace(target: PhysicalCombatTarget): CombatContact | undefined {
    if (!this.ready) return undefined
    prepareTarget(target)
    this.contact.time = Infinity
    const samples = Math.min(64, Math.max(8, Math.ceil(this.grip.distanceTo(this.tip) / .08)))
    for (let i = 0; i <= samples; i++) {
      this.from.lerpVectors(this.previousGrip, this.previousTip, i / samples)
      this.to.lerpVectors(this.grip, this.tip, i / samples)
      if (traceCombatSegment(target, this.from, this.to, this.candidate, true) && this.candidate.time < this.contact.time) {
        this.contact.kind = this.candidate.kind; this.contact.time = this.candidate.time
      }
    }
    if (Number.isFinite(this.contact.time)) return this.contact
    return traceCombatSegment(target, this.grip, this.tip, this.contact, true) ? this.contact : undefined
  }
}
