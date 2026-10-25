import type { CareerProfile, CareerRank } from './CareerProfile'
import type { CharacterFaction } from '../world/CharacterVisuals'

export const CAREER_TUTORIAL_STAGES = ['recruit', 'town', 'captain', 'hr', 'commander'] as const
export type CareerTutorialStageId = typeof CAREER_TUTORIAL_STAGES[number]
export type CareerTutorialRewardId = 'recruit' | 'weapon' | 'duel' | 'horse'
export type CareerTutorialStatus = 'locked' | 'available' | 'active' | 'deferred' | 'completed'
export interface CareerTutorialStage {
  status: CareerTutorialStatus
  step: string
  operations: string[]
  replay: boolean
}
export interface CareerTutorialSession {
  id: string
  careerId: string
  stage: 'recruit' | 'captain'
  replay: boolean
  returnFaction: CharacterFaction
}
export interface CareerTutorialState {
  version: 1
  /** Immutable identity of this enlistment; callbacks must check it before saving. */
  careerId: string
  legacy: boolean
  recruit: CareerTutorialStage
  town: CareerTutorialStage
  captain: CareerTutorialStage
  hr: CareerTutorialStage
  commander: CareerTutorialStage
  rewards: Partial<Record<CareerTutorialRewardId, number>>
  purchases: { weaponIds: string[]; horse: boolean }
  settledMissionIds: string[]
  duelOutcome?: 'victory' | 'defeat'
  session?: CareerTutorialSession
}

/** Each group represents one actual operation. The opening look/movement group may complete in either order. */
export const CAREER_TUTORIAL_OPERATIONS: Readonly<Record<CareerTutorialStageId, readonly (readonly string[])[]>> = {
  recruit: [['look', 'movement'], ['equipment'], ['melee-hit-1', 'melee-hit-2'], ['shield'], ['bow-hit'], ['horse-mounted'], ['ride1'], ['ride2'], ['ride3'], ['dismounted']],
  town: [['report'], ['weapon'], ['duel-intro'], ['duel'], ['missions'], ['horse-intro'], ['horse'], ['horse-use']],
  captain: [['hud'], ['selected'], ['formation'], ['defend'], ['attack'], ['charge'], ['back']],
  hr: [['recruited'], ['follow']],
  commander: [['tower-entrance'], ['tower-ramp'], ['tower-top'], ['all'], ['defend'], ['squad'], ['formation']],
}
export function careerTutorialStep(stage: CareerTutorialStageId, operations: readonly string[]): string {
  return CAREER_TUTORIAL_OPERATIONS[stage].find(group => group.some(op => !operations.includes(op)))?.[0] ?? 'complete'
}
function stage(id: CareerTutorialStageId, status: CareerTutorialStatus): CareerTutorialStage {
  return { status, step: careerTutorialStep(id, []), operations: [], replay: false }
}
export function createCareerTutorialState(rank: CareerRank = 'recruit', newCareer = true): CareerTutorialState {
  return {
    version: 1, careerId: crypto.randomUUID(), legacy: !newCareer,
    recruit: stage('recruit', newCareer ? 'available' : 'deferred'),
    town: stage('town', newCareer ? 'locked' : 'deferred'),
    captain: stage('captain', rank === 'captain' || rank === 'commander' ? 'deferred' : 'locked'),
    hr: stage('hr', 'locked'),
    commander: stage('commander', rank === 'commander' ? 'deferred' : 'locked'),
    rewards: {}, purchases: { weaponIds: [], horse: false }, settledMissionIds: [],
  }
}
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(s => typeof s === 'string' && s.length > 0 && s.length <= 256)
export function parseCareerTutorialState(value: unknown): CareerTutorialState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || typeof raw.careerId !== 'string' || !raw.careerId || raw.careerId.length > 256
    || typeof raw.legacy !== 'boolean' || !raw.purchases || typeof raw.purchases !== 'object'
    || !raw.rewards || typeof raw.rewards !== 'object' || Array.isArray(raw.rewards)
    || !strings(raw.settledMissionIds)) return null
  const purchases = raw.purchases as Record<string, unknown>
  if (!strings(purchases.weaponIds) || typeof purchases.horse !== 'boolean') return null
  const stages = {} as Record<CareerTutorialStageId, CareerTutorialStage>
  for (const id of CAREER_TUTORIAL_STAGES) {
    const part = raw[id] as Record<string, unknown> | undefined
    if (!part || !['locked', 'available', 'active', 'deferred', 'completed'].includes(part.status as string)
      || typeof part.replay !== 'boolean' || !strings(part.operations)) return null
    const allowed = CAREER_TUTORIAL_OPERATIONS[id].flat()
    if (part.operations.some(op => !allowed.includes(op))) return null
    const operations = [...new Set(part.operations)]
    const step = careerTutorialStep(id, operations)
    if (part.step !== step || part.status === 'completed' && step !== 'complete') return null
    stages[id] = { status: part.status as CareerTutorialStatus, replay: part.replay, operations, step }
  }
  const rewards: CareerTutorialState['rewards'] = {}
  for (const [key, amount] of Object.entries(raw.rewards)) {
    if (!['recruit', 'weapon', 'duel', 'horse'].includes(key) || typeof amount !== 'number'
      || !(key === 'duel' ? [20, 500].includes(amount) : amount === ({ recruit: 100, weapon: 20, horse: 50 } as Record<string, number>)[key])) return null
    rewards[key as CareerTutorialRewardId] = amount
  }
  if (raw.duelOutcome !== undefined && raw.duelOutcome !== 'victory' && raw.duelOutcome !== 'defeat') return null
  let session: CareerTutorialSession | undefined
  if (raw.session !== undefined) {
    const s = raw.session as Partial<CareerTutorialSession>
    if (!s || typeof s.id !== 'string' || !s.id || s.id.length > 256 || s.careerId !== raw.careerId
      || s.stage !== 'recruit' && s.stage !== 'captain' || typeof s.replay !== 'boolean'
      || s.returnFaction !== 'roman' && s.returnFaction !== 'viking'
      || !['active', 'completed'].includes(stages[s.stage].status)) return null
    session = { id: s.id, careerId: s.careerId, stage: s.stage, replay: s.replay, returnFaction: s.returnFaction }
  }
  return { version: 1, careerId: raw.careerId, legacy: raw.legacy, ...stages, rewards,
    purchases: { weaponIds: [...new Set(purchases.weaponIds)], horse: purchases.horse },
    settledMissionIds: [...new Set(raw.settledMissionIds)],
    ...(raw.duelOutcome ? { duelOutcome: raw.duelOutcome } : {}), ...(session ? { session } : {}) }
}

