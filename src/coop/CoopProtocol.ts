/**
 * Wire format shared by host and guest. Control messages are JSON; the 20 Hz
 * world snapshot is binary so a few hundred actors stay well under LAN budgets.
 */
import type { CombatAction } from '../world/CharacterCombatAnimator'

export const COOP_PROTOCOL_VERSION = 1
export const COOP_SNAPSHOT_HZ = 20
export const COOP_NO_ID = 0xffff

/** Animator actions in a fixed order; index is the wire value. */
export const COOP_ACTIONS: readonly CombatAction[] = [
  'idle', 'daggerSlash', 'swordSlash', 'axeAttack1H', 'axeAttack2H', 'greatswordSlash',
  'bowAim', 'bowRelease', 'pilumThrow', 'lanceThrust', 'mountedLance', 'punchCombo', 'punchRight',
]
const ACTION_INDEX = new Map(COOP_ACTIONS.map((action, index) => [action, index]))
export function encodeAction(action: CombatAction): number { return ACTION_INDEX.get(action) ?? 0 }
export function decodeAction(value: number): CombatAction { return COOP_ACTIONS[value] ?? 'idle' }

export const ACTOR_DEAD = 1, ACTOR_RANGED = 2, ACTOR_SHIELD = 4, ACTOR_SPRINT = 8, ACTOR_HIDDEN = 16
/** Players only: weapons put away (an NPC's own visibility rules apply otherwise). */
export const ACTOR_MELEE_STOWED = 32, ACTOR_SHIELD_STOWED = 64
export const MOUNT_DEAD = 1, MOUNT_AIRBORNE = 2, MOUNT_HIDDEN = 4

export interface CoopActorFrame {
  id: number
  x: number; y: number; z: number
  yaw: number
  speed: number
  action: CombatAction
  flags: number
  /** 0..1 bow draw while aiming. */
  draw: number
  hp: number
  /** COOP_NO_ID when on foot. */
  mountId: number
}

export interface CoopMountFrame {
  id: number
  x: number; y: number; z: number
  yaw: number
  pitch: number
  speed: number
  flags: number
  hp: number
}

export interface CoopSnapshot {
  time: number
  guestHp: number
  guestMaxHp: number
  actors: CoopActorFrame[]
  mounts: CoopMountFrame[]
}

const SNAPSHOT_TAG = 1
const HEADER_BYTES = 1 + 4 + 4 + 4 + 2 + 2
const ACTOR_BYTES = 2 + 12 + 2 + 2 + 1 + 1 + 1 + 2 + 2
const MOUNT_BYTES = 2 + 12 + 2 + 2 + 2 + 1 + 2
const ANGLE_SCALE = 10000

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}
const clampU16 = (value: number): number => Math.max(0, Math.min(0xffff, Math.round(value)))
const angleI16 = (angle: number): number => Math.round(wrapAngle(Number.isFinite(angle) ? angle : 0) * ANGLE_SCALE)

export function encodeSnapshot(snapshot: CoopSnapshot): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + snapshot.actors.length * ACTOR_BYTES + snapshot.mounts.length * MOUNT_BYTES)
  const view = new DataView(bytes.buffer)
  let o = 0
  view.setUint8(o, SNAPSHOT_TAG); o += 1
  view.setFloat32(o, snapshot.time, true); o += 4
  view.setFloat32(o, snapshot.guestHp, true); o += 4
  view.setFloat32(o, snapshot.guestMaxHp, true); o += 4
  view.setUint16(o, snapshot.actors.length, true); o += 2
  view.setUint16(o, snapshot.mounts.length, true); o += 2
  for (const a of snapshot.actors) {
    view.setUint16(o, a.id, true); o += 2
    view.setFloat32(o, a.x, true); view.setFloat32(o + 4, a.y, true); view.setFloat32(o + 8, a.z, true); o += 12
    view.setInt16(o, angleI16(a.yaw), true); o += 2
    view.setUint16(o, clampU16(a.speed * 100), true); o += 2
    view.setUint8(o, encodeAction(a.action)); o += 1
    view.setUint8(o, a.flags & 0xff); o += 1
    view.setUint8(o, Math.max(0, Math.min(255, Math.round(a.draw * 255)))); o += 1
    view.setUint16(o, clampU16(a.hp * 10), true); o += 2
    view.setUint16(o, a.mountId, true); o += 2
  }
  for (const m of snapshot.mounts) {
    view.setUint16(o, m.id, true); o += 2
    view.setFloat32(o, m.x, true); view.setFloat32(o + 4, m.y, true); view.setFloat32(o + 8, m.z, true); o += 12
    view.setInt16(o, angleI16(m.yaw), true); o += 2
    view.setInt16(o, angleI16(m.pitch), true); o += 2
    view.setUint16(o, clampU16(m.speed * 100), true); o += 2
    view.setUint8(o, m.flags & 0xff); o += 1
    view.setUint16(o, clampU16(m.hp * 10), true); o += 2
  }
  return bytes
}

