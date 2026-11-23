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

/** Same decision as the full-page startup: a Veteran defeat lock or unclaimed result resumes the battle; a settled claim returns to town. */
export function careerVeteranOutpostResumeAction(profile: CareerProfile): 'resume' | 'settle' | null {
  const mission = profile.activeMission
  if (!isCareerVeteranOutpostMission(mission)) return null
  return shouldResumeCareerVeteranOutpost(mission) || !profile.claimedBattleIds.includes(mission.id) ? 'resume' : 'settle'
}