/** A receipt accompanies the same save as the successful, canonical shop transaction. */
export function recordCareerTutorialPurchase(profile: CareerProfile, kind: string, id: string): void {
  const tutorial = profile.tutorial
  if (!tutorial) return
  if (kind === 'weapon' && !tutorial.purchases.weaponIds.includes(id)) tutorial.purchases.weaponIds.push(id)
  if (kind === 'mount' && id === 'horse') tutorial.purchases.horse = true
}
export function recordCareerTutorialMissionSettlement(profile: CareerProfile, missionId: string): void {
  if (profile.tutorial && !profile.tutorial.settledMissionIds.includes(missionId)) profile.tutorial.settledMissionIds.push(missionId)
}
export function recordCareerTutorialAppointment(profile: CareerProfile, rank: CareerRank): void {
  if (!profile.tutorial || rank !== 'captain' && rank !== 'commander') return
  const state = profile.tutorial[rank]
  if (state.status === 'locked') state.status = 'available'
}

/** Rewards use fixed per-enlistment receipt keys, never generated session or battle IDs. */
export function claimCareerTutorialReward(profile: CareerProfile, reward: CareerTutorialRewardId): number {
  const t = profile.tutorial
  if (!t || t.rewards[reward] !== undefined) return 0
  const eligible = reward === 'recruit' ? t.recruit.step === 'complete' && !t.recruit.replay
    : reward === 'weapon' ? t.purchases.weaponIds.length > 0 && !t.town.replay
    : reward === 'horse' ? t.purchases.horse && !t.town.replay : Boolean(t.duelOutcome) && !t.town.replay
  if (!eligible) return 0
  const amount = reward === 'duel' ? t.duelOutcome === 'victory' ? 500 : 20 : { recruit: 100, weapon: 20, horse: 50 }[reward]
  t.rewards[reward] = amount
  profile.totalMerit += amount
  profile.availableMerit += amount
  return amount
}
/** Call only at the owner of the accepted gameplay operation; key presses are not proof. */
export function recordCareerTutorialOperation(profile: CareerProfile, stage: CareerTutorialStageId, event: string): boolean {
  const t = profile.tutorial
  if (!t) return false
  const part = t[stage]
  if (part.status === 'locked' || part.status === 'completed') return false
  const group = CAREER_TUTORIAL_OPERATIONS[stage].find(ops => ops.some(op => !part.operations.includes(op)))
  if (!group) return false
  const operation = stage === 'recruit' && event === 'melee-hit'
    ? ['melee-hit-1', 'melee-hit-2'].find(op => !part.operations.includes(op)) : event
  if (!operation || !group.includes(operation) || part.operations.includes(operation)) return false
  part.status = 'active'
  part.operations.push(operation)
  part.step = careerTutorialStep(stage, part.operations)
  if (part.step !== 'complete') return true
  part.status = 'completed'
  if (stage === 'recruit') { claimCareerTutorialReward(profile, 'recruit'); if (t.town.status === 'locked') t.town.status = 'available' }
  if (stage === 'captain' && t.hr.status === 'locked') t.hr.status = 'available'
  return true
}
