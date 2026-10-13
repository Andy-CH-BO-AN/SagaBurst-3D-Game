import { townRoster } from '../town/TownRules'
import { siegeDefensePlans } from './TownDefenseRoster'
import { MAX_COMMAND_SQUAD_SIZE, type SquadId } from '../battle/CommandTarget'
import { TOWN_EAGLE_PAIRS } from '../town/TownEagleGarrison'
import { TOWN_COMMANDER_ID } from '../town/TownCommanderIdentity'
import type { OfficialCommandSquad } from './CareerCommandAuthority'

/** Full authored membership is fixed before any missing/dead/loaned actor is filtered.
 * West contributes mobile reserves to the first three gates, keeping its own ten gate guards.
 * Shared Town producers remain unchanged: service Commander is a fresh acceptance opt-in.
 */
export function commanderGateDefenseSlots(): OfficialCommandSquad[] {
  const roster = townRoster(), byId = new Map(roster.map(actor => [actor.id, actor]))
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
