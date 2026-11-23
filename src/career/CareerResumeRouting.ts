import type { ActiveCareerMission } from './CareerMissionState'
import type { CareerProfile } from './CareerProfile'
import { isCareerVeteranOutpostMission, shouldResumeCareerVeteranOutpost } from './CareerVeteranOutpost'

/** A durable ending is history, not a request to enter Career.
 * In-progress retirement keeps its original reload priority; completed saves
 * are opened only by the explicit Career entry, even with stale town flags.
 */
export function shouldResumeCareerTown(profile: CareerProfile | null, townSelected: boolean): boolean {
  if (profile?.careerRetirement?.phase === 'completed') return false
  return Boolean(profile?.activeMission?.prisonBreak) || Boolean(profile?.careerRetirement) || profile?.townEvent?.state === 'hostile' || townSelected
}

/** One decision for startup and the main-menu entry: a Veteran defeat lock or unclaimed result resumes the battle; a settled claim returns to town. */
export function careerVeteranOutpostResumeAction(mission: ActiveCareerMission | undefined, claimedBattleIds: readonly string[]): 'resume' | 'settle' | null {
  if (!isCareerVeteranOutpostMission(mission)) return null
  return shouldResumeCareerVeteranOutpost(mission) || !claimedBattleIds.includes(mission.id) ? 'resume' : 'settle'
}
