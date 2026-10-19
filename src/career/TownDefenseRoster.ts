import { TOWN_GATES, type TownGateId } from '../town/TownLayout'
import { townAssaultObjectiveRoster, townDefenseForceCounts, type TownActorSpec } from '../town/TownRules'
import { TOWN_COMMANDER_ID } from '../town/TownCommanderIdentity'
import type { CareerProfile } from './CareerProfile'

/** Fresh defense acceptance and board previews share the service resident opt-in. */
export function townDefenseCommanderIds(profile: Pick<CareerProfile, 'rank'>, residents: readonly TownActorSpec[], unavailableActorIds: ReadonlySet<string>): string[] {
  return profile.rank === 'commander' && !unavailableActorIds.has(TOWN_COMMANDER_ID)
    && residents.some(actor => actor.id === TOWN_COMMANDER_ID && actor.role === 'commander') ? [TOWN_COMMANDER_ID] : []
}
export function townDefenseForceCountsForProfile(profile: Pick<CareerProfile, 'rank'>, residents: readonly TownActorSpec[], unavailableActorIds: ReadonlySet<string> = new Set()) {
  return townDefenseForceCounts(residents, townDefenseCommanderIds(profile, residents, unavailableActorIds))
}

export interface SiegeDefensePlan { gateId: TownGateId; infantry: string[]; cavalry: string[]; leaderId?: string }
export function siegeDefensePlans(roster: readonly TownActorSpec[]): SiegeDefensePlan[] {
  const military = townAssaultObjectiveRoster([...roster]).filter(actor => actor.duty !== 'eagle_garrison' && actor.duty !== 'watchtower_guard')
  const plans: SiegeDefensePlan[] = TOWN_GATES.map(gate => ({ gateId: gate.id, infantry: [], cavalry: [] }))
  const leaders = ['captain', 'ranger', 'town-patrol:a:captain', 'town-patrol:b:captain']
  for (const actor of military.filter(actor => !actor.mounted && actor.role !== 'ranger' && actor.gateId)) {
    plans.find(plan => plan.gateId === actor.gateId)!.infantry.push(actor.id)
  }
  for (const actor of military.filter(actor => !actor.mounted && actor.role !== 'ranger' && !actor.gateId)) {
    [...plans].sort((a, b) => a.infantry.length - b.infantry.length)[0].infantry.push(actor.id)
  }
  leaders.forEach((id, index) => { if (military.some(actor => actor.id === id)) { plans[index].cavalry.push(id); plans[index].leaderId = id } })
  for (const actor of military.filter(actor => (actor.mounted || actor.role === 'ranger') && !leaders.includes(actor.id))) {
    [...plans].sort((a, b) => a.cavalry.length - b.cavalry.length)[0].cavalry.push(actor.id)
  }
  return plans
}
