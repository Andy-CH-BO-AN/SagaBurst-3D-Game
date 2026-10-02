import type { BattleStatsSnapshot, PlayerBattleStats } from '../combat/BattleStatsTracker'
import { claimCareerBattle, cloneCareerProfile, canonicalCareerMountId, recordCareerMissionCompletion, type CareerProfile } from './CareerProfile'
import { canUseCareerMount, ownedCareerMountIds } from './CareerMountController'
import type { CareerMountId } from './CareerProfile'
import type { MeritBreakdown } from './MeritCalculator'

export const CAREER_OUTPOST_SESSION_KEY = 'sagaburst_career_outpost_mission'
export const CAREER_OUTPOST_STAGES = [1, 2, 3] as const
export type CareerOutpostStageId = typeof CAREER_OUTPOST_STAGES[number]
export interface CareerOutpostMission {
  id: string
  kind: 'outpost-defense' | 'outpost-relief'
  stageId: CareerOutpostStageId
  acceptedAt: number
  reliefPhase?: 'march' | 'charge'
}
export interface CareerOutpostRecord extends CareerOutpostMission {
  outcome: 'victory' | 'defeat'
  completed: boolean
  stats: PlayerBattleStats
  merit: MeritBreakdown
}
export function isCareerOutpostStageId(value: unknown): value is CareerOutpostStageId {
  return CAREER_OUTPOST_STAGES.includes(value as CareerOutpostStageId)
}
export function isCareerOutpostUnlocked(profile: CareerProfile, stageId: CareerOutpostStageId): boolean {
  return profile.rank !== 'recruit' && (stageId === 1 || Boolean(profile.completedOutpostStages?.includes((stageId - 1) as CareerOutpostStageId)))
}
export function acceptCareerOutpost(current: CareerProfile, stageId: CareerOutpostStageId, id: string = crypto.randomUUID()): CareerProfile | null {
  if (!isCareerOutpostUnlocked(current, stageId) || current.activeMission || current.activeOutpostMission || current.townEvent?.state === 'hostile') return null
  const profile = cloneCareerProfile(current)
  profile.activeOutpostMission = { id, kind: 'outpost-defense', stageId, acceptedAt: Date.now() }
  return profile
}
export function claimCareerOutpost(current: CareerProfile, missionId: string, outcome: 'victory' | 'defeat', stats: BattleStatsSnapshot) {
  const mission = current.activeOutpostMission
  if (!mission || mission.id !== missionId) throw new Error('Career Outpost mission does not match')
  const claim = claimCareerBattle(current, { battleId: missionId, outcome, role: 'defense', stats }, 'mission')
  if (claim.alreadyClaimed) return claim
  const profile = claim.profile
  if (outcome === 'victory') recordCareerMissionCompletion(profile, 2)
  profile.outpostBattleRecords = [...(profile.outpostBattleRecords ?? []), {
    ...mission, outcome, completed: outcome === 'victory', stats: { ...stats.player }, merit: { ...claim.meritBreakdown },
  }]
  if (outcome === 'victory' && mission.kind === 'outpost-defense') {
    profile.completedOutpostStages = [...new Set([...(profile.completedOutpostStages ?? []), mission.stageId])]
  }
  if (outcome === 'victory' && mission.kind === 'outpost-relief') {
    profile.completedOutpostRelief = true
  }
  return claim
}
export function clearCareerOutpost(current: CareerProfile): CareerProfile {
  const profile = cloneCareerProfile(current)
  delete profile.activeOutpostMission
  return profile
}

export function isCareerOutpostReliefUnlocked(profile: CareerProfile): boolean {
  return profile.rank !== 'recruit' && CAREER_OUTPOST_STAGES.every(stage => profile.completedOutpostStages?.includes(stage))
}
export function resolveCareerReliefMount(profile: CareerProfile): CareerMountId | undefined {
  if (profile.selectedMountId && canUseCareerMount(profile, profile.selectedMountId)) return canonicalCareerMountId(profile.selectedMountId)
  return ownedCareerMountIds(profile).find(id => canUseCareerMount(profile, id))
}
export function acceptCareerOutpostRelief(current: CareerProfile, id: string = crypto.randomUUID()): CareerProfile | null {
  const mount = resolveCareerReliefMount(current)
  if (!isCareerOutpostReliefUnlocked(current) || !mount || current.activeMission || current.activeOutpostMission || current.townEvent?.state === 'hostile') return null
  const profile = cloneCareerProfile(current)
  profile.selectedMountId = mount
  profile.activeOutpostMission = { id, kind: 'outpost-relief', stageId: 3, acceptedAt: Date.now(), reliefPhase: 'march' }
  return profile
}
