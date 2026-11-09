import type { TownSiegeRampId } from '../campaign/MobileSiegeRampPolicy'
import type { TownGateId } from '../town/TownLayout'
import { COMMANDER_CAVALRY_ESCORT, type CommanderCavalryEscortRampFrame } from './CommanderCavalryEscort'
import { commanderFourGateDefenseSlots } from './CommanderFourGateDefenseRoster'

/** Mission-only rear guard of one siege vehicle: ten T3 melee infantry, never Crew.
 * Rows start behind the last lancer row (6 + 3*4 + 4m body) so the two escorts never share a slot. */
export const COMMANDER_INFANTRY_ESCORT = {
  columns: 2,
  columnSpacing: 3,
  lateralOffset: COMMANDER_CAVALRY_ESCORT.lateralOffset,
  rowSpacing: 3,
  firstRowBehind: 24,
  /** Complete reserved rear envelope: last row (36m) plus body radius and margin. */
  requiredRearClearance: 40,
  halfWidth: 4,
  bodyRadius: 1,
  /** Target must move this far before the navigation path is rebuilt. */
  retargetDistance: 1,
} as const

export interface CommanderInfantryEscortAssignment {
  actorId: string
  gateId: TownGateId
  side: -1 | 1
  /** Fixed slot 0..9 within the vehicle's group; deaths never close ranks. */
  slot: number
  rampId: TownSiegeRampId
}
export type CommanderInfantryEscortReleaseReason = 'ramp-docked' | 'ramp-destroyed' | 'ramp-abandoned'
  | 'no-pushers' | 'stalled' | 'group-dead'
export interface CommanderInfantryEscortActor {
  gateId: TownGateId
  side: -1 | 1
  slot: number
  mode: 'escort' | 'released'
}
export interface CommanderInfantryEscortGroup {
  lastProgressDistance: number
  stallSeconds: number
  releaseReason?: CommanderInfantryEscortReleaseReason
}
export interface CommanderInfantryEscortCheckpoint {
  version: 1
  actors: Record<string, CommanderInfantryEscortActor>
  groups: Record<TownSiegeRampId, CommanderInfantryEscortGroup>
}
export interface CommanderInfantryEscortActorFrame { dead: boolean }

const rampId = (gateId: TownGateId, side: -1 | 1): TownSiegeRampId => `town-siege-ramp:${gateId}:${side < 0 ? 'left' : 'right'}`

/** Identity comes from the authored slot id, never from NPC array order or saved casualties. */
export function commanderInfantryEscortAssignments(missionId: string): CommanderInfantryEscortAssignment[] {
  return commanderFourGateDefenseSlots(missionId, 2).filter(slot => slot.role === 'infantry').map(slot => ({
    actorId: slot.actorId, gateId: slot.gateId, side: slot.side!, slot: slot.slot - 1, rampId: rampId(slot.gateId, slot.side!) }))
}

export function createCommanderInfantryEscort(missionId: string): CommanderInfantryEscortCheckpoint {
  const assignments = commanderInfantryEscortAssignments(missionId)
  return { version: 1,
    actors: Object.fromEntries(assignments.map(({ actorId, gateId, side, slot }) => [actorId, { gateId, side, slot, mode: 'escort' }])),
    groups: Object.fromEntries(assignments.map(({ rampId }) => [rampId, { lastProgressDistance: 0, stallSeconds: 0 }])) as CommanderInfantryEscortCheckpoint['groups'],
  }
}

export function isCommanderInfantryEscorting(checkpoint: CommanderInfantryEscortCheckpoint | undefined, actorId: string): boolean {
  return checkpoint?.actors[actorId]?.mode === 'escort'
}

/** Two columns behind the cavalry rows; relative to the live vehicle tail and its inward heading. */
export function commanderInfantryEscortTarget(slot: number, rear: { x: number; z: number }, inward: { x: number; z: number }): { x: number; z: number; yaw: number } {
  const lateral = (slot % COMMANDER_INFANTRY_ESCORT.columns - .5) * COMMANDER_INFANTRY_ESCORT.columnSpacing + COMMANDER_INFANTRY_ESCORT.lateralOffset
  const behind = COMMANDER_INFANTRY_ESCORT.firstRowBehind + Math.floor(slot / COMMANDER_INFANTRY_ESCORT.columns) * COMMANDER_INFANTRY_ESCORT.rowSpacing
  return { x: rear.x - inward.x * behind + inward.z * lateral,
    z: rear.z - inward.z * behind - inward.x * lateral, yaw: Math.atan2(inward.x, inward.z) }
}

/** Pure and monotonic like the cavalry owner. Unlike it, there is no range release: the guard
 * stays with its vehicle until DOCKED (or until the vehicle can no longer deliver them). */
export function advanceCommanderInfantryEscort(checkpoint: CommanderInfantryEscortCheckpoint, dt: number,
  actors: ReadonlyMap<string, CommanderInfantryEscortActorFrame>, ramps: ReadonlyMap<TownSiegeRampId, CommanderCavalryEscortRampFrame>): {
    checkpoint: CommanderInfantryEscortCheckpoint; releasedActorIds: string[]
  } {
  if (!Number.isFinite(dt) || dt < 0) return { checkpoint, releasedActorIds: [] }
  let next = checkpoint
  const releasedActorIds: string[] = []
  for (const [id, group] of Object.entries(checkpoint.groups) as [TownSiegeRampId, CommanderInfantryEscortGroup][]) {
    if (group.releaseReason) continue
    const members = Object.entries(checkpoint.actors).filter(([, actor]) => rampId(actor.gateId, actor.side) === id)
    const ramp = ramps.get(id)
    let reason: CommanderInfantryEscortReleaseReason | undefined
    if (members.every(([actorId]) => actors.get(actorId)?.dead === true)) reason = 'group-dead'
    else if (ramp?.state === 'DOCKED') reason = 'ramp-docked'
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
const reasons: readonly CommanderInfantryEscortReleaseReason[] = ['ramp-docked', 'ramp-destroyed', 'ramp-abandoned', 'no-pushers', 'stalled', 'group-dead']

/** Exact 80 actors/eight groups, bounded progress, and immutable authored ownership. */
export function parseCommanderInfantryEscort(value: unknown, missionId: string): CommanderInfantryEscortCheckpoint | undefined {
  if (!record(value) || value.version !== 1 || Object.keys(value).length !== 3
    || !record(value.actors) || Object.keys(value.actors).length !== 80
    || !record(value.groups) || Object.keys(value.groups).length !== 8
    || !/^[A-Za-z0-9:_-]{1,200}$/.test(missionId) || ['__proto__', 'prototype', 'constructor'].includes(missionId)) return undefined
  const result = createCommanderInfantryEscort(missionId)
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
      || group.releaseReason !== undefined && !reasons.includes(group.releaseReason as CommanderInfantryEscortReleaseReason)) return undefined
    const members = Object.values(result.actors).filter(actor => rampId(actor.gateId, actor.side) === id)
    const released = group.releaseReason !== undefined
    if (members.some(actor => (actor.mode === 'released') !== released)
      || !released && group.stallSeconds >= COMMANDER_CAVALRY_ESCORT.stallSeconds
      || group.releaseReason === 'stalled' && group.stallSeconds !== COMMANDER_CAVALRY_ESCORT.stallSeconds) return undefined
    result.groups[id] = { lastProgressDistance: group.lastProgressDistance, stallSeconds: group.stallSeconds,
      ...(released ? { releaseReason: group.releaseReason as CommanderInfantryEscortReleaseReason } : {}) }
  }
  return result
}
