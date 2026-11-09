import { cloneCareerProfile, enlistmentMerit, promoteCareer, type CareerProfile } from './CareerProfile'
import type { CareerClassOffer, CareerClassOfferKind } from './CareerElitePromotion'

/** Roman T4 classes. Independent of the T5 eliteClass/unlockedCareerClasses records. */
export type T4ClassId = 'paladin' | 'centurion'
export const T4_CLASS_IDS: readonly T4ClassId[] = ['paladin', 'centurion']
/** Enlistment merit needed for the free first appointment from Veteran. Nothing is deducted. */
export const T4_CLASS_FIRST_MERIT: Readonly<Record<T4ClassId, number>> = { paladin: 5000, centurion: 7000 }
/** availableMerit spent to unlock the second T4 class permanently for this enlistment. */
export const T4_CLASS_PRICE: Readonly<Record<T4ClassId, number>> = { paladin: 5000, centurion: 7000 }

type T4Profile = Pick<CareerProfile, 'faction' | 'rank' | 't4Specialization' | 'unlockedT4Classes'>

export const isT4ClassId = (value: unknown): value is T4ClassId => value === 'paladin' || value === 'centurion'

/** The T4 class in use, or null outside Roman Captain (T5 identity is decided only by eliteClass). Legacy Captains are Paladins. */
export function currentT4Class(profile: T4Profile): T4ClassId | null {
  return profile.faction === 'roman' && profile.rank === 'captain' ? profile.t4Specialization ?? 'paladin' : null
}

/** Unlocked is distinct from current. A legacy Captain unlocks only Paladin; a Commander keeps only an explicit record. */
export function unlockedT4Classes(profile: T4Profile): readonly T4ClassId[] {
  if (profile.faction !== 'roman' || (profile.rank !== 'captain' && profile.rank !== 'commander')) return []
  if (profile.unlockedT4Classes) return profile.unlockedT4Classes
  const current = currentT4Class(profile)
  return current ? [current] : []
}

/** Live authority: this Roman enlistment, Veteran or Captain, with no active deployment/ending. NPC/death checks stay with the scene. */
function serviceReady(profile: CareerProfile): boolean {
  return profile.faction === 'roman' && (profile.rank === 'veteran' || profile.rank === 'captain')
    && !profile.careerRetirement && !profile.activeMission && !profile.activeOutpostMission
    && !profile.activeRace && profile.townEvent?.state !== 'hostile'
}

/** Single decision owner for both the cards and the transaction. Commanders are never offered a T4 class. */
export function t4ClassOffer(profile: CareerProfile, target: T4ClassId): CareerClassOffer {
  const offer = (kind: CareerClassOfferKind, cost = 0, shortfall = 0): CareerClassOffer => ({ kind, cost, shortfall })
  if (!serviceReady(profile) || !isT4ClassId(target)) return offer('unavailable')
  if (profile.rank === 'veteran') {
    const required = T4_CLASS_FIRST_MERIT[target], merit = enlistmentMerit(profile)
    return merit >= required ? offer('appoint') : offer('merit-locked', 0, required - merit)
  }
  if (currentT4Class(profile) === target) return offer('current')
  if (unlockedT4Classes(profile).includes(target)) return offer('switch')
  const price = T4_CLASS_PRICE[target]
  return profile.availableMerit >= price ? offer('purchase', price) : offer('insufficient-merit', price, price - profile.availableMerit)
}

/** Pure transaction on a clone; the caller saves it once. Returns null when the live offer is not actionable. */
export function applyT4Class(profile: CareerProfile, target: T4ClassId): CareerProfile | null {
  const { kind, cost } = t4ClassOffer(profile, target)
  if (kind !== 'appoint' && kind !== 'purchase' && kind !== 'switch') return null
  // First appointment reuses ordinary promotion (rank + tutorial receipt); purchases and switches never re-grant it.
  const next = kind === 'appoint' ? promoteCareer(profile) : cloneCareerProfile(profile)
  if (!next || next.rank !== 'captain') return null
  next.availableMerit -= cost
  next.unlockedT4Classes = kind === 'appoint' ? [target] : [...new Set([...unlockedT4Classes(profile), target])]
  next.t4Specialization = target
  return next
}
