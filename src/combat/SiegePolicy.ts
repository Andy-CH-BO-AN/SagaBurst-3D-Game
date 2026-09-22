import type { DamageableObstacleKind } from '../world/DamageableObstacle'

export const SIEGE_STRUCTURE_STUCK_SECONDS = 3.0
export const SIEGE_TREE_STUCK_SECONDS = 6.0

export function isFortificationKind(kind: DamageableObstacleKind): boolean {
  return kind === 'gate'
    || kind === 'palisade'
    || kind === 'chevaux_de_frise'
}

/**
 * Only non-fortification obstacles use delayed destruction fallback.
 *
 * Enemy Gate / Palisade / Chevaux-de-frise are handled immediately when they
 * are the direct blocker between an attacker and its human target.
 */
export function getSiegeFallbackDelay(kind: DamageableObstacleKind): number {
  return kind === 'tree'
    ? SIEGE_TREE_STUCK_SECONDS
    : SIEGE_STRUCTURE_STUCK_SECONDS
}
