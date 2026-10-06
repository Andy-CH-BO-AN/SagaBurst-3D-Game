import { combatAllegiancesHostile, type CombatAllegiance } from '../combat/CombatFaction'
import type { NPC } from '../world/NPC'
/** Allegiance is the battle faction; hero visual faction does not change allegiance. */
export function townWartimeHostile(actor: CombatAllegiance, target: CombatAllegiance): boolean {
  return combatAllegiancesHostile(actor, target)
}
export function townWartimePeers(actor: NPC, actors: readonly NPC[]): NPC[] {
  return actors.filter(target => !target.dead && townWartimeHostile(actor, target))
}
export function civilianShouldFight(distance: number, preparation: boolean): boolean {
  return !preparation && distance <= 10
}
export function civilianWartimeWeapon(faction: 'roman' | 'viking'): string {
  return faction === 'roman' ? 'gladius_rusty' : 'viking_axe_t1'
}