/** Returns null for any frame that is not a complete snapshot. */
export function decodeSnapshot(bytes: Uint8Array): CoopSnapshot | null {
  if (bytes.byteLength < HEADER_BYTES) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let o = 0
  if (view.getUint8(o) !== SNAPSHOT_TAG) return null
  o += 1
  const time = view.getFloat32(o, true); o += 4
  const guestHp = view.getFloat32(o, true); o += 4
  const guestMaxHp = view.getFloat32(o, true); o += 4
  const actorCount = view.getUint16(o, true); o += 2
  const mountCount = view.getUint16(o, true); o += 2
  if (bytes.byteLength !== HEADER_BYTES + actorCount * ACTOR_BYTES + mountCount * MOUNT_BYTES) return null
  const actors: CoopActorFrame[] = []
  for (let i = 0; i < actorCount; i++) {
    const id = view.getUint16(o, true); o += 2
    const x = view.getFloat32(o, true), y = view.getFloat32(o + 4, true), z = view.getFloat32(o + 8, true); o += 12
    const yaw = view.getInt16(o, true) / ANGLE_SCALE; o += 2
    const speed = view.getUint16(o, true) / 100; o += 2
    const action = decodeAction(view.getUint8(o)); o += 1
    const flags = view.getUint8(o); o += 1
    const draw = view.getUint8(o) / 255; o += 1
    const hp = view.getUint16(o, true) / 10; o += 2
    const mountId = view.getUint16(o, true); o += 2
    actors.push({ id, x, y, z, yaw, speed, action, flags, draw, hp, mountId })
  }
  const mounts: CoopMountFrame[] = []
  for (let i = 0; i < mountCount; i++) {
    const id = view.getUint16(o, true); o += 2
    const x = view.getFloat32(o, true), y = view.getFloat32(o + 4, true), z = view.getFloat32(o + 8, true); o += 12
    const yaw = view.getInt16(o, true) / ANGLE_SCALE; o += 2
    const pitch = view.getInt16(o, true) / ANGLE_SCALE; o += 2
    const speed = view.getUint16(o, true) / 100; o += 2
    const flags = view.getUint8(o); o += 1
    const hp = view.getUint16(o, true) / 10; o += 2
    mounts.push({ id, x, y, z, yaw, pitch, speed, flags, hp })
  }
  return { time, guestHp, guestMaxHp, actors, mounts }
}

/** Shortest signed turn from `from` to `to`. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from)
}

/** Allocates small integer wire IDs per object, reusing none within a session. */
export class CoopIdRegistry<T extends object> {
  private readonly ids = new WeakMap<T, number>()
  private next = 1

  idOf(item: T): number | undefined { return this.ids.get(item) }

  ensure(item: T): { id: number; created: boolean } {
    const existing = this.ids.get(item)
    if (existing !== undefined) return { id: existing, created: false }
    // 0xffff is the "no id" marker; the wire field is u16.
    if (this.next >= COOP_NO_ID) this.next = 1
    const id = this.next++
    this.ids.set(item, id)
    return { id, created: true }
  }
}
