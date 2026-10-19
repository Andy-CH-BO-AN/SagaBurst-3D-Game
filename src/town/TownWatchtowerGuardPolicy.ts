import type { TownActorSpec } from './TownRules'
import { TOWN_WATCHTOWER_ARCHER_IDS } from './TownNativeGuardIdentity'
import { getTownCommandWatchtowerLayout, getTownWatchtowerGuardStations, type CommandWatchtowerLayout } from './TownCommandWatchtowerLayout'

/** Five spaced posts on the central top deck. The east platform/stair exit stays open.
 * Local offsets follow the actual walk surface, never terrain or a world-height constant. */
export function townWatchtowerGuardRoster(layout: CommandWatchtowerLayout = getTownCommandWatchtowerLayout()): TownActorSpec[] {
  const posts = getTownWatchtowerGuardStations(layout)
  return TOWN_WATCHTOWER_ARCHER_IDS.map((id, index) => {
    const { x, y, z, yaw } = posts[index]
    return { id, role: 'archer_infantry', unitKind: 'archer', duty: 'watchtower_guard', tier: 3,
      mounted: false, training: false, assaultObjective: true, index, x, y, z, yaw }
  })
}
