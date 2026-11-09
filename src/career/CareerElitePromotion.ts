import { cloneCareerProfile, enlistmentMerit, promoteCareer, type CareerProfile } from './CareerProfile'

export const BYZANTINE_MERIT_REQUIRED = 30000

/** Live authority: only this enlistment, Roman Captains/Commanders, and no active deployment/ending. */
export function canAppointByzantine(profile: CareerProfile): boolean {
  return profile.faction === 'roman' && (profile.rank === 'captain' || profile.rank === 'commander')
    && !profile.eliteClass && enlistmentMerit(profile) >= BYZANTINE_MERIT_REQUIRED
    && !profile.careerRetirement && !profile.activeMission && !profile.activeOutpostMission
    && !profile.activeRace && profile.townEvent?.state !== 'hostile'
}

/** No extra grant or cost when an existing Commander changes class. */
export function appointByzantine(profile: CareerProfile): CareerProfile | null {
  if (!canAppointByzantine(profile)) return null
  const next = profile.rank === 'captain' ? promoteCareer(profile) : cloneCareerProfile(profile)
  if (!next) return null
  next.eliteClass = 'byzantine-cataphract'
  return next
}
