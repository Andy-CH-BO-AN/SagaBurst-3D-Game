import type { CareerProfile } from './CareerProfile'
import { applyClassRoad, classRoadOffer, type CareerClassOffer, type CareerClassRoad } from './CareerElitePromotion'
import type { CharacterFaction } from '../world/CharacterVisuals'

/** T4 Captain classes. Independent of the T5 eliteClass/unlockedCareerClasses records; same road rules (CareerElitePromotion). */
export type T4ClassId = 'paladin' | 'centurion' | 'varangian' | 'dragon-oathguard'
export const T4_CLASSES_BY_FACTION: Readonly<Record<CharacterFaction, readonly T4ClassId[]>> = {
  roman: ['paladin', 'centurion'], viking: ['varangian', 'dragon-oathguard'],
}
export const T4_CLASS_IDS: readonly T4ClassId[] = [...T4_CLASSES_BY_FACTION.roman, ...T4_CLASSES_BY_FACTION.viking]
/** Enlistment merit needed for the free first appointment from Veteran. Nothing is deducted. */
export const T4_CLASS_FIRST_MERIT: Readonly<Record<T4ClassId, number>> = { paladin: 5000, centurion: 7000, varangian: 5000, 'dragon-oathguard': 7000 }
/** availableMerit spent to unlock the second T4 class permanently for this enlistment. */
export const T4_CLASS_PRICE: Readonly<Record<T4ClassId, number>> = { paladin: 5000, centurion: 7000, varangian: 5000, 'dragon-oathguard': 7000 }

type T4Profile = Pick<CareerProfile, 'faction' | 'rank' | 't4Specialization' | 'unlockedT4Classes'>

export const isT4ClassId = (value: unknown): value is T4ClassId => (T4_CLASS_IDS as readonly unknown[]).includes(value)

/** The T4 class in use, or null outside Captain (T5 identity is decided only by eliteClass). Legacy Captains use the faction default. */
export function currentT4Class(profile: Pick<CareerProfile, 'faction' | 'rank' | 't4Specialization'>): T4ClassId | null {
  if (profile.rank !== 'captain') return null
  const classes = T4_CLASSES_BY_FACTION[profile.faction]
  return classes.includes(profile.t4Specialization as T4ClassId) ? profile.t4Specialization as T4ClassId : classes[0]
}

/** Unlocked is distinct from current. A legacy Captain unlocks only its default; a Commander keeps only an explicit record. */
export function unlockedT4Classes(profile: T4Profile): readonly T4ClassId[] {
  if (profile.rank !== 'captain' && profile.rank !== 'commander') return []
  if (profile.unlockedT4Classes) return profile.unlockedT4Classes
  const current = currentT4Class(profile)
  return current ? [current] : []
}

export const T4_CLASS_ROAD: CareerClassRoad<T4ClassId> = {
  fromRank: 'veteran', rank: 'captain', classes: T4_CLASSES_BY_FACTION,
  firstMerit: T4_CLASS_FIRST_MERIT, price: T4_CLASS_PRICE,
  current: currentT4Class, unlocked: unlockedT4Classes,
  write(next, target, unlocked) {
    next.unlockedT4Classes = [...unlocked]
    next.t4Specialization = target
  },
}

/** Single decision owner for both the cards and the transaction. Commanders are never offered a T4 class. */
export const t4ClassOffer = (profile: CareerProfile, target: T4ClassId): CareerClassOffer => classRoadOffer(T4_CLASS_ROAD, profile, target)
/** Pure transaction on a clone; the caller saves it once. Returns null when the live offer is not actionable. */
export const applyT4Class = (profile: CareerProfile, target: T4ClassId): CareerProfile | null => applyClassRoad(T4_CLASS_ROAD, profile, target)
