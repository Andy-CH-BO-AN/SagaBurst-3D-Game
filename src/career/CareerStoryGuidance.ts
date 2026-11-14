import { canAppointCareerRank } from './CareerPromotionAuthority'
import { CAREER_CLASSES_BY_FACTION, careerClassOffer } from './CareerElitePromotion'
import { T4_CLASSES_BY_FACTION, t4ClassOffer } from './CareerT4Promotion'
import { careerItemTotal } from './CareerInventory'
import { CAREER_RANK_LABELS, CAREER_RANKS, ownsCareerHorse, type CareerProfile } from './CareerProfile'
import { XONGKORO_PRODUCT } from './CareerShopCatalog'
import { careerStoryPending, type CareerStoryEventId } from './CareerStoryEvents'

/** Service NPC IDs the Town guidance can point at. */
export type StoryGuidanceNpc = 'commander' | 'deployment' | 'captain' | 'eagle-trainer'
export type StoryGuidanceKey = `story:${CareerStoryEventId}` | `appoint:${string}` | 'eagle'

export interface StoryGuidance {
  key: StoryGuidanceKey
  npc: StoryGuidanceNpc
  /** The NPC's name on the arrow. */
  npcName: string
  title: string
  detail: string
  /** Opening line shown once; the persisted receipt lives in `careerStory.eagleIntroSeen`. */
  opening?: string
}

export interface StoryGuidanceContext {
  /** The player is riding an owned, usable ordinary horse that the race entry rules accept. */
  raceHorseReady: boolean
  /** Keys the player asked to be reminded of later; they yield to the next guidance for the rest of the scene. */
  deferred: ReadonlySet<string>
  /** The service NPC is alive, reachable and peaceful right now. */
  available(npc: StoryGuidanceNpc): boolean
}

const NPC_NAMES: Readonly<Record<StoryGuidanceNpc, string>> = {
  commander: '指揮官', deployment: '士官長', captain: '騎兵隊長', 'eagle-trainer': 'xongkoro 遊俠場主',
}

/** Activities and ending states own the HUD; the guidance never speaks over them. */
export function townGuidanceIdle(profile: CareerProfile): boolean {
  return !profile.activeMission && !profile.activeOutpostMission && !profile.activeRace
    && !profile.careerRetirement && profile.townEvent?.state !== 'hostile'
}

/**
 * Who can appoint the player right now, reusing the appointment authorities themselves: the generic one-step rule
 * for Recruit/Soldier, and the class roads for Veteran → T4 and T4 → T5. No threshold is repeated here.
 */
export function careerAppointmentTarget(profile: CareerProfile): { npc: 'captain' | 'commander'; next: string } | null {
  const nextRank = CAREER_RANKS[CAREER_RANKS.indexOf(profile.rank) + 1]
  if (!nextRank) return null
  const label = CAREER_RANK_LABELS[nextRank]
  if (canAppointCareerRank(profile, 'captain')) return { npc: 'captain', next: label }
  if (profile.rank === 'veteran' && T4_CLASSES_BY_FACTION[profile.faction].some(target => t4ClassOffer(profile, target).kind === 'appoint')) return { npc: 'captain', next: label }
  if (profile.rank === 'captain' && CAREER_CLASSES_BY_FACTION[profile.faction].some(target => careerClassOffer(profile, target).kind === 'appoint')) return { npc: 'commander', next: label }
  return null
}

/** First eagle: a formal Captain or Commander who can pay and never bought one. Derived live from the latest profile. */
export function firstEagleReady(profile: CareerProfile): boolean {
  return (profile.rank === 'captain' || profile.rank === 'commander')
    && profile.availableMerit >= XONGKORO_PRODUCT.price
    && !profile.careerStory?.eaglePurchased && careerItemTotal(profile, XONGKORO_PRODUCT.id) === 0
    && !profile.ownedMounts.includes('xongkoro')
}

/** Whether the Commander still has an open race invitation the player could act on (a horse is owned). */
export function raceInvitationOpen(profile: CareerProfile): boolean {
  return careerStoryPending(profile, 'commander-circuit-race') && ownsCareerHorse(profile)
}

/**
 * Whether this NPC has an invitation to speak first. Deferring the arrow never closes it: the player can always come
 * back and accept at the original NPC.
 */
export function storyDialogueOpen(profile: CareerProfile, serviceId: string): boolean {
  if (!townGuidanceIdle(profile)) return false
  return serviceId === 'commander' ? raceInvitationOpen(profile)
    : serviceId === 'deployment' && careerStoryPending(profile, 'veteran-squad-spar')
}

/**
 * One guidance at a time, in this order: waiting story invitations → appointment → first eagle. Ordinary activities,
 * ending states and a hostile Town hide all of it. When the highest eligible target's NPC is unavailable the guidance
 * pauses instead of substituting a lower one; a deferred item yields to the next.
 */
export function selectStoryGuidance(profile: CareerProfile, context: StoryGuidanceContext): StoryGuidance | null {
  if (!townGuidanceIdle(profile)) return null
  const candidates: StoryGuidance[] = []
  if (raceInvitationOpen(profile) && context.raceHorseReady) candidates.push({
    key: 'story:commander-circuit-race', npc: 'commander', npcName: NPC_NAMES.commander,
    title: '指揮官想看你騎馬', detail: '靠近指揮官按 E，可接受繞城賽馬邀請；也可以晚點再去。' })
  if (careerStoryPending(profile, 'veteran-squad-spar')) candidates.push({
    key: 'story:veteran-squad-spar', npc: 'deployment', npcName: NPC_NAMES.deployment,
    title: '士官長有話要說', detail: '老兵想看你們小隊怎麼配合；靠近士官長按 E，可接受小隊切磋或晚點再說。' })
  const appointment = careerAppointmentTarget(profile)
  if (appointment) candidates.push({
    key: `appoint:${profile.rank}`, npc: appointment.npc, npcName: NPC_NAMES[appointment.npc],
    title: `可以晉升為${appointment.next}`, detail: `前往${NPC_NAMES[appointment.npc]}，按 E 開啟任命選項。` })
  if (firstEagleReady(profile)) candidates.push({
    key: 'eagle', npc: 'eagle-trainer', npcName: NPC_NAMES['eagle-trainer'],
    title: '可以購買第一隻巨鷹', detail: `前往 xongkoro 遊俠場主，按 E 開啟商店（${XONGKORO_PRODUCT.price.toLocaleString()} 軍功）。`,
    ...(profile.careerStory?.eagleIntroSeen ? {} : { opening: `${NPC_NAMES['eagle-trainer']}：「你的軍功足以馴養一隻巨鷹了。想飛的話，來訓練場找我。」` }) })
  const next = candidates.find(candidate => !context.deferred.has(candidate.key))
  return next && context.available(next.npc) ? next : null
}
