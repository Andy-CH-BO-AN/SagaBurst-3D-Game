/** Combat allegiance is independent of the Roman/Viking character appearance. */
export enum Faction {
  PLAYER = 'PLAYER',
  ENEMY = 'ENEMY',
  TOWN = 'TOWN',
  BANDIT = 'BANDIT',
}

export interface CombatAllegiance {
  faction: Faction
  combatOwnership?: 'player-personal'
  hostileToPlayer?: boolean
}
/** A player-owned Town party is allied to peaceful residents and opposes hostile residents. */
export function combatAllegiancesHostile(actor: CombatAllegiance, target: CombatAllegiance): boolean {
  if (actor.faction === target.faction) return false
  if (actor.combatOwnership === 'player-personal' && target.faction === Faction.TOWN) return target.hostileToPlayer === true
  if (target.combatOwnership === 'player-personal' && actor.faction === Faction.TOWN) return actor.hostileToPlayer === true
  return true
}
