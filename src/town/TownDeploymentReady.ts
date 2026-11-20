import type { ActiveCareerMission } from '../career/CareerMissionState'
import { isCommanderTownMission } from '../career/CommanderMissionCatalog'

export interface TownDeploymentReadiness {
  /** Field mission roster; absent before the Town controllers exist. */
  mission?: { readonly ready: boolean }
  /** The Commander controller. An idle one has no deployed roster and never holds the Town. */
  defense?: { readonly active: unknown; readonly ready: boolean }
  personalSquad?: { readonly ready: boolean }
  activeMission?: ActiveCareerMission
}

/** Whether Town simulation may run: only an active mission may hold it while its rosters are prepared. */
export function townDeploymentReady({ mission, defense, personalSquad, activeMission }: TownDeploymentReadiness): boolean {
  return (mission?.ready ?? true) && (!defense?.active || defense.ready)
    && (!(isCommanderTownMission(activeMission) || activeMission?.kind === 'commander-four-gate-defense') || (personalSquad?.ready ?? true))
}
