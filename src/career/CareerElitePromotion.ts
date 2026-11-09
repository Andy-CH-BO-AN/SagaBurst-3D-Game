import { cloneCareerProfile, enlistmentMerit, promoteCareer, type CareerProfile } from './CareerProfile'

export type CareerClassId = 'roman-commander' | 'byzantine-cataphract'
export const CAREER_CLASS_IDS: readonly CareerClassId[] = ['roman-commander', 'byzantine-cataphract']
/** Enlistment merit needed for the free first appointment from Captain. Nothing is deducted. */
export const CAREER_CLASS_FIRST_MERIT: Readonly<Record<CareerClassId, number>> = { 'roman-commander': 20000, 'byzantine-cataphract': 30000 }
/** availableMerit spent to unlock the second class permanently (a real purchase, not a merit threshold). */
export const CAREER_CLASS_PRICE: Readonly<Record<CareerClassId, number>> = { 'roman-commander': 20000, 'byzantine-cataphract': 30000 }

type ClassProfile = Pick<CareerProfile, 'faction' | 'rank' | 'eliteClass' | 'unlockedCareerClasses'>

/** The class in use, or null when the profile is not a Roman Commander. */
export function currentCareerClass(profile: ClassProfile): CareerClassId | null {
  return profile.faction === 'roman' && profile.rank === 'commander'
    ? profile.eliteClass === 'byzantine-cataphract' ? 'byzantine-cataphract' : 'roman-commander' : null
}

/** Unlocked is distinct from current. A save without the record unlocks only the class in use. */
export function unlockedCareerClasses(profile: ClassProfile): readonly CareerClassId[] {
  const current = currentCareerClass(profile)
  if (!current) return []
  return profile.unlockedCareerClasses ?? [current]
}

/** Live authority: only this Roman enlistment, and no active deployment/ending. NPC/death checks stay with the scene. */
function serviceReady(profile: CareerProfile): boolean {
  return profile.faction === 'roman' && (profile.rank === 'captain' || profile.rank === 'commander')
    && !profile.careerRetirement && !profile.activeMission && !profile.activeOutpostMission
    && !profile.activeRace && profile.townEvent?.state !== 'hostile'
}

export type CareerClassOfferKind = 'current' | 'appoint' | 'merit-locked' | 'purchase' | 'insufficient-merit' | 'switch' | 'unavailable'
export interface CareerClassOffer { kind: CareerClassOfferKind; cost: number; shortfall: number }

/** Single decision owner for both the cards and the transaction. */
export function careerClassOffer(profile: CareerProfile, target: CareerClassId): CareerClassOffer {
  const offer = (kind: CareerClassOfferKind, cost = 0, shortfall = 0): CareerClassOffer => ({ kind, cost, shortfall })
  if (!serviceReady(profile)) return offer('unavailable')
  if (profile.rank === 'captain') {
    const required = CAREER_CLASS_FIRST_MERIT[target], merit = enlistmentMerit(profile)
    return merit >= required ? offer('appoint') : offer('merit-locked', 0, required - merit)
  }
  if (currentCareerClass(profile) === target) return offer('current')
  if (unlockedCareerClasses(profile).includes(target)) return offer('switch')
  const price = CAREER_CLASS_PRICE[target]
  return profile.availableMerit >= price ? offer('purchase', price) : offer('insufficient-merit', price, price - profile.availableMerit)
}

/** Pure transaction on a clone; the caller saves it once. Returns null when the live offer is not actionable. */
export function applyCareerClass(profile: CareerProfile, target: CareerClassId): CareerProfile | null {
  const { kind, cost } = careerClassOffer(profile, target)
  if (kind !== 'appoint' && kind !== 'purchase' && kind !== 'switch') return null
  // First appointment reuses ordinary promotion (tutorial receipt, one-time Commander melee grant); switching never re-grants.
  const next = kind === 'appoint' ? promoteCareer(profile) : cloneCareerProfile(profile)
  if (!next) return null
  next.availableMerit -= cost
  next.unlockedCareerClasses = [...new Set([...unlockedCareerClasses(profile), target])]
  next.eliteClass = target === 'byzantine-cataphract' ? 'byzantine-cataphract' : null
  return next
}
