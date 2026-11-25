/** Stable native identities, independent of command slots and render resources. */
export const TOWN_EAGLE_RIDER_IDS = [1, 2, 3, 4, 5].map(slot => `town-eagle-rider:${slot}`)
export const TOWN_WATCHTOWER_ARCHER_IDS = [1, 2, 3, 4, 5].map(slot => `watchtower-archer:${slot}`)
export const TOWN_AUTONOMOUS_GUARD_IDS = [
  ...TOWN_EAGLE_RIDER_IDS, ...TOWN_WATCHTOWER_ARCHER_IDS,
]
const AUTONOMOUS_GUARD_IDS = new Set(TOWN_AUTONOMOUS_GUARD_IDS)
const EAGLE_RIDER_IDS = new Set(TOWN_EAGLE_RIDER_IDS)
const ENEMY_TOWN_PREFIX = 'enemy-town:'
const canonicalGuardId = (actorId: string) =>
  actorId.startsWith(ENEMY_TOWN_PREFIX) ? actorId.slice(ENEMY_TOWN_PREFIX.length) : actorId
/** Hot per-frame Town ownership check: no string allocation for ordinary IDs. */
export function isAutonomousTownGuard(actorId: string): boolean {
  return AUTONOMOUS_GUARD_IDS.has(canonicalGuardId(actorId))
}
/** Native Town eagle garrison riders (巨鷹隊), independent of live mount or flight state. */
export function isTownEagleRider(actorId: string): boolean {
  return EAGLE_RIDER_IDS.has(canonicalGuardId(actorId))
}
