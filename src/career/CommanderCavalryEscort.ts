import type { MobileSiegeRampState } from '../campaign/MobileSiegeRampController'
import type { TownSiegeRampId } from '../campaign/MobileSiegeRampPolicy'
import { TOWN_GATES, townGatePoint, type TownGateId } from '../town/TownLayout'
import { commanderFourGateDefenseSlots } from './CommanderFourGateDefenseRoster'

/** Mission-only ground escort geometry; mounted movement/collision remains with the actor. */
export const COMMANDER_CAVALRY_ESCORT = {
  releaseDistance: 50,
  stallSeconds: 20,
  progressDistance: .5,
  columnSpacing: 4,
  lateralOffset: -.5,
  rowSpacing: 4,
  firstRowBehind: 6,
  requiredRearClearance: 20,
  worldEdgeRearMargin: 22,
  halfWidth: 4,
  bodyRadius: 2,
} as const

export interface CommanderCavalryEscortAssignment {
  actorId: string
  gateId: TownGateId
  side: -1 | 1
  /** Fixed slot within the original seven/eight-person group; deaths never close ranks. */
  slot: number
  rampId: TownSiegeRampId
}
export type CommanderCavalryEscortReleaseReason = 'gate-range' | 'ramp-destroyed' | 'ramp-abandoned'
  | 'no-pushers' | 'stalled' | 'group-dead'
export interface CommanderCavalryEscortActor {
  gateId: TownGateId
  side: -1 | 1
  slot: number
  mode: 'escort' | 'released'
}
export interface CommanderCavalryEscortGroup {
  /** The last distance that crossed the progress threshold, not a frame-local sample. */
  lastProgressDistance: number
  stallSeconds: number
  releaseReason?: CommanderCavalryEscortReleaseReason
}
export interface CommanderCavalryEscortCheckpoint {
  version: 1
  actors: Record<string, CommanderCavalryEscortActor>
  groups: Record<TownSiegeRampId, CommanderCavalryEscortGroup>
}
export interface CommanderCavalryEscortActorFrame {
  dead: boolean
  position: { x: number; z: number }
}
export interface CommanderCavalryEscortRampFrame {
  state: MobileSiegeRampState
  /** Live front/deck anchor; escorts leave before the trailing formation reaches the gate. */
  position: { x: number; z: number }
  distance: number
  alivePushers: number
}

const rampId = (gateId: TownGateId, side: -1 | 1): TownSiegeRampId => `town-siege-ramp:${gateId}:${side < 0 ? 'left' : 'right'}`

/** Authored lancer identities are independent of NPC array order and restored casualties. */
export function commanderCavalryEscortAssignments(missionId: string): CommanderCavalryEscortAssignment[] {
  return commanderFourGateDefenseSlots(missionId).filter(slot => slot.role === 'lancer').map(slot => {
    const side = slot.slot <= 7 ? -1 : 1
    return { actorId: slot.actorId, gateId: slot.gateId, side, slot: slot.slot - (side < 0 ? 1 : 8),
      rampId: rampId(slot.gateId, side) }
  })
}

export function createCommanderCavalryEscort(missionId: string): CommanderCavalryEscortCheckpoint {
  const assignments = commanderCavalryEscortAssignments(missionId)
  return { version: 1,
    actors: Object.fromEntries(assignments.map(({ actorId, gateId, side, slot }) => [actorId, { gateId, side, slot, mode: 'escort' }])),
    groups: Object.fromEntries(assignments.map(({ rampId }) => [rampId, { lastProgressDistance: 0, stallSeconds: 0 }])) as CommanderCavalryEscortCheckpoint['groups'],
  }
}

/** Undefined is the released legacy ATTACKING path; never create a new group during restore. */
export function isCommanderCavalryEscorting(checkpoint: CommanderCavalryEscortCheckpoint | undefined, actorId: string): boolean {
  return checkpoint?.actors[actorId]?.mode === 'escort'
}

/** Actual moving tail, rather than its dock or a fixed gate waypoint. No platform ownership is assigned. */
export function commanderCavalryEscortTarget(slot: number, rear: { x: number; z: number }, inward: { x: number; z: number }): { x: number; z: number; yaw: number } {
  const lateral = (slot % 2 - .5) * COMMANDER_CAVALRY_ESCORT.columnSpacing + COMMANDER_CAVALRY_ESCORT.lateralOffset
  const behind = COMMANDER_CAVALRY_ESCORT.firstRowBehind + Math.floor(slot / 2) * COMMANDER_CAVALRY_ESCORT.rowSpacing
  return { x: rear.x - inward.x * behind + inward.z * lateral,
    z: rear.z - inward.z * behind - inward.x * lateral, yaw: Math.atan2(inward.x, inward.z) }
}

/** Pure, monotonic transition. Missing actors cannot be mistaken for a dead group.
 * All fallback clocks consume active-play dt and survive reload. Forward progress of
 * at least 0.5m resets the 20s clock; reversing or jitter cannot keep an escort stuck. */
