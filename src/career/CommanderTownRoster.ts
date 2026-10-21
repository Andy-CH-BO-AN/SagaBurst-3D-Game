import { townAuthoredRoster, type TownActorSpec } from '../town/TownRules'
import { siegeDefensePlans } from './TownDefenseRoster'
import { MAX_COMMAND_SQUAD_SIZE, type SquadId } from '../battle/CommandTarget'
import { TOWN_EAGLE_PAIRS } from '../town/TownEagleGarrison'
import { TOWN_COMMANDER_ID } from '../town/TownCommanderIdentity'
import type { OfficialCommandSquad, TownCommandSquadState } from './CareerCommandAuthority'

export const COMMANDER_TOWN_ROSTER_VERSION = 2 as const
export type CommanderTownRosterVersion = 1 | typeof COMMANDER_TOWN_ROSTER_VERSION
export const COMMANDER_TOWN_GATE_ORDER = ['north', 'south', 'east', 'west'] as const

/** Version one is read only: accepted missions keep their exact 210 identities and squads. */
/** Full authored membership is fixed before any missing/dead/loaned actor is filtered.
 * West contributes mobile reserves to the first three gates, keeping its own ten gate guards.
 * Shared Town producers remain unchanged: service Commander is a fresh acceptance opt-in.
 */
function legacyCommanderGateDefenseSlots(roster: readonly TownActorSpec[]): OfficialCommandSquad[] {
  const byId = new Map(roster.map(actor => [actor.id, actor]))
  const plans = siegeDefensePlans(roster)
  const west = plans.find(plan => plan.gateId === 'west')!
  const infantry = [...west.infantry.filter(id => !byId.get(id)?.gateId), ...west.infantry.filter(id => byId.get(id)?.gateId)]
  const cavalry = [...west.cavalry.filter(id => id !== west.leaderId), ...west.cavalry.filter(id => id === west.leaderId)]
  const squads = (['north', 'south', 'east'] as const).flatMap((gateId, index) => {
    const plan = plans.find(plan => plan.gateId === gateId)!
    return [plan.infantry, plan.cavalry].map((ids, offset) => {
      const actorIds = [...ids]
      if (gateId === 'north' && offset === 1) actorIds.splice(1, 0, TOWN_COMMANDER_ID)
      const reserve = offset === 0 ? infantry : cavalry
      while (actorIds.length < MAX_COMMAND_SQUAD_SIZE && reserve.length) actorIds.push(reserve.shift()!)
      if (actorIds.length > MAX_COMMAND_SQUAD_SIZE) throw new Error('Gate defense squad exceeds capacity')
      return { squadId: (index * 2 + offset + 1) as SquadId, actorIds }
    })
  })
  squads.push({ squadId: 7, actorIds: [...infantry, ...cavalry, 'eagle-trainer'] },
    { squadId: 8, actorIds: TOWN_EAGLE_PAIRS.map(pair => pair.riderId) })
  if (squads.some(squad => squad.actorIds.length > MAX_COMMAND_SQUAD_SIZE)) throw new Error('Gate defense squad exceeds capacity')
  return squads
}

/** Fixed native gate membership. Service posts stay unchanged until mission deployment.
 * Never borrow western reserves or infer membership from living actors/equipment. */
export function commanderGateDefenseSlots(roster: readonly TownActorSpec[] = townAuthoredRoster(),
  version: CommanderTownRosterVersion = COMMANDER_TOWN_ROSTER_VERSION): OfficialCommandSquad[] {
  if (version === 1) return legacyCommanderGateDefenseSlots(roster)
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
