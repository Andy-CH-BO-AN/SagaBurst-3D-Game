import type { CareerProfile } from './CareerProfile'

/** A durable ending is history, not a request to enter Career.
 * In-progress retirement keeps its original reload priority; completed saves
 * are opened only by the explicit Career entry, even with stale town flags.
 */
export function shouldResumeCareerTown(profile: CareerProfile | null, townSelected: boolean): boolean {
  if (profile?.careerRetirement?.phase === 'completed') return false
  return Boolean(profile?.careerRetirement) || profile?.townEvent?.state === 'hostile' || townSelected
}
