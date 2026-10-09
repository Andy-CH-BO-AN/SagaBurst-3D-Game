import type { CharacterFaction } from '../world/CharacterVisuals'
import type { CombatActorRef } from '../combat/CombatAttribution'
import { emptyPersonalContribution, type PersonalCombatContribution } from '../combat/CommandMerit'
import { clonePersonalMission, type PersonalActorCheckpoint, type PersonalActorPosition } from './CareerPersonalSquadMission'
import { parseFallingRiderSnapshot } from '../movement/FallingRider'
import { parseEagleFlightSnapshot } from '../movement/EagleFlightController'
import type { TacticalOrder } from '../battle/TacticalOrder'

/** Saved membership, rather than shared faction or soldier appearance, grants command and merit. */
export interface OfficialCommandAuthority {
  type: 'mission-official' | 'town-command'
  missionId?: string
  townFaction: CharacterFaction
  squadId: 1
  actorIds: string[]
  contribution: PersonalCombatContribution
  members?: Record<string, PersonalActorCheckpoint>
}

export interface TownCommandSquadState extends OfficialCommandAuthority {
  type: 'town-command'
  state: 'TRAINING' | 'FOLLOWING' | 'RETURNING'
  authorized: boolean
  sceneKey: string
}

const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonnegative = (value: unknown): number => finite(value) ? Math.max(0, value) : 0
const orders: readonly TacticalOrder[] = ['follow', 'attack', 'charge', 'defend', 'formation']
function parsePosition(value: unknown): PersonalActorPosition | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<PersonalActorPosition>
  return finite(raw.x) && finite(raw.z) && finite(raw.yaw)
    ? { x: raw.x, z: raw.z, yaw: raw.yaw, ...(finite(raw.y) ? { y: raw.y } : {}) } : undefined
}

/** Official actor IDs use the same actor state schema without HR membership restrictions. */
export function parseCommandActorCheckpoint(value: unknown): PersonalActorCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<PersonalActorCheckpoint>
  const status = raw.status && ['reserve', 'deployed', 'dead', 'exited'].includes(raw.status) ? raw.status : 'reserve'
  const point = parsePosition(raw.position)
  const mountPoint = parsePosition(raw.mount?.position)
  const formationPoint = parsePosition(raw.formation?.position)
  const fall = parseFallingRiderSnapshot(raw.fall)
  const flight = parseEagleFlightSnapshot(raw.mount?.flight)
  return { status,
    ...(point ? { position: point } : {}),
    ...(finite(raw.hp) ? { hp: nonnegative(raw.hp) } : {}),
    ...(raw.boarding === true ? { boarding: true } : {}),
    ...(typeof raw.eaglePadId === 'string' && raw.eaglePadId.length <= 100 ? { eaglePadId: raw.eaglePadId } : {}),
    ...(fall ? { fall } : {}),
    ...(finite(raw.ammo) ? { ammo: Math.floor(nonnegative(raw.ammo)) } : {}),
    ...(finite(raw.shieldImpact) ? { shieldImpact: nonnegative(raw.shieldImpact) } : {}),
    ...(raw.order && orders.includes(raw.order) ? { order: raw.order } : {}),
    ...(mountPoint && finite(raw.mount?.hp) ? { mount: { hp: nonnegative(raw.mount.hp), mounted: raw.mount.mounted === true,
      position: mountPoint, ...(flight ? { flight } : {}) } } : {}),
    ...(formationPoint && finite(raw.formation?.commandId) ? { formation: {
      commandId: raw.formation.commandId, position: formationPoint, reached: raw.formation.reached === true,
      ...(finite(raw.formation.speedLimit) ? { speedLimit: nonnegative(raw.formation.speedLimit) } : {}),
      ...(raw.formation.arrivalOrder && orders.includes(raw.formation.arrivalOrder) ? { arrivalOrder: raw.formation.arrivalOrder } : {}),
    } } : {}),
  }
}

function parseMembers(ids: readonly string[], raw: unknown): Record<string, PersonalActorCheckpoint> {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const members: Record<string, PersonalActorCheckpoint> = {}
  for (const id of ids) {
    members[id] = parseCommandActorCheckpoint(value[id]) ?? { status: 'reserve' }
  }
  return members
}

export function parseOfficialCommandAuthority(value: unknown): OfficialCommandAuthority | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<OfficialCommandAuthority>
  if ((raw.type !== 'mission-official' && raw.type !== 'town-command') || raw.squadId !== 1
    || (raw.townFaction !== 'roman' && raw.townFaction !== 'viking')
    || !Array.isArray(raw.actorIds) || raw.actorIds.length > 100
    || !raw.actorIds.every(validId) || new Set(raw.actorIds).size !== raw.actorIds.length) return undefined
  const contribution = emptyPersonalContribution()
  for (const key of Object.keys(contribution) as (keyof PersonalCombatContribution)[]) {
    const amount = raw.contribution?.[key]
    contribution[key] = typeof amount === 'number' && Number.isFinite(amount) ? Math.max(0, amount) : 0
  }
  contribution.kills = Math.floor(contribution.kills)
  contribution.structuresDestroyed = Math.floor(contribution.structuresDestroyed)
  contribution.gateBreaches = Math.floor(contribution.gateBreaches)
  return { type: raw.type, squadId: 1, townFaction: raw.townFaction, actorIds: [...raw.actorIds], contribution,
    ...(validId(raw.missionId) ? { missionId: raw.missionId } : {}),
    ...(raw.members ? { members: parseMembers(raw.actorIds, raw.members) } : {}) }
}

export function parseTownCommandSquad(value: unknown): TownCommandSquadState | undefined {
  const authority = parseOfficialCommandAuthority(value)
  if (!authority || authority.type !== 'town-command') return undefined
  const raw = value as Partial<TownCommandSquadState>
  return { ...authority, type: 'town-command', authorized: raw.authorized === true,
    state: raw.state === 'FOLLOWING' || raw.state === 'RETURNING' ? raw.state : 'TRAINING',
    sceneKey: typeof raw.sceneKey === 'string' && raw.sceneKey.length <= 200 ? raw.sceneKey : 'town-home' }
}

export function cloneOfficialCommandAuthority<T extends OfficialCommandAuthority>(value: T): T {
  return { ...value, actorIds: [...value.actorIds], contribution: { ...value.contribution },
    ...(value.members ? { members: Object.fromEntries(Object.entries(value.members).map(([id, actor]) => {
      const alias = 'personal:checkpoint'
      return [id, clonePersonalMission({ squadId: 'personal', memberIds: [alias], sceneKey: '', state: 'ACTIVE',
        contribution: emptyPersonalContribution(), members: { [alias]: actor } }).members[alias]]
    })) } : {}) }
}

export function cloneTownCommandSquad(value: TownCommandSquadState): TownCommandSquadState {
  return cloneOfficialCommandAuthority(value)
}

/** Delayed attacks retain this accepted membership even after the shooter has died. */
export function officialMissionSourcePolicy(authority: OfficialCommandAuthority): (source: CombatActorRef) => boolean {
  const ids = new Set(authority.actorIds)
  return source => source.actorType === 'npc' && source.squadId === authority.squadId
    && source.ownership !== 'player-personal' && ids.has(source.actorId)
}
