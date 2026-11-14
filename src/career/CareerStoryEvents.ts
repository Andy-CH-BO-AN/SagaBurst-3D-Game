import type { CareerProfile } from './CareerProfileTypes'

/**
 * Deferrable Town story events. They live beside the Career profile, never inside the new-recruit tutorial:
 * each is offered once by a real, saved milestone, accepted by talking to an NPC, and settled once by the
 * ordinary activity's own result owner. This module is pure profile logic; it imports no Career runtime.
 */
export const CAREER_STORY_EVENT_IDS = ['commander-circuit-race', 'veteran-squad-spar'] as const
export type CareerStoryEventId = typeof CAREER_STORY_EVENT_IDS[number]
export type CareerStoryOutcome = 'victory' | 'defeat'

/** Fixed per-event awards. They replace the activity's ordinary reward; they are never added to it. */
export const CAREER_STORY_REWARDS: Readonly<Record<CareerStoryEventId, Readonly<Record<CareerStoryOutcome, number>>>> = Object.freeze({
  'commander-circuit-race': { victory: 500, defeat: 29 },
  'veteran-squad-spar': { victory: 1000, defeat: 100 },
})

/**
 * pending: offered, waiting for the player to accept it at the NPC.
 * active: accepted; `sourceId` names the one race session / mission that may settle it.
 * settled: used. A settled event that carries `outcome`/`merit` was rewarded; one without was closed by a legacy save.
 * "Not yet triggered" is the absence of the event.
 */
export type CareerStoryStatus = 'pending' | 'active' | 'settled'
export interface CareerStoryEvent {
  status: CareerStoryStatus
  sourceId?: string
  outcome?: CareerStoryOutcome
  merit?: number
}
export interface CareerStoryState {
  version: 1
  events: Partial<Record<CareerStoryEventId, CareerStoryEvent>>
  /** The first eagle purchase happened; kept after the eagle is sold so the guidance never reopens. */
  eaglePurchased?: true
  /** The trainer's opening line was shown once. */
  eagleIntroSeen?: true
}

export const isCareerStoryEventId = (value: unknown): value is CareerStoryEventId =>
  (CAREER_STORY_EVENT_IDS as readonly unknown[]).includes(value)

export function careerStoryEvent(profile: Pick<CareerProfile, 'careerStory'>, id: CareerStoryEventId): CareerStoryEvent | undefined {
  return profile.careerStory?.events[id]
}
export function careerStoryPending(profile: Pick<CareerProfile, 'careerStory'>, id: CareerStoryEventId): boolean {
  return careerStoryEvent(profile, id)?.status === 'pending'
}

function state(profile: CareerProfile): CareerStoryState {
  return profile.careerStory ??= { version: 1, events: {} }
}

function offer(profile: CareerProfile, id: CareerStoryEventId): boolean {
  const current = state(profile)
  if (current.events[id]) return false
  current.events[id] = { status: 'pending' }
  return true
}

/** Saved legacy facts that prove the first formal victory already happened. */
export function hasFormalVictoryEvidence(profile: Pick<CareerProfile, 'careerMissionCompletions' | 'careerMissionCompletionsByTier'
  | 'completedCareerMissionTemplateIds' | 'outpostBattleRecords'>): boolean {
  return (profile.careerMissionCompletions ?? 0) > 0
    || Object.values(profile.careerMissionCompletionsByTier ?? {}).some(count => (count ?? 0) > 0)
    || (profile.completedCareerMissionTemplateIds?.length ?? 0) > 0
    || Boolean(profile.outpostBattleRecords?.some(record => record.outcome === 'victory'))
}

/**
 * Call from the canonical shop transaction, on the same staged clone as the purchase. `hadHorse` is the ownership
 * before this purchase (including the old tutorial receipt) so a second or repeat purchase never offers it again.
 */
export function recordCareerStoryPurchase(profile: CareerProfile, kind: string, id: string, hadHorse: boolean): void {
  if (kind !== 'mount') return
  if (id === 'horse' && !hadHorse) offer(profile, 'commander-circuit-race')
  if (id === 'xongkoro') state(profile).eaglePurchased = true
}

/** Call from the canonical formal-mission completion counter, before it increments, with the pre-victory evidence. */
export function recordCareerStoryFormalVictory(profile: CareerProfile, hadFormalVictory: boolean): void {
  if (!hadFormalVictory) offer(profile, 'veteran-squad-spar')
}

/** pending → active, bound to the one activity that may settle it. Returns false when the offer is not open. */
export function activateCareerStoryEvent(profile: CareerProfile, id: CareerStoryEventId, sourceId: string): boolean {
  const event = careerStoryEvent(profile, id)
  if (!event || event.status !== 'pending' || !sourceId) return false
  state(profile).events[id] = { status: 'active', sourceId }
  return true
}

