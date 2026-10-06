import { PERSONAL_SQUAD_ID } from '../battle/CommandTarget'
import type { TacticalOrder } from '../battle/TacticalOrder'
import type { CombatActorRef } from '../combat/CombatAttribution'
import { emptyPersonalContribution, type PersonalCombatContribution } from '../combat/CommandMerit'
export { emptyPersonalContribution, mergePersonalMerit, type PersonalCombatContribution } from '../combat/CommandMerit'
import type { CareerProfile } from './CareerProfile'
import { PERSONAL_SQUAD_LIMIT } from './CareerPersonalSquad'

export type PersonalSquadState = 'RESERVE' | 'DEPLOYING' | 'ACTIVE' | 'RETURNING'
export interface PersonalActorPosition { x: number; z: number; yaw: number }
export interface PersonalActorCheckpoint {
  status: 'reserve' | 'deployed' | 'dead' | 'exited'
  position?: PersonalActorPosition
  hp?: number
  ammo?: number
  shieldImpact?: number
  mount?: { hp: number; mounted: boolean; position: PersonalActorPosition }
  order?: TacticalOrder
  formation?: { commandId: number; position: PersonalActorPosition; reached: boolean; speedLimit?: number; arrivalOrder?: TacticalOrder }
}
export interface PersonalSquadMission {
  squadId: typeof PERSONAL_SQUAD_ID
  memberIds: string[]
  sceneKey: string
  state: PersonalSquadState
  members: Record<string, PersonalActorCheckpoint>
  contribution: PersonalCombatContribution
  pendingMemberIds?: string[]
  playerLastPosition?: PersonalActorPosition
}

export function snapshotPersonalMission(profile: CareerProfile, sceneKey = 'town-home'): PersonalSquadMission | undefined {
  const memberIds = (profile.personalSquad?.members ?? []).slice(0, PERSONAL_SQUAD_LIMIT).map(member => member.id)
  if (!memberIds.length) return undefined
  return { squadId: PERSONAL_SQUAD_ID, memberIds, sceneKey, state: 'RESERVE',
    members: Object.fromEntries(memberIds.map(id => [id, { status: 'reserve' as const }])), contribution: emptyPersonalContribution() }
}

export function clonePersonalMission(value: PersonalSquadMission): PersonalSquadMission {
  return { ...value, ...(value.pendingMemberIds ? { pendingMemberIds: [...value.pendingMemberIds] } : {}), memberIds: [...value.memberIds], contribution: { ...value.contribution },
    ...(value.playerLastPosition ? { playerLastPosition: { ...value.playerLastPosition } } : {}),
    members: Object.fromEntries(Object.entries(value.members).map(([id, actor]) => [id, {
      ...actor, ...(actor.position ? { position: { ...actor.position } } : {}),
      ...(actor.mount ? { mount: { ...actor.mount, position: { ...actor.mount.position } } } : {}),
      ...(actor.formation ? { formation: { ...actor.formation, position: { ...actor.formation.position } } } : {}),
    }])) }
}

/** Regroup only deployed or already queued survivors; reserves and casualties stay untouched. */
export function followDeployedPersonalMission(value: PersonalSquadMission): PersonalSquadMission {
  const next = clonePersonalMission(value)
  let regrouped = false
  for (const id of next.memberIds) {
    const member = next.members[id]
    if (!member || member.hp === 0 || !(member.status === 'deployed'
      || member.status === 'reserve' && next.pendingMemberIds?.includes(id))) continue
    member.order = 'follow'
    delete member.formation
    regrouped = true
  }
  if (regrouped && next.state === 'RETURNING') next.state = 'ACTIVE'
  return next
}

/** Capture membership once; delayed projectiles do not depend on a living runtime actor. */
export function personalMissionSourcePolicy(mission: { personalSquad?: PersonalSquadMission }): (source: CombatActorRef) => boolean {
  const ids = new Set(mission.personalSquad?.memberIds ?? [])
  return source => source.actorType === 'npc' && source.ownership === 'player-personal'
    && source.squadId === PERSONAL_SQUAD_ID && ids.has(source.actorId)
}

