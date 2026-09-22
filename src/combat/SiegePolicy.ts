import type { DamageableObstacleKind } from '../world/DamageableObstacle'

export const SIEGE_STRUCTURE_STUCK_SECONDS = 3.0
export const SIEGE_TREE_STUCK_SECONDS = 6.0

/**
 * Destruction is a navigation fallback, not the default route.
 * Trees intentionally take twice as long to become eligible as fort structures.
 */
export function getSiegeFallbackDelay(kind: DamageableObstacleKind): number {
  return kind === 'tree'
    ? SIEGE_TREE_STUCK_SECONDS
    : SIEGE_STRUCTURE_STUCK_SECONDS
}
