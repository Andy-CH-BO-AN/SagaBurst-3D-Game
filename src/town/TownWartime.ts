import type { NPC } from '../world/NPC'
/** Allegiance is the battle faction; hero visual faction does not change allegiance. */
export function townWartimeHostile(actor: Pick<NPC, 'faction'>, target: Pick<NPC, 'faction'>): boolean {
  return actor.faction !== target.faction
}
export function townWartimePeers(actor: NPC, actors: readonly NPC[]): NPC[] {
  return actors.filter(target => !target.dead && townWartimeHostile(actor, target))
}
export function civilianShouldFight(distance: number, preparation: boolean): boolean {
  return !preparation && distance <= 3
}
export function civilianWartimeWeapon(faction: 'roman' | 'viking'): string {
  return faction === 'roman' ? 'gladius_rusty' : 'viking_axe_t1'
}
