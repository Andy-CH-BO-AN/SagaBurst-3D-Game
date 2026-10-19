/** Stable native identities, independent of command slots and render resources. */
export const TOWN_WATCHTOWER_ARCHER_IDS = [1, 2, 3, 4, 5].map(slot => `watchtower-archer:${slot}`)
export const TOWN_AUTONOMOUS_GUARD_IDS = [
  ...[1, 2, 3, 4, 5].map(slot => `town-eagle-rider:${slot}`), ...TOWN_WATCHTOWER_ARCHER_IDS,
]
export function isAutonomousTownGuard(actorId: string): boolean {
  return TOWN_AUTONOMOUS_GUARD_IDS.includes(actorId.replace(/^enemy-town:/, ''))
}
