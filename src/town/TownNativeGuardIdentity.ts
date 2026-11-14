/** Stable native identities, independent of command slots and render resources. */
export const TOWN_WATCHTOWER_ARCHER_IDS = [1, 2, 3, 4, 5].map(slot => `watchtower-archer:${slot}`)
export const TOWN_AUTONOMOUS_GUARD_IDS = [
  ...[1, 2, 3, 4, 5].map(slot => `town-eagle-rider:${slot}`), ...TOWN_WATCHTOWER_ARCHER_IDS,
]
const AUTONOMOUS_GUARD_IDS = new Set(TOWN_AUTONOMOUS_GUARD_IDS)
const ENEMY_TOWN_PREFIX = 'enemy-town:'
/** Hot per-frame Town ownership check: no string allocation for ordinary IDs. */
export function isAutonomousTownGuard(actorId: string): boolean {
  return AUTONOMOUS_GUARD_IDS.has(actorId.startsWith(ENEMY_TOWN_PREFIX) ? actorId.slice(ENEMY_TOWN_PREFIX.length) : actorId)
}