const ORDERS: readonly TacticalOrder[] = ['follow', 'attack', 'charge', 'defend', 'formation']
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonnegative = (value: unknown): number => finite(value) ? Math.max(0, value) : 0
function position(value: unknown): PersonalActorPosition | undefined {
  const raw = value as PersonalActorPosition | undefined
  return raw && finite(raw.x) && finite(raw.z) && finite(raw.yaw) ? { x: raw.x, z: raw.z, yaw: raw.yaw } : undefined
}

/** Missing mission membership is a legacy empty roster, never inferred from today's owned members. */
export function parsePersonalMission(value: unknown): PersonalSquadMission | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<PersonalSquadMission>
  if (raw.squadId !== PERSONAL_SQUAD_ID || !Array.isArray(raw.memberIds)
    || raw.memberIds.length > PERSONAL_SQUAD_LIMIT || !raw.memberIds.every(id => typeof id === 'string' && /^personal:[A-Za-z0-9-]+$/.test(id))
    || new Set(raw.memberIds).size !== raw.memberIds.length) return undefined
  const members: PersonalSquadMission['members'] = {}
  for (const id of raw.memberIds) {
    const actor = raw.members?.[id]
    const status = actor && ['reserve', 'deployed', 'dead', 'exited'].includes(actor.status) ? actor.status : 'reserve'
    const point = position(actor?.position)
    const mountPosition = position(actor?.mount?.position)
    const formationPosition = position(actor?.formation?.position)
    members[id] = { status,
      ...(point ? { position: point } : {}),
      ...(finite(actor?.hp) ? { hp: nonnegative(actor.hp) } : {}),
      ...(finite(actor?.ammo) ? { ammo: Math.floor(nonnegative(actor.ammo)) } : {}),
      ...(finite(actor?.shieldImpact) ? { shieldImpact: nonnegative(actor.shieldImpact) } : {}),
      ...(actor?.order && ORDERS.includes(actor.order) ? { order: actor.order } : {}),
      ...(mountPosition && finite(actor?.mount?.hp) ? { mount: { hp: nonnegative(actor.mount.hp), mounted: actor.mount.mounted === true, position: mountPosition } } : {}),
      ...(formationPosition && finite(actor?.formation?.commandId) ? { formation: {
        commandId: actor.formation.commandId, position: formationPosition, reached: actor.formation.reached === true,
        ...(finite(actor.formation.speedLimit) ? { speedLimit: nonnegative(actor.formation.speedLimit) } : {}),
        ...(actor.formation.arrivalOrder && ORDERS.includes(actor.formation.arrivalOrder) ? { arrivalOrder: actor.formation.arrivalOrder } : {}),
      } } : {}),
    }
  }
  const contribution = emptyPersonalContribution()
  for (const key of Object.keys(contribution) as (keyof PersonalCombatContribution)[]) contribution[key] = nonnegative(raw.contribution?.[key])
  contribution.kills = Math.floor(contribution.kills)
  contribution.structuresDestroyed = Math.floor(contribution.structuresDestroyed)
  contribution.gateBreaches = Math.floor(contribution.gateBreaches)
  return { squadId: PERSONAL_SQUAD_ID, memberIds: [...raw.memberIds], members, contribution,
    ...(Array.isArray(raw.pendingMemberIds) ? { pendingMemberIds: raw.pendingMemberIds.filter(id => raw.memberIds!.includes(id) && members[id].status === 'reserve') } : {}),
    ...(position(raw.playerLastPosition) ? { playerLastPosition: position(raw.playerLastPosition) } : {}),
    sceneKey: typeof raw.sceneKey === 'string' ? raw.sceneKey : 'town-home',
    state: raw.state && ['RESERVE', 'DEPLOYING', 'ACTIVE', 'RETURNING'].includes(raw.state) ? raw.state : 'RESERVE' }
}
