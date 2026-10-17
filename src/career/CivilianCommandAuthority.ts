import type { CharacterFaction } from '../world/CharacterVisuals'
import { parseCommandActorCheckpoint } from './CareerCommandAuthority'
import type { PersonalActorCheckpoint } from './CareerPersonalSquadMission'
import type { TownActorSpec } from '../town/TownRules'

export type CivilianCommandOwner = 'daily' | 'evacuation' | 'player' | 'returning'

/** Civilian membership is independent of official squads and never carries command merit. */
export interface CivilianCommandSquadState {
  type: 'civilian-command'
  squadId: 'civilians'
  townFaction: CharacterFaction
  sceneKey: string
  missionId?: string
  homeLayoutVersion?: number
  actorIds: string[]
  owners: Record<string, CivilianCommandOwner>
  members: Record<string, PersonalActorCheckpoint>
}

/** Uses existing scene residents; no generated military IDs or actor materialization. */
export function civilianCommandRoster(specs: readonly Pick<TownActorSpec, 'id' | 'role'>[]): string[] {
  return [...new Set(specs.filter(spec => spec.role === 'civilian' || spec.role === 'merchant').map(spec => spec.id))].sort()
}

const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
const owners: readonly CivilianCommandOwner[] = ['daily', 'evacuation', 'player', 'returning']

export function parseCivilianCommandSquad(value: unknown): CivilianCommandSquadState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<CivilianCommandSquadState>
  if (raw.type !== 'civilian-command' || raw.squadId !== 'civilians'
    || (raw.townFaction !== 'roman' && raw.townFaction !== 'viking') || !validId(raw.sceneKey)
    || (raw.missionId !== undefined && !validId(raw.missionId))
    || (raw.homeLayoutVersion !== undefined && (!Number.isSafeInteger(raw.homeLayoutVersion) || raw.homeLayoutVersion < 1))
    || !Array.isArray(raw.actorIds) || raw.actorIds.length > 100 || !raw.actorIds.every(validId)
    || new Set(raw.actorIds).size !== raw.actorIds.length || !raw.owners || !raw.members) return undefined
  const members: CivilianCommandSquadState['members'] = {}, parsedOwners: CivilianCommandSquadState['owners'] = {}
  for (const id of raw.actorIds) {
    const owner = raw.owners[id], member = parseCommandActorCheckpoint(raw.members[id])
    if (!owners.includes(owner) || !member) return undefined
    // A home return without a real navigation destination cannot resume safely.
    if (owner === 'returning' && member.status !== 'dead' && !member.formation) return undefined
    parsedOwners[id] = owner
    members[id] = member
  }
  return { type: 'civilian-command', squadId: 'civilians', townFaction: raw.townFaction, sceneKey: raw.sceneKey,
    ...(raw.homeLayoutVersion !== undefined ? { homeLayoutVersion: raw.homeLayoutVersion } : {}),
    ...(raw.missionId ? { missionId: raw.missionId } : {}), actorIds: [...raw.actorIds], owners: parsedOwners, members }
}

export function cloneCivilianCommandSquad(value: CivilianCommandSquadState): CivilianCommandSquadState {
  return { ...value, actorIds: [...value.actorIds], owners: { ...value.owners },
    members: Object.fromEntries(Object.entries(value.members).map(([id, member]) => [id, parseCommandActorCheckpoint(member)!])) }
}
