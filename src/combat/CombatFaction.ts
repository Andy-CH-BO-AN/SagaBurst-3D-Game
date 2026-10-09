/** Combat allegiance is independent of the Roman/Viking character appearance. */
export enum Faction {
  PLAYER = 'PLAYER',
  ENEMY = 'ENEMY',
  TOWN = 'TOWN',
  BANDIT = 'BANDIT',
}

export type CombatOwnership = 'player-personal' | 'town-command' | 'mission-official'

export interface CombatAllegiance {
  faction: Faction
  combatOwnership?: CombatOwnership
  hostileToPlayer?: boolean
}
/** A player-owned Town party is allied to peaceful residents and opposes hostile residents. */
export function combatAllegiancesHostile(actor: CombatAllegiance, target: CombatAllegiance): boolean {
  if (actor.faction === target.faction) return false
  if (actor.combatOwnership && actor.faction === Faction.PLAYER && target.faction === Faction.TOWN) return target.hostileToPlayer === true
  if (target.combatOwnership && target.faction === Faction.PLAYER && actor.faction === Faction.TOWN) return actor.hostileToPlayer === true
  return true
}
