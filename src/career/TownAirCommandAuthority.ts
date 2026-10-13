import { TOWN_EAGLE_PAIRS } from '../town/TownEagleGarrison'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { PersonalActorCheckpoint } from './CareerPersonalSquadMission'
import { parseCommandActorCheckpoint } from './CareerCommandAuthority'

/** Peaceful Town air authority never substitutes for a formal mission grant. */
export interface TownAirCommandSquadState {
  type: 'town-air-command'
  squadId: 8
  townFaction: CharacterFaction
  sceneKey: string
  actorIds: string[]
  commandedActorIds: string[]
  members: Record<string, PersonalActorCheckpoint>
}
export const TOWN_AIR_COMMAND_IDS: readonly string[] = TOWN_EAGLE_PAIRS.map(pair => pair.riderId)

export function parseTownAirCommandSquad(value: unknown): TownAirCommandSquadState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<TownAirCommandSquadState>
  if (raw.type !== 'town-air-command' || raw.squadId !== 8
    || (raw.townFaction !== 'roman' && raw.townFaction !== 'viking') || raw.sceneKey !== `town:${raw.townFaction}`
    || !Array.isArray(raw.actorIds) || raw.actorIds.length > 5
    || raw.actorIds.some(id => !TOWN_AIR_COMMAND_IDS.includes(id)) || new Set(raw.actorIds).size !== raw.actorIds.length
    || !Array.isArray(raw.commandedActorIds) || raw.commandedActorIds.some(id => !raw.actorIds!.includes(id))
    || new Set(raw.commandedActorIds).size !== raw.commandedActorIds.length || !raw.members) return undefined
  const members: TownAirCommandSquadState['members'] = {}
  for (const id of raw.actorIds) {
    const member = parseCommandActorCheckpoint(raw.members[id])
    if (!member) return undefined
    members[id] = member
  }
  return { type: 'town-air-command', squadId: 8, townFaction: raw.townFaction, sceneKey: raw.sceneKey,
    actorIds: TOWN_AIR_COMMAND_IDS.filter(id => raw.actorIds!.includes(id)),
    commandedActorIds: TOWN_AIR_COMMAND_IDS.filter(id => raw.commandedActorIds!.includes(id)), members }
}
export function cloneTownAirCommandSquad(value: TownAirCommandSquadState): TownAirCommandSquadState {
  return { ...value, actorIds: [...value.actorIds], commandedActorIds: [...value.commandedActorIds],
    members: Object.fromEntries(Object.entries(value.members).map(([id, member]) => [id, parseCommandActorCheckpoint(member)!])) }
}
