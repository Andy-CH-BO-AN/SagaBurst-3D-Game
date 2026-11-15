import { MAX_COMMAND_SQUAD_SIZE,type SquadId } from '../battle/CommandTarget'
import { TOWN_COMMANDER_ID } from '../town/TownCommanderIdentity'
import { townAuthoredRoster,type TownActorSpec } from '../town/TownRules'
import type { OfficialCommandSquad,TownCommandSquadState } from './CareerCommandAuthority'
import { siegeDefensePlans } from './TownDefenseRoster'

export const COMMANDER_TOWN_ROSTER_VERSION = 2 as const
export type CommanderTownRosterVersion = typeof COMMANDER_TOWN_ROSTER_VERSION
export const COMMANDER_TOWN_GATE_ORDER = ['north', 'south', 'east', 'west'] as const

/** Fixed native gate membership. Service posts stay unchanged until mission deployment.
 * Never borrow western reserves or infer membership from living actors/equipment. */
export function commanderGateDefenseSlots(roster: readonly TownActorSpec[] = townAuthoredRoster(),
  _version: CommanderTownRosterVersion = COMMANDER_TOWN_ROSTER_VERSION): OfficialCommandSquad[] {
  const plans = siegeDefensePlans(roster.filter(actor => !['commander', 'hr-officer', 'eagle-trainer'].includes(actor.id)))
  const squads = COMMANDER_TOWN_GATE_ORDER.flatMap((gateId, index) => {
    const plan = plans.find(plan => plan.gateId === gateId)!
    const infantry = [...plan.infantry]
    const cavalry = plan.cavalry.filter(id => id !== 'captain')
    if (gateId === 'north') cavalry.unshift(TOWN_COMMANDER_ID)
    if (gateId === 'south') infantry.push('eagle-trainer')
    if (gateId === 'east') cavalry.unshift('captain')
    if (gateId === 'west') cavalry.unshift('hr-officer')
    return [infantry, cavalry].map((actorIds, offset) => ({ squadId: (index * 2 + offset + 1) as SquadId, actorIds }))
  })
  const ids = squads.flatMap(squad => squad.actorIds)
  if (squads.some(squad => squad.actorIds.length > MAX_COMMAND_SQUAD_SIZE) || new Set(ids).size !== ids.length) {
    throw new Error('Invalid Commander gate roster')
  }
  return squads
}

export function commanderTownGateForSquad(squadId: SquadId) {
  return COMMANDER_TOWN_GATE_ORDER[Math.floor((squadId - 1) / 2)]
}

/** Pure, data-only expansion for peaceful Town authority. Legacy 30-person ownership remains exact;
 * canonical members added by promotion keep native AI until the player commands them. */
export function commanderTownCommandMembership(previous?: TownCommandSquadState): Pick<TownCommandSquadState,
  'commandRank' | 'squads' | 'actorIds' | 'commandedActorIds' | 'nativeReturnStates'> {
  const squads = commanderGateDefenseSlots().map(squad => ({ ...squad, actorIds: [...squad.actorIds] }))
  const actorIds = squads.flatMap(squad => squad.actorIds)
  const previousClaims = previous?.commandRank === 'commander'
    ? previous.commandedActorIds ?? []
    : previous?.authorized ? previous.actorIds : []
  const nativeReturnStates = Object.fromEntries(Object.entries(previous?.nativeReturnStates ?? {})
    .filter(([id]) => actorIds.includes(id)))
  return {
    commandRank: 'commander', squads, actorIds,
    commandedActorIds: actorIds.filter(id => previousClaims.includes(id)
      && !Object.prototype.hasOwnProperty.call(nativeReturnStates, id)),
    ...(Object.keys(nativeReturnStates).length ? { nativeReturnStates } : {}),
  }
}
