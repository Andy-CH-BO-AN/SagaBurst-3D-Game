import type { CombatEvent, CombatEventSink } from '../combat/CombatAttribution'

/** The owners the Town scene currently holds; each is optional because a scene need not have built it. */
export interface TownCombatEventOwners {
  duel?: { active: unknown; events: { emit: CombatEventSink }; recordCombatEvent(event: CombatEvent): void }
  retirementFinale?: { active: unknown; recordEvent(event: CombatEvent): unknown }
  captainPatrol?: { active: unknown; recordEvent(event: CombatEvent): unknown }
  defense?: { active: unknown; events: { emit: CombatEventSink } }
  mission?: { events: { emit: CombatEventSink } }
  refitSafety: { note(event: CombatEvent): void }
  /** Player skill XP for this one event. */
  awardXp(): void
}

/**
 * Every Town combat event is recorded by the duel, scored for XP and noted for squad refit safety once,
 * then delivered to exactly one scoring owner: finale, else patrol, else duel, else defense, else mission.
 */
export function routeTownCombatEvent(event: CombatEvent, owners: TownCombatEventOwners): void {
  owners.duel?.recordCombatEvent(event)
  owners.awardXp()
  owners.refitSafety.note(event)
  if (owners.retirementFinale?.active) { owners.retirementFinale.recordEvent(event); return }
  if (owners.captainPatrol?.active) owners.captainPatrol.recordEvent(event)
  else (owners.duel?.active ? owners.duel.events : owners.defense?.active ? owners.defense.events : owners.mission?.events)?.emit(event)
}