/** A draw, cancellation or load failure never uses the offer: active → pending again. */
export function releaseCareerStoryEvent(profile: CareerProfile, id: CareerStoryEventId, sourceId: string): void {
  const event = careerStoryEvent(profile, id)
  if (event?.status === 'active' && event.sourceId === sourceId) state(profile).events[id] = { status: 'pending' }
}

/**
 * Records a valid result and returns the fixed award for the caller to add to its own merit totals, or null when this
 * activity does not own the event (ordinary activity, stale ID, already settled): the ordinary reward then applies.
 */
export function settleCareerStoryEvent(profile: CareerProfile, id: CareerStoryEventId, sourceId: string, outcome: CareerStoryOutcome): number | null {
  const event = careerStoryEvent(profile, id)
  if (!event || event.status !== 'active' || event.sourceId !== sourceId) return null
  const merit = CAREER_STORY_REWARDS[id][outcome]
  state(profile).events[id] = { status: 'settled', sourceId, outcome, merit }
  return merit
}

/** The rewarded settlement of this activity, for result screens; null for an ordinary activity. */
export function careerStorySettlement(profile: Pick<CareerProfile, 'careerStory'>, id: CareerStoryEventId, sourceId: string): CareerStoryEvent | null {
  const event = careerStoryEvent(profile, id)
  return event?.status === 'settled' && event.sourceId === sourceId && event.outcome ? event : null
}

export function markCareerStoryEagleIntroSeen(profile: CareerProfile): void { state(profile).eagleIntroSeen = true }

/** The vendor's line when this very purchase opened the commander invitation; null otherwise. */
export function careerStoryPurchaseLine(before: CareerProfile, after: CareerProfile): string | null {
  return !careerStoryEvent(before, 'commander-circuit-race') && careerStoryPending(after, 'commander-circuit-race')
    ? '指揮官聽說你買了戰馬。他想看看你騎得怎樣，有空就去找他。' : null
}

export interface CareerStoryLoadFacts {
  /** The horse is owned now or was bought before (including the old tutorial receipt). */
  horseOwned: boolean
  formalVictory: boolean
  eagleOwned: boolean
  activeRaceId?: string
  activeMissionId?: string
}

const objectOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

function parseEvent(id: CareerStoryEventId, value: unknown): CareerStoryEvent | null {
  const raw = objectOf(value)
  if (!raw || !['pending', 'active', 'settled'].includes(raw.status as string)) return null
  const sourceId = typeof raw.sourceId === 'string' && raw.sourceId && raw.sourceId.length <= 256 ? raw.sourceId : undefined
  if (raw.status === 'pending') return { status: 'pending' }
  if (raw.status === 'active') return sourceId ? { status: 'active', sourceId } : { status: 'pending' }
  const outcome = raw.outcome === 'victory' || raw.outcome === 'defeat' ? raw.outcome : undefined
  return sourceId && outcome && raw.merit === CAREER_STORY_REWARDS[id][outcome]
    ? { status: 'settled', sourceId, outcome, merit: raw.merit } : { status: 'settled' }
}

/**
 * Load-time normalization. A save with no state predates this feature: the milestones it already passed are closed
 * without a reward and without replaying the offer. A save that has state is authoritative and is never re-derived.
 * An accepted event whose activity no longer exists was cancelled or failed to load, so it is offered again instead of
 * being consumed. Returns undefined only for an old save with nothing to keep.
 */
export function parseCareerStoryState(value: unknown, facts: CareerStoryLoadFacts): CareerStoryState | undefined {
  const raw = objectOf(value)
  const known = raw?.version === 1
  const rawEvents = known ? objectOf(raw.events) ?? {} : {}
  const events: CareerStoryState['events'] = {}
  for (const id of CAREER_STORY_EVENT_IDS) {
    const parsed = known ? parseEvent(id, rawEvents[id]) : null
    if (parsed) events[id] = parsed
  }
  if (!known) {
    if (facts.horseOwned) events['commander-circuit-race'] = { status: 'settled' }
    if (facts.formalVictory) events['veteran-squad-spar'] = { status: 'settled' }
  }
  const live = (id: CareerStoryEventId, sourceId: string): boolean => id === 'commander-circuit-race'
    ? facts.activeRaceId === sourceId : facts.activeMissionId === sourceId
  for (const id of CAREER_STORY_EVENT_IDS) {
    const event = events[id]
    if (event?.status === 'active' && !live(id, event.sourceId!)) events[id] = { status: 'pending' }
  }
  const eaglePurchased = known ? raw.eaglePurchased === true : facts.eagleOwned
  const eagleIntroSeen = known && raw.eagleIntroSeen === true
  if (!known && !Object.keys(events).length && !eaglePurchased) return undefined
  return { version: 1, events, ...(eaglePurchased ? { eaglePurchased: true as const } : {}),
    ...(eagleIntroSeen ? { eagleIntroSeen: true as const } : {}) }
}
