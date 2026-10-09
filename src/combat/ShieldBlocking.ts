import * as THREE from 'three'
import { ARMORS } from '../rpg/ArmorDatabase'
import { WEAPONS } from '../rpg/WeaponDatabase'
import type { Mount } from '../world/Mount'

export const SHIELD_CONFIG = {
  axeImpactByTier: { 1: 2, 2: 4, 3: 8 },
  mountedLanceImpactByTier: { 1: 10, 2: 20, 3: 40 },
  xpPerBlockedImpact: 20,
} as const
export function weaponShieldImpact(id?: string, isMounted = false): number {
  const weapon = WEAPONS[id ?? '']
  if (weapon?.shieldImpact !== undefined) return weapon.shieldImpact
  if (!weapon || weapon.tier === 4) return 1
  if (weapon.animationKind === 'axe') return SHIELD_CONFIG.axeImpactByTier[weapon.tier]
  if (isMounted && weapon.combatKind === 'lance') return SHIELD_CONFIG.mountedLanceImpactByTier[weapon.tier]
  return 1
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
    this.shieldImpactMax = id && ARMORS[id] ? ARMORS[id].shieldImpactMax : 0
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

/** Segment queries in an existing proxy's local space; rotation and scale follow the proxy. */
export class LocalBoxCollider {
  private readonly inverse = new THREE.Matrix4()
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  constructor(private readonly proxy: THREE.Object3D, private readonly box: THREE.Box3) {}
  prepare(): void {
    this.proxy.updateWorldMatrix(true, false)
    this.inverse.copy(this.proxy.matrixWorld).invert()
  }
  preparedTime(from: THREE.Vector3, to: THREE.Vector3): number {
    this.a.copy(from).applyMatrix4(this.inverse)
    this.b.copy(to).applyMatrix4(this.inverse)
    return segmentBoxTime(this.a, this.b, this.box)
  }
}

// Measured 1.10m shield face, tapered bands exclude the pointed corners and rear grip.
const PALADIN_BANDS = [
  [-.54, -.45, .07], [-.45, -.35, .13], [-.35, -.25, .19], [-.25, -.15, .215],
  [-.15, -.05, .25], [-.05, .05, .255], [.05, .15, .26], [.15, .25, .295],
  [.25, .35, .31], [.35, .45, .195], [.45, .53, .055],
].map(([bottom, top, halfWidth]) => new THREE.Box3(
  new THREE.Vector3(-halfWidth, bottom, .13), new THREE.Vector3(halfWidth, top, .30)))

/** OBB in shield model space. Never reads triangles or traverses meshes. */
export class ShieldCollider {
  private readonly inverse = new THREE.Matrix4()
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly box = new THREE.Box3()
  private paladin = false
  constructor(private readonly pivot: THREE.Object3D, private readonly state: ShieldState) {}
  setModel(id: string | null): void {
    this.paladin = id === 'paladin_shield_t4'
    if (this.paladin) this.box.set(this.a.set(-.334, -.55, .123), this.b.set(.334, .55, .301))
    else if (id?.startsWith('scutum')) this.box.set(this.a.set(-.31, -.51, -.01), this.b.set(.31, .51, .25))
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
    const broad = segmentBoxTime(this.a, this.b, this.box)
    if (!this.paladin || !Number.isFinite(broad)) return broad
    let contact = Infinity
    for (const band of PALADIN_BANDS) contact = Math.min(contact, segmentBoxTime(this.a, this.b, band))
    return contact
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
  mount?: Mount | null
  currentMount?: Mount | null
  mountCollider?: LocalBoxCollider
}
export interface CombatContact { kind: 'shield' | 'body' | 'mount'; time: number; mount?: Mount; target?: PhysicalCombatTarget; attackSource?: 'xongkoro' }
const bodyBox = new THREE.Box3()
const bodyInverse = new THREE.Matrix4()
const bodyFrom = new THREE.Vector3()
const bodyTo = new THREE.Vector3()
// Shared synchronous scratch: sampled once per target query, not once per blade point.
const limbCenters = Array.from({ length: 6 }, () => new THREE.Vector3())
let limbCount = 0
let preparedMount: Mount | null = null
function prepareTarget(target: PhysicalCombatTarget): void {
  limbCount = Math.min(limbCenters.length, target.bodyHitNodes?.length ?? 0)
  for (let i = 0; i < limbCount; i++) target.bodyHitNodes![i].getWorldPosition(limbCenters[i])
  target.shieldCollider?.prepare()
  preparedMount = target.mountCollider ? target as Mount
    : target.isMounted ? target.mount ?? target.currentMount ?? null : null
  if (preparedMount?.dead || preparedMount?.disposed) preparedMount = null
  preparedMount?.mountCollider.prepare()
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
  if (target.mountCollider) return Infinity
  const p = target.group.position, base = p.y + (target.bodyBaseOffset ?? 0)
  let time: number
  if ((target.mount ?? target.currentMount)?.isFlyingMount) {
    target.group.updateWorldMatrix(true, false)
    bodyInverse.copy(target.group.matrixWorld).invert()
    bodyBox.min.set(-.3, (target.bodyBaseOffset ?? 0) + .06, -.3)
    bodyBox.max.set(.3, (target.bodyBaseOffset ?? 0) + 1.8, .3)
    time = segmentBoxTime(bodyFrom.copy(from).applyMatrix4(bodyInverse), bodyTo.copy(to).applyMatrix4(bodyInverse), bodyBox)
  } else {
    bodyBox.min.set(p.x - .3, base + .06, p.z - .3)
    bodyBox.max.set(p.x + .3, base + 1.8, p.z + .3)
    time = segmentBoxTime(from, to, bodyBox)
  }
  // Small bone-following primitives include outstretched arms/hands and moving feet.
  for (let i = 0; i < limbCount; i++) time = Math.min(time, segmentSphereTime(from, to, limbCenters[i], .12))
  return time
}
/** First contact only; a tie belongs to body, never magical shield mitigation. */
export function traceCombatSegment(target: PhysicalCombatTarget, from: THREE.Vector3, to: THREE.Vector3, out: CombatContact, prepared = false): boolean {
  if (!prepared) prepareTarget(target)
  const body = bodyTime(target, from, to), shield = target.shieldCollider?.preparedTime(from, to) ?? Infinity
  const mount = preparedMount?.mountCollider.preparedTime(from, to) ?? Infinity
  out.time = Math.min(body, shield, mount)
  out.kind = mount < body && mount <= shield ? 'mount' : shield < body ? 'shield' : 'body'
  out.mount = out.kind === 'mount' ? preparedMount ?? undefined : undefined
  out.target = target
  out.attackSource = undefined
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
  private readonly best: CombatContact = { kind: 'body', time: Infinity }
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
        this.contact.mount = this.candidate.mount
        this.contact.target = this.candidate.target
      }
    }
    if (Number.isFinite(this.contact.time)) return this.contact
    return traceCombatSegment(target, this.grip, this.tip, this.contact, true) ? this.contact : undefined
  }
  /** One consumed attack: compare the intended bodies with every nearby independent mount. */
  traceFirst(targets: readonly PhysicalCombatTarget[], mounts: readonly Mount[] = [], ownMount?: Mount | null): CombatContact | undefined {
    this.best.time = Infinity
    for (const target of targets) {
      const contact = this.trace(target)
      if (contact && contact.time < this.best.time) Object.assign(this.best, contact)
    }
    for (const mount of mounts) {
      if (mount.dead || mount.disposed || mount === ownMount
        || mount.riderNpc && targets.includes(mount.riderNpc)
        || mount.riderPlayer && targets.includes(mount.riderPlayer)) continue
      const contact = this.trace(mount)
      if (contact && contact.time < this.best.time) Object.assign(this.best, contact)
    }
    if (!Number.isFinite(this.best.time)) return undefined
    Object.assign(this.contact, this.best)
    return this.contact
  }
}
