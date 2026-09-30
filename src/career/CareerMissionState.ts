import type { BattleStatsSnapshot, PlayerBattleStatsCheckpoint } from '../combat/BattleStatsTracker'
import type { CombatEvent } from '../combat/CombatAttribution'
import type { CareerMountId } from './CareerProfile'

export type CareerMissionPhase = 'ASSEMBLING' | 'MARCHING' | 'ENGAGING' | 'RETURNING' | 'PREPARING' | 'ATTACKING' | 'VICTORY_LOCKED' | 'FAILURE_LOCKED' | 'RESET' | 'RESULT'
export type CareerMissionOutcome = 'victory' | 'failure'

export interface CareerMissionMeritBreakdown {
  damage: number
  kills: number
  contribution: number
  total: number
}

export interface CareerMissionResult {
  outcome: CareerMissionOutcome
  stats: BattleStatsSnapshot['player']
  merit: CareerMissionMeritBreakdown
  claimed: boolean
  defense?: { civilianSurvived: number; civilianDeaths: number }
}

export interface CareerMissionMountState {
  activeMountId?: CareerMountId
  hp: Partial<Record<CareerMountId, number>>
  unavailable: CareerMountId[]
}

export interface ActiveCareerMission {
  id: string
  templateId: string
  kind?: 'bandit' | 'patrol' | 'town-defense'
  targetCampId: number
  phase: CareerMissionPhase
  targetActorIds: string[]
  friendlyActorIds: string[]
  deadTargetActorIds?: string[]
  deadFriendlyActorIds?: string[]
  deadCivilianActorIds?: string[]
  playerStats?: PlayerBattleStatsCheckpoint
  routeStage?: number
  patrolStage?: number
  defenseElapsed?: number
  defensePreparationElapsed?: number
  civilianActorIds?: string[]
  mountState?: CareerMissionMountState
  acceptedAt: number
  result?: CareerMissionResult
}

export function createCareerMissionId(templateId: string, now = Date.now(), nonce?: string): string {
  const safeNonce = nonce ?? Math.random().toString(36).slice(2, 9)
  return `${templateId}-${Math.max(0, Math.floor(now)).toString(36)}-${safeNonce}`
}

export function createActiveCareerMission(
  templateId: string,
  targetCampId: number,
  enemyCount: number,
  friendlySoldierCount: number,
  id = createCareerMissionId(templateId),
  kind: 'bandit' | 'patrol' = 'bandit',
  leaderActorId = `${id}:leader`,
): ActiveCareerMission {
  return {
    id,
    templateId,
    kind,
    targetCampId,
    phase: 'ASSEMBLING',
    targetActorIds: Array.from({ length: enemyCount }, (_, index) => `${id}:bandit:${index}`),
    friendlyActorIds: [
      leaderActorId,
      ...Array.from({ length: friendlySoldierCount }, (_, index) => `${id}:friendly:${index}`),
    ],
    acceptedAt: Date.now(),
  }
}

export function createTownDefenseMission(
  friendlyActorIds: string[],
  civilianActorIds: string[],
  id = createCareerMissionId('recruit-town-defense-01'),
): ActiveCareerMission {
  return {
    id,
    templateId: 'recruit-town-defense-01',
    kind: 'town-defense',
    targetCampId: -1,
    phase: 'PREPARING',
    targetActorIds: Array.from({ length: 50 }, (_, index) => `${id}:attacker:${index}`),
    friendlyActorIds: [...friendlyActorIds],
    civilianActorIds: [...civilianActorIds],
    acceptedAt: Date.now(),
  }
}

export function acceptsCareerMissionStat(mission: ActiveCareerMission, event: CombatEvent): boolean {
  if (event.type === 'structure_damaged' || event.type === 'structure_destroyed') return false
  if (event.type === 'damage_applied' && event.target.targetId === 'player') return true
  if (event.source.actorType !== 'player') return false
  if (mission.targetActorIds.includes(event.target.targetId)) return true
  return event.type === 'damage_applied'
    && Boolean(event.target.ownerActorId && mission.targetActorIds.includes(event.target.ownerActorId))
}

export function resolveCareerMissionOutcome(
  playerDead: boolean,
  rosterRegistrationComplete: boolean,
  remainingTargets: number,
): CareerMissionOutcome | null {
  if (playerDead) return 'failure'
  return rosterRegistrationComplete && remainingTargets === 0 ? 'victory' : null
}
