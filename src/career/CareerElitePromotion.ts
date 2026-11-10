import { cloneCareerProfile, enlistmentMerit, promoteCareer, type CareerProfile, type CareerRank } from './CareerProfile'
import type { CharacterFaction } from '../world/CharacterVisuals'

export type CareerClassOfferKind = 'current' | 'appoint' | 'merit-locked' | 'purchase' | 'insufficient-merit' | 'switch' | 'unavailable'
export interface CareerClassOffer { kind: CareerClassOfferKind; cost: number; shortfall: number }

/** One class road (T4 Captain or T5 Commander). Both stages and both factions share these appoint/purchase/switch rules;
 * each road owns only its class list, prices and the profile fields that record it. */
export interface CareerClassRoad<T extends string> {
  /** Rank appointed from (free first class) and the rank whose body the class decides. */
  fromRank: CareerRank
  rank: CareerRank
  /** Per faction; the first entry is the class a legacy save without a record is using. */
  classes: Readonly<Record<CharacterFaction, readonly T[]>>
  /** Enlistment merit needed for the free first appointment. Nothing is deducted. */
  firstMerit: Readonly<Record<T, number>>
  /** availableMerit spent to unlock a further class permanently for this enlistment. */
  price: Readonly<Record<T, number>>
  /** Class in use, only while holding `rank`. */
  current(profile: CareerProfile): T | null
  /** Permanently unlocked classes (distinct from the one in use). */
  unlocked(profile: CareerProfile): readonly T[]
  /** Record the class in use and the unlock set on the staged clone. */
  write(next: CareerProfile, target: T, unlocked: readonly T[]): void
}

export function isRoadClass<T extends string>(road: CareerClassRoad<T>, faction: CharacterFaction, value: unknown): value is T {
  return (road.classes[faction] as readonly unknown[] | undefined)?.includes(value) ?? false
}

/** Live authority: this enlistment, on this road's ranks, with no active deployment/ending. NPC/death checks stay with the scene. */
function serviceReady<T extends string>(road: CareerClassRoad<T>, profile: CareerProfile): boolean {
  return (profile.rank === road.fromRank || profile.rank === road.rank)
    && !profile.careerRetirement && !profile.activeMission && !profile.activeOutpostMission
    && !profile.activeRace && profile.townEvent?.state !== 'hostile'
}

/** Single decision owner for both the cards and the transaction. A class of the other faction is never offered. */
export function classRoadOffer<T extends string>(road: CareerClassRoad<T>, profile: CareerProfile, target: T): CareerClassOffer {
  const offer = (kind: CareerClassOfferKind, cost = 0, shortfall = 0): CareerClassOffer => ({ kind, cost, shortfall })
  if (!serviceReady(road, profile) || !isRoadClass(road, profile.faction, target)) return offer('unavailable')
  if (profile.rank === road.fromRank) {
    const required = road.firstMerit[target], merit = enlistmentMerit(profile)
    return merit >= required ? offer('appoint') : offer('merit-locked', 0, required - merit)
  }
  if (road.current(profile) === target) return offer('current')
  if (road.unlocked(profile).includes(target)) return offer('switch')
  const price = road.price[target]
  return profile.availableMerit >= price ? offer('purchase', price) : offer('insufficient-merit', price, price - profile.availableMerit)
}

/** Pure transaction on a clone; the caller saves it once. Returns null when the live offer is not actionable. */
export function applyClassRoad<T extends string>(road: CareerClassRoad<T>, profile: CareerProfile, target: T): CareerProfile | null {
  const { kind, cost } = classRoadOffer(road, profile, target)
  if (kind !== 'appoint' && kind !== 'purchase' && kind !== 'switch') return null
  // First appointment reuses ordinary promotion (rank, tutorial receipt, one-time grants); purchases and switches never re-grant.
  const next = kind === 'appoint' ? promoteCareer(profile) : cloneCareerProfile(profile)
  if (!next || next.rank !== road.rank) return null
  next.availableMerit -= cost
  road.write(next, target, [...new Set([...road.unlocked(profile), target])])
  return next
}

// ---- T5 Commander road ------------------------------------------------------------------------

export type CareerClassId = 'roman-commander' | 'byzantine-cataphract' | 'viking-commander' | 'ironblood-warlord'
/** Non-default T5 class stored in eliteClass; the faction default is stored as null. */
export type CareerEliteClass = 'byzantine-cataphract' | 'ironblood-warlord'
export const CAREER_CLASSES_BY_FACTION: Readonly<Record<CharacterFaction, readonly CareerClassId[]>> = {
  roman: ['roman-commander', 'byzantine-cataphract'], viking: ['viking-commander', 'ironblood-warlord'],
}
export const CAREER_CLASS_IDS: readonly CareerClassId[] = [...CAREER_CLASSES_BY_FACTION.roman, ...CAREER_CLASSES_BY_FACTION.viking]
export const CAREER_CLASS_FIRST_MERIT: Readonly<Record<CareerClassId, number>> = { 'roman-commander': 20000, 'byzantine-cataphract': 30000, 'viking-commander': 20000, 'ironblood-warlord': 30000 }
export const CAREER_CLASS_PRICE: Readonly<Record<CareerClassId, number>> = { 'roman-commander': 20000, 'byzantine-cataphract': 30000, 'viking-commander': 20000, 'ironblood-warlord': 30000 }
export const isCareerClassId = (value: unknown): value is CareerClassId => (CAREER_CLASS_IDS as readonly unknown[]).includes(value)
export const isCareerEliteClass = (value: unknown): value is CareerEliteClass => value === 'byzantine-cataphract' || value === 'ironblood-warlord'

type ClassProfile = Pick<CareerProfile, 'faction' | 'rank' | 'eliteClass' | 'unlockedCareerClasses'>

/** The T5 class in use, or null when the profile is not a Commander. A missing/foreign eliteClass is the faction default. */
export function currentCareerClass(profile: Pick<CareerProfile, 'faction' | 'rank' | 'eliteClass'>): CareerClassId | null {
  if (profile.rank !== 'commander') return null
  const classes = CAREER_CLASSES_BY_FACTION[profile.faction]
  return classes.includes(profile.eliteClass as CareerClassId) ? profile.eliteClass as CareerClassId : classes[0]
}

/** Unlocked is distinct from current. A save without the record unlocks only the class in use. */
export function unlockedCareerClasses(profile: ClassProfile): readonly CareerClassId[] {
  const current = currentCareerClass(profile)
  if (!current) return []
  return profile.unlockedCareerClasses ?? [current]
}

export const T5_CLASS_ROAD: CareerClassRoad<CareerClassId> = {
  fromRank: 'captain', rank: 'commander', classes: CAREER_CLASSES_BY_FACTION,
  firstMerit: CAREER_CLASS_FIRST_MERIT, price: CAREER_CLASS_PRICE,
  current: currentCareerClass, unlocked: unlockedCareerClasses,
  write(next, target, unlocked) {
    next.unlockedCareerClasses = [...unlocked]
    next.eliteClass = isCareerEliteClass(target) ? target : null
  },
}

export const careerClassOffer = (profile: CareerProfile, target: CareerClassId): CareerClassOffer => classRoadOffer(T5_CLASS_ROAD, profile, target)
export const applyCareerClass = (profile: CareerProfile, target: CareerClassId): CareerProfile | null => applyClassRoad(T5_CLASS_ROAD, profile, target)
