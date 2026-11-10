import { CAREER_RANKS, CAREER_RANK_THRESHOLDS, enlistmentMerit, type CareerProfile, type CareerRank } from './CareerProfile'

export type CareerAppointingRole = 'captain' | 'commander'

/** Appointment authority is independent of available currency and displayed buttons. */
export function careerPromotionAuthority(rank: CareerRank): CareerAppointingRole | null {
  return rank === 'commander' ? null : rank === 'captain' ? 'commander' : 'captain'
}

/** Generic one-step promotion. Veteran → Captain and Captain → Commander are owned by the class roads
 * (CareerT4Promotion / CareerElitePromotion) for both factions, so they never pass here. */
export function canAppointCareerRank(profile: CareerProfile, npcRole: string): boolean {
  if (profile.rank === 'veteran' || profile.rank === 'captain') return false
  const next = CAREER_RANKS[CAREER_RANKS.indexOf(profile.rank) + 1]
  return Boolean(next && careerPromotionAuthority(profile.rank) === npcRole
    && enlistmentMerit(profile) >= CAREER_RANK_THRESHOLDS[next])
}
