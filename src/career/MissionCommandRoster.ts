import { MAX_COMMAND_SQUADS, MAX_COMMAND_SQUAD_SIZE, type SquadId } from '../battle/CommandTarget'
import type { OfficialCommandSquad } from './CareerCommandAuthority'

/** Read accepted actor identities in production slot order; no actor is created or replaced. */
export function commandSquadsFromSlots(actorIds: readonly string[], slots: readonly { squadId?: number | string }[]): OfficialCommandSquad[] {
  const squads = new Map<SquadId, OfficialCommandSquad>()
  const assigned = new Set<string>()
  slots.forEach((slot, index) => {
    const id = actorIds[index], squadId = slot.squadId
    if (!id || assigned.has(id)) return
    if (typeof squadId !== 'number' || !Number.isInteger(squadId) || squadId < 1 || squadId > MAX_COMMAND_SQUADS) {
      throw new Error('Official mission slot requires a valid squad')
    }
    const key = squadId as SquadId
    const squad = squads.get(key) ?? { squadId: key, actorIds: [] }
    if (squad.actorIds.length >= MAX_COMMAND_SQUAD_SIZE) throw new Error('Official mission squad exceeds capacity')
    squad.actorIds.push(id)
    squads.set(key, squad)
    assigned.add(id)
  })
  return [...squads.values()].sort((a, b) => a.squadId - b.squadId)
}

/** Waves without authored squads retain their immutable accepted spawn-slot order. */
export function commandSquadsFromActorIds(actorIds: readonly string[], firstSquadId = 1): OfficialCommandSquad[] {
  return commandSquadsFromSlots(actorIds, actorIds.map((_, index) => ({
    squadId: firstSquadId + Math.floor(index / MAX_COMMAND_SQUAD_SIZE),
  })))
}