export function advanceCommanderCavalryEscort(checkpoint: CommanderCavalryEscortCheckpoint, dt: number,
  actors: ReadonlyMap<string, CommanderCavalryEscortActorFrame>, ramps: ReadonlyMap<TownSiegeRampId, CommanderCavalryEscortRampFrame>): {
    checkpoint: CommanderCavalryEscortCheckpoint; releasedActorIds: string[]
  } {
  if (!Number.isFinite(dt) || dt < 0) return { checkpoint, releasedActorIds: [] }
  let next = checkpoint
  const releasedActorIds: string[] = []
  for (const [id, group] of Object.entries(checkpoint.groups) as [TownSiegeRampId, CommanderCavalryEscortGroup][]) {
    if (group.releaseReason) continue
    const members = Object.entries(checkpoint.actors).filter(([, actor]) => rampId(actor.gateId, actor.side) === id)
    const living = members.filter(([actorId]) => actors.has(actorId) && !actors.get(actorId)!.dead)
    const gate = TOWN_GATES.find(gate => gate.id === members[0][1].gateId)!
    const gatePoint = townGatePoint(gate, 0, 0), ramp = ramps.get(id)
    let reason: CommanderCavalryEscortReleaseReason | undefined
    if (living.length > 0 && (ramp && Math.hypot(ramp.position.x - gatePoint.x, ramp.position.z - gatePoint.z)
      <= COMMANDER_CAVALRY_ESCORT.releaseDistance || living.some(([actorId]) => {
      const position = actors.get(actorId)!.position
      return Math.hypot(position.x - gatePoint.x, position.z - gatePoint.z) <= COMMANDER_CAVALRY_ESCORT.releaseDistance
    }))) reason = 'gate-range'
    else if (members.every(([actorId]) => actors.get(actorId)?.dead === true)) reason = 'group-dead'
    else if (ramp?.state === 'DESTROYED') reason = 'ramp-destroyed'
    else if (ramp?.state === 'ABANDONED') reason = 'ramp-abandoned'
    else if (ramp?.alivePushers === 0) reason = 'no-pushers'

    let lastProgressDistance = group.lastProgressDistance, stallSeconds = group.stallSeconds
    if (!reason && ramp) {
      if (ramp.distance - lastProgressDistance >= COMMANDER_CAVALRY_ESCORT.progressDistance) {
        lastProgressDistance = ramp.distance; stallSeconds = 0
      } else {
        stallSeconds = Math.min(COMMANDER_CAVALRY_ESCORT.stallSeconds, stallSeconds + dt)
        if (COMMANDER_CAVALRY_ESCORT.stallSeconds - stallSeconds < 1e-9) stallSeconds = COMMANDER_CAVALRY_ESCORT.stallSeconds
      }
      if (stallSeconds >= COMMANDER_CAVALRY_ESCORT.stallSeconds) reason = 'stalled'
    }
    if (!reason && lastProgressDistance === group.lastProgressDistance && stallSeconds === group.stallSeconds) continue
    if (next === checkpoint) next = { version: 1, actors: { ...checkpoint.actors }, groups: { ...checkpoint.groups } }
    next.groups[id] = { lastProgressDistance, stallSeconds, ...(reason ? { releaseReason: reason } : {}) }
    if (!reason) continue
    for (const [actorId, actor] of members) {
      if (actor.mode === 'released') continue
      next.actors[actorId] = { ...actor, mode: 'released' }
      releasedActorIds.push(actorId)
    }
  }
  return { checkpoint: next, releasedActorIds }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown, maximum: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
const reasons: readonly CommanderCavalryEscortReleaseReason[] = ['gate-range', 'ramp-destroyed', 'ramp-abandoned', 'no-pushers', 'stalled', 'group-dead']

/** Exact 60 actors/eight groups, bounded progress, and immutable authored ownership. */
export function parseCommanderCavalryEscort(value: unknown, missionId: string): CommanderCavalryEscortCheckpoint | undefined {
  if (!record(value) || value.version !== 1 || Object.keys(value).length !== 3
    || !record(value.actors) || Object.keys(value.actors).length !== 60
    || !record(value.groups) || Object.keys(value.groups).length !== 8
    || !/^[A-Za-z0-9:_-]{1,200}$/.test(missionId) || ['__proto__', 'prototype', 'constructor'].includes(missionId)) return undefined
  const result = createCommanderCavalryEscort(missionId)
  for (const [id, expected] of Object.entries(result.actors)) {
    const actor = value.actors[id]
    if (!Object.prototype.hasOwnProperty.call(value.actors, id) || !record(actor) || Object.keys(actor).length !== 4
      || actor.gateId !== expected.gateId || actor.side !== expected.side || actor.slot !== expected.slot
      || actor.mode !== 'escort' && actor.mode !== 'released') return undefined
    result.actors[id] = { ...expected, mode: actor.mode }
  }
  for (const id of Object.keys(result.groups) as TownSiegeRampId[]) {
    const group = value.groups[id]
    if (!Object.prototype.hasOwnProperty.call(value.groups, id) || !record(group)
      || Object.keys(group).some(key => !['lastProgressDistance', 'stallSeconds', 'releaseReason'].includes(key))
      || !finite(group.lastProgressDistance, 700) || !finite(group.stallSeconds, COMMANDER_CAVALRY_ESCORT.stallSeconds)
      || group.releaseReason !== undefined && !reasons.includes(group.releaseReason as CommanderCavalryEscortReleaseReason)) return undefined
    const members = Object.values(result.actors).filter(actor => rampId(actor.gateId, actor.side) === id)
    const released = group.releaseReason !== undefined
    if (members.some(actor => (actor.mode === 'released') !== released)
      || !released && group.stallSeconds >= COMMANDER_CAVALRY_ESCORT.stallSeconds
      || group.releaseReason === 'stalled' && group.stallSeconds !== COMMANDER_CAVALRY_ESCORT.stallSeconds) return undefined
    result.groups[id] = { lastProgressDistance: group.lastProgressDistance, stallSeconds: group.stallSeconds,
      ...(released ? { releaseReason: group.releaseReason as CommanderCavalryEscortReleaseReason } : {}) }
  }
  return result
}
