import type { BattleStatsSnapshot, PlayerBattleStatsCheckpoint } from '../combat/BattleStatsTracker'
import type { CombatEvent } from '../combat/CombatAttribution'
import type { UnitPresetId, UnitTier } from '../battle/UnitPresetCatalog'
import type { CareerMountId, CareerRank } from './CareerProfile'
import { townDefenseEnemyCount, TOWN_DEFENSE_TEMPLATE_ID } from './TownDefenseState'

export type CareerMissionPhase = 'ASSEMBLING' | 'MARCHING' | 'ENGAGING' | 'RETURNING' | 'PREPARING' | 'ATTACKING' | 'VICTORY_LOCKED' | 'FAILURE_LOCKED' | 'RESET' | 'RESULT'
export type CareerMissionOutcome = 'victory' | 'failure'
export type CareerMissionKind = 'bandit' | 'patrol' | 'town-defense' | 'enemy-town-assault' | 'cavalry-sweep' | 'duel' | 'veteran-field' | 'veteran-outpost-defense' | 'veteran-outpost-assault'
export interface VeteranOutpostBattleState {
  phase: 'deployment' | 'assault' | 'victory' | 'defeat'
  activePhase: 'deployment' | 'assault'
  assaultElapsedSeconds: number
  deploymentRemainingSeconds: number
  reinforcementTriggered: boolean
  reinforcementSpawned: boolean
  reinforcementArrived: boolean
  reinforcementRemainingSeconds?: number
  battleFinished?: boolean
  reinforcementQueueIndex: number
  assaultChargeTriggered: boolean
  gateHealth?: number
  gateState?: 'closed' | 'open' | 'destroyed'
}

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
  kind?: CareerMissionKind
  targetCampId: number
  phase: CareerMissionPhase
  targetActorIds: string[]
  friendlyActorIds: string[]
  deadTargetActorIds?: string[]
  deadFriendlyActorIds?: string[]
  deadCivilianActorIds?: string[]
  playerDead?: boolean
  playerStats?: PlayerBattleStatsCheckpoint
  duelTier?: UnitTier
  duelPresetId?: UnitPresetId
  duelOpponentActorId?: string
  duelCaptainActorId?: string
  duelRefereeActorId?: string
  duelCountdownElapsed?: number
  duelCombatElapsed?: number
  duelOpponentDead?: boolean
  duelOpponentHp?: number
  duelOpponentMountHp?: number
  duelPlayerHp?: number
  duelPlayerStamina?: number
  duelOpponentAmmo?: number
  mountedMarchProgress?: number
  mountedMarchPosition?: { x: number; z: number }
  followVoicePlayed?: boolean
  sweepAlerted?: boolean
  routeStage?: number
  patrolStage?: number
  defenseElapsed?: number
  defensePreparationElapsed?: number
  defenseReserveCharged?: boolean
  defenseCatDead?: boolean
  survivalElapsed?: number
  reinforcementElapsed?: number
  reinforcementSpawned?: boolean
  reinforcementArrived?: boolean
  reinforcementActorIds?: string[]
  chargedSquadIds?: number[]
  borrowedActorIds?: string[]
  veteranRosterVersion?: 1 | 2
  actorHealth?: Record<string, { hp: number; mountHp?: number }>
  actorPositions?: Record<string, { x: number; z: number; yaw: number }>
  engagedEnemySquadIds?: number[]
  playerHp?: number
  playerStamina?: number
  outpostBattleState?: VeteranOutpostBattleState
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
  id?: string,
  templateId = TOWN_DEFENSE_TEMPLATE_ID,
  rank: CareerRank = 'soldier',
): ActiveCareerMission {
  const missionId = id ?? createCareerMissionId(templateId)
  return {
    id: missionId,
    templateId,
    kind: 'town-defense',
    targetCampId: -1,
    phase: 'PREPARING',
    targetActorIds: Array.from({ length: townDefenseEnemyCount(templateId, rank) }, (_, index) => `${missionId}:attacker:${index}`),
    friendlyActorIds: [...friendlyActorIds],
    civilianActorIds: [...civilianActorIds],
    acceptedAt: Date.now(),
  }
}

export function acceptsCareerMissionStat(mission: ActiveCareerMission, event: CombatEvent): boolean {
  if (mission.kind === 'duel') {
    if (mission.phase !== 'ENGAGING' || !mission.duelOpponentActorId) return false
    if (event.type === 'structure_damaged' || event.type === 'structure_destroyed') return false
    if (event.type === 'damage_applied' && event.target.targetId === 'player') return event.source.actorId === mission.duelOpponentActorId
    return event.source.actorType === 'player' && (event.target.targetId === mission.duelOpponentActorId
      || (event.type === 'damage_applied' && event.target.ownerActorId === mission.duelOpponentActorId))
  }
  if (event.type === 'structure_damaged' || event.type === 'structure_destroyed') {
    if ((mission.kind !== 'enemy-town-assault' && mission.kind !== 'veteran-outpost-assault')
      || event.source.actorType !== 'player') return false
    // World structures carry their owner's faction rather than player-relative allegiance.
    return event.target.characterFaction !== undefined
      ? event.target.characterFaction !== event.source.characterFaction
      : event.target.allegiance === 'ENEMY'
  }
  if (event.type === 'damage_applied' && event.target.targetId === 'player') return true
  if (event.source.actorType !== 'player') return false
  if (mission.targetActorIds.includes(event.target.targetId)) return true
  if (mission.kind === 'enemy-town-assault' && mission.civilianActorIds?.includes(event.target.targetId)) return true
  return event.type === 'damage_applied'
    && Boolean(event.target.ownerActorId && mission.targetActorIds.includes(event.target.ownerActorId))
}

export function resolveCareerMissionOutcome(
  playerDead: boolean,
  rosterRegistrationComplete: boolean,
  remainingTargets: number,
  friendlyCombatantsAlive: number = 0,
  objectiveComplete = true,
): CareerMissionOutcome | null {
  if (rosterRegistrationComplete && objectiveComplete && remainingTargets === 0) return 'victory'
  if (playerDead && friendlyCombatantsAlive === 0 && (remainingTargets > 0 || !objectiveComplete)) return 'failure'
  return null
}
