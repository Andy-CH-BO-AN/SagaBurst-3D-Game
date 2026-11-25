import { Vector3 } from 'three'
import type { TownSiegeRampId } from '../campaign/MobileSiegeRampPolicy'
import type { TownGateId } from '../town/TownLayout'
import type { NPC } from '../world/NPC'
import { getTerrainHeight, type WalkRampSurface } from '../world/Terrain'
import { COMMANDER_CAVALRY_ESCORT, type CommanderCavalryEscortRampFrame } from './CommanderCavalryEscort'
import { commanderFourGateDefenseSlots } from './CommanderFourGateDefenseRoster'
import type { PersonalActorCheckpoint } from './CareerPersonalSquadMission'

/** Mission-only rear guard of one siege vehicle: ten T3 melee infantry, never Crew.
 * Rows start behind the last lancer row (6 + 3*4 + 4m body) so the two escorts never share a slot. */
export const COMMANDER_INFANTRY_ESCORT = {
  columns: 2,
  columnSpacing: 3,
  lateralOffset: COMMANDER_CAVALRY_ESCORT.lateralOffset,
  rowSpacing: 2.5,
  firstRowBehind: 22,
  /** Complete reserved rear envelope: last row (32m) plus body radius and margin. */
  requiredRearClearance: 36,
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
  return commanderFourGateDefenseSlots(missionId).filter(slot => slot.role === 'infantry').map(slot => ({
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

/** Four exterior columns per carrier, beside the existing lancers and infantry. */
export function commanderInfantryWingTarget(slot: number, side: -1 | 1, rear: { x: number; z: number }, inward: { x: number; z: number }) {
  const columns = 4, spacing = 2.6
  const lateral = -side * (8 + slot % columns * spacing)
  const behind = 16 + Math.floor(slot / columns) * spacing
  return { x: rear.x - inward.x * behind + inward.z * lateral,
    z: rear.z - inward.z * behind - inward.x * lateral }
}

type InfantryEscortBody = Pick<NPC, 'dead' | 'missionMovement' | 'formationCommandId' | 'formationDestination'
  | 'assignFormationTarget' | 'refreshFormationTarget' | 'setTacticalOrder' | 'setMissionCombatTarget'>
interface InfantryEscortRamp {
  assignment: { side: -1 | 1 }
  surface: Pick<WalkRampSurface, 'startX' | 'startZ' | 'dirX' | 'dirZ'>
  controller: { assigned: boolean; distance: number; currentSpeed: number }
}

export function moveCommanderInfantryEscort(npc: InfantryEscortBody, ramp: InfantryEscortRamp, target: { x: number; z: number },
  commandId: number, arrivalOrder?: 'defend'): void {
  const current = npc.formationDestination
  if (current && npc.formationCommandId === commandId
    && Math.hypot(current.x - target.x, current.z - target.z) < COMMANDER_INFANTRY_ESCORT.retargetDistance) return
  const position = new Vector3(target.x, getTerrainHeight(target.x, target.z), target.z)
  const facing = new Vector3(ramp.surface.dirX, 0, ramp.surface.dirZ)
  const speed = Math.max(.1, ramp.controller.currentSpeed)
  if (!npc.refreshFormationTarget(commandId, position, facing, speed, arrivalOrder)) {
    npc.assignFormationTarget(commandId, position, facing, speed, arrivalOrder)
  }
}

const WING_ESCORT_COMMAND = -5200

/** Reinforcements share their carrier's march but have their own formation and release. */
export class CommanderInfantryWings {
  private readonly wings = new Map<TownSiegeRampId, { members: Map<string, number>; lastTravelDistance?: number }>()
  private readonly escortIds = new Set<string>()

  has(id: string): boolean { return this.escortIds.has(id) }

  enlist(rampId: TownSiegeRampId, id: string, slot: number, saved?: Pick<PersonalActorCheckpoint, 'order' | 'formation'>): void {
    if (saved && saved.order !== 'defend' && saved.formation?.commandId !== WING_ESCORT_COMMAND) return
    let wing = this.wings.get(rampId)
    if (!wing) this.wings.set(rampId, wing = { members: new Map() })
    wing.members.set(id, slot); this.escortIds.add(id)
  }

  update<Actor extends InfantryEscortBody>(ramps: ReadonlyMap<TownSiegeRampId, InfantryEscortRamp>,
    actor: (id: string) => Actor | undefined, resume: (npc: Actor, rampId: TownSiegeRampId) => void): void {
    for (const [rampId, wing] of this.wings) {
      const ramp = ramps.get(rampId)!, { surface } = ramp
      const { assigned, distance } = ramp.controller
      if (assigned && wing.lastTravelDistance !== undefined
        && distance - wing.lastTravelDistance < COMMANDER_INFANTRY_ESCORT.retargetDistance) continue
      wing.lastTravelDistance = distance
      const rear = { x: surface.startX, z: surface.startZ }, inward = { x: surface.dirX, z: surface.dirZ }
      for (const [id, slot] of wing.members) {
        const npc = actor(id)
        if (!assigned) this.escortIds.delete(id)
        if (!npc || npc.dead) continue
        if (assigned) {
          const target = commanderInfantryWingTarget(slot, ramp.assignment.side, rear, inward)
          npc.missionMovement = true // Incoming hits must not cancel a march order.
          moveCommanderInfantryEscort(npc, ramp, target, WING_ESCORT_COMMAND)
        } else {
          npc.missionMovement = false; npc.setMissionCombatTarget(undefined); npc.setTacticalOrder('charge')
          resume(npc, rampId)
        }
      }
      if (!assigned) this.wings.delete(rampId)
    }
  }

  clear(): void { this.wings.clear(); this.escortIds.clear() }
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
