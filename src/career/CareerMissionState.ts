import type { CommanderFourGateDefenseState } from './CommanderFourGateDefenseState'
import type { CampaignSiegeCheckpoint } from '../campaign/CampaignSiegeCheckpoint'
import type { CareerDuelTier, CareerDuelCommanderHome, CareerDuelTravelCheckpoint } from './CareerDuelState'
import type { TownOutskirtsCheckpoint } from '../town/TownOutskirtsWarfareController'
import type { TownPatrolReturnState } from '../town/TownCavalryPatrolController'
import type { OfficialCommandAuthority } from './CareerCommandAuthority'
import type { CareerOutpostCheckpoint } from './CareerOutpostMission'
import type { CaptainEagleCheckpoint } from './CaptainEagleCheckpoint'
import { newTownSiegeState, type TownSiegeState } from './TownSiege'
import type { BattleStatsSnapshot, PlayerBattleStatsCheckpoint, PlayerCommandMeritPolicy } from '../combat/BattleStatsTracker'
import type { CombatEvent } from '../combat/CombatAttribution'
import type { UnitPresetId } from '../battle/UnitPresetCatalog'
import type { CareerMountId, CareerRank } from './CareerProfile'
import { townDefenseEnemyCount, VETERAN_TOWN_DEFENSE_TEMPLATE_ID } from './TownDefenseState'
import { personalMissionSourcePolicy, type PersonalSquadMission } from './CareerPersonalSquadMission'
import { officialMissionSourcePolicy, officialCommandSquads } from './CareerCommandAuthority'
import type { BorrowedCharacterIdentities } from './CareerBorrowedIdentity'

export type CareerMissionPhase = 'DEPLOYING' | 'ASSEMBLING' | 'MARCHING' | 'ENGAGING' | 'RETURNING' | 'PREPARING' | 'SPAWNING' | 'ATTACKING' | 'VICTORY_LOCKED' | 'FAILURE_LOCKED' | 'RESET' | 'RESULT'
export type CareerMissionOutcome = 'victory' | 'failure'
export type CareerMissionKind = 'bandit' | 'patrol' | 'town-defense' | 'enemy-town-assault' | 'cavalry-sweep' | 'duel' | 'veteran-field' | 'veteran-outpost-defense' | 'veteran-outpost-assault' | 'captain-patrol-command' | 'captain-outpost-defense' | 'captain-eagle-battle' | 'commander-sky-raid' | 'commander-decapitation' | 'commander-outpost-last-stand' | 'commander-bridgehead-battle' | 'commander-four-gate-defense'
export const BRIDGEHEAD_PREPARATION_SECONDS = 180
export interface BridgeBattleDeployment {
  phase: 'preparing' | 'spawning' | 'assault'
  preparationRemainingSeconds: number
}
export interface CommanderMissionState {
  version: 1
  kind: Extract<CareerMissionKind, 'commander-sky-raid' | 'commander-decapitation' | 'commander-outpost-last-stand' | 'commander-bridgehead-battle' | 'commander-four-gate-defense'>
  /** No objective can settle before every official and accepted personal actor is registered. */
  deploymentComplete: boolean
  playerPosition?: { x: number; z: number; yaw: number }
}
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
  meritStats?: BattleStatsSnapshot['player']
  defense?: { civilianSurvived: number; civilianDeaths: number }
}

export interface CareerMissionMountState {
  activeMountId?: CareerMountId
  hp: Partial<Record<CareerMountId, number>>
  unavailable: CareerMountId[]
}

export interface ActiveCareerMission {
  fourGateDefense?: CommanderFourGateDefenseState
  outpostSiege?: CampaignSiegeCheckpoint
  commanderMission?: CommanderMissionState
  officialSquad?: OfficialCommandAuthority
  patrolKilledActorIds?: string[]
  patrolOutskirts?: TownOutskirtsCheckpoint
  patrolAmbient?: OfficialCommandAuthority
  patrolReturnStates?: Record<string, TownPatrolReturnState>
  battle?: CareerOutpostCheckpoint
  bridgeBattle?: CaptainEagleCheckpoint
  bridgeDeployment?: BridgeBattleDeployment
  eagleBattle?: CaptainEagleCheckpoint
  personalSquad?: PersonalSquadMission
  siege?: TownSiegeState
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
  duelCommanderHome?: CareerDuelCommanderHome
  duelTravel?: CareerDuelTravelCheckpoint
  duelTier?: CareerDuelTier
  duelPresetId?: UnitPresetId
  duelOpponentActorId?: string
  duelCaptainActorId?: string
  duelRefereeActorId?: string
  duelCountdownElapsed?: number
  duelCombatElapsed?: number
  duelOpponentDead?: boolean
  duelOpponentHp?: number
  duelOpponentMaxHp?: number
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
  /** Native identity receipts survive scene reconstruction independently of loaned equipment. */
  borrowedActorIdentities?: BorrowedCharacterIdentities
  veteranRosterVersion?: 1 | 2 | 3
  actorHealth?: Record<string, { hp: number; mountHp?: number }>
  actorPositions?: Record<string, { x: number; y?: number; z: number; yaw: number; outpostRampartGarrison?: boolean; townRampartGarrison?: boolean }>
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
  templateId = VETERAN_TOWN_DEFENSE_TEMPLATE_ID,
  rank: CareerRank = 'soldier',
): ActiveCareerMission {
  const missionId = id ?? createCareerMissionId(templateId)
  return {
    id: missionId,
    templateId,
    kind: 'town-defense',
    siege: newTownSiegeState(),
    targetCampId: -1,
    phase: 'PREPARING',
    targetActorIds: Array.from({ length: townDefenseEnemyCount(templateId, rank) }, (_, index) => `${missionId}:attacker:${index}`),
    friendlyActorIds: [...friendlyActorIds],
    civilianActorIds: [...civilianActorIds],
    acceptedAt: Date.now(),
  }
}

export function acceptsCareerMissionStat(mission: ActiveCareerMission, event: CombatEvent): boolean {
  if (mission.result || (mission.personalSquad || mission.officialSquad) && (mission.phase === 'RESULT' || mission.phase === 'RETURNING')) return false
  if (mission.kind === 'duel') {
    if (mission.phase !== 'ENGAGING' || !mission.duelOpponentActorId) return false
    if (event.type === 'structure_damaged' || event.type === 'structure_destroyed') return false
    if (event.type === 'damage_applied' && event.target.targetId === 'player') return event.source.actorId === mission.duelOpponentActorId
    return event.source.actorType === 'player' && (event.target.targetId === mission.duelOpponentActorId
      || (event.type === 'damage_applied' && event.target.ownerActorId === mission.duelOpponentActorId))
  }
  if (event.type === 'structure_damaged' || event.type === 'structure_destroyed') {
    if ((mission.kind !== 'enemy-town-assault' && mission.kind !== 'veteran-outpost-assault'
      && mission.kind !== 'commander-sky-raid' && mission.kind !== 'commander-decapitation')
      || !isCareerMissionMeritSource(mission, event.source)) return false
    // Structures identify their owning army. A saved official's visual faction can differ
    // (legacy Rangers can retain their shared visual faction), so use the accepted army's faction for hostility.
    const sourceFaction = isOfficialMissionMeritSource(mission, event.source)
      ? mission.officialSquad!.townFaction : event.source.characterFaction
    return event.target.characterFaction !== undefined
      ? event.target.characterFaction !== sourceFaction
      : event.target.allegiance === 'ENEMY'
  }
  if (event.type === 'damage_applied' && event.target.targetId === 'player') return true
  if (event.type === 'damage_applied' && event.target.targetType === 'npc'
    && (mission.officialSquad?.actorIds.includes(event.target.targetId) || mission.personalSquad?.memberIds.includes(event.target.targetId))
    && (mission.targetActorIds.includes(event.source.actorId)
      || (mission.kind === 'commander-sky-raid' || mission.kind === 'commander-decapitation' || mission.kind === 'commander-outpost-last-stand')
        && (event.source.allegiance === 'ENEMY' || event.source.allegiance === 'BANDIT')
      || mission.kind === 'captain-patrol-command'
      && (event.source.allegiance === 'ENEMY' || event.source.allegiance === 'BANDIT'))) return true
  if (!isCareerMissionMeritSource(mission, event.source)) return false
  if (mission.kind === 'captain-patrol-command') {
    return (event.target.targetType === 'npc' || event.type === 'damage_applied' && event.target.targetType === 'mount')
      && (event.target.allegiance === 'BANDIT' || event.target.allegiance === 'ENEMY')
  }
  if (mission.kind === 'commander-sky-raid' || mission.kind === 'commander-decapitation'
    || mission.kind === 'commander-outpost-last-stand') {
    return (event.target.targetType === 'npc' || event.type === 'damage_applied' && event.target.targetType === 'mount')
      && event.target.allegiance === 'ENEMY'
  }
  if (mission.targetActorIds.includes(event.target.targetId)) return true
  if (mission.kind === 'enemy-town-assault' && mission.civilianActorIds?.includes(event.target.targetId)) return true
  return event.type === 'damage_applied'
    && Boolean(event.target.ownerActorId && mission.targetActorIds.includes(event.target.ownerActorId))
}

const personalSourcePolicies = new WeakMap<PersonalSquadMission, ReturnType<typeof personalMissionSourcePolicy>>()
const officialSourcePolicies = new WeakMap<OfficialCommandAuthority, ReturnType<typeof officialMissionSourcePolicy>>()
function isCareerMissionMeritSource(mission: ActiveCareerMission, source: CombatEvent['source']): boolean {
  if (source.actorType === 'player') return true
  if (mission.personalSquad) {
    let policy = personalSourcePolicies.get(mission.personalSquad)
    if (!policy) { policy = personalMissionSourcePolicy(mission); personalSourcePolicies.set(mission.personalSquad, policy) }
    if (policy(source)) return true
  }
  return isOfficialMissionMeritSource(mission, source)
}

function isOfficialMissionMeritSource(mission: ActiveCareerMission, source: CombatEvent['source']): boolean {
  if (!mission.officialSquad || mission.officialSquad.type !== 'mission-official'
    || mission.officialSquad.missionId !== mission.id) return false
  let policy = officialSourcePolicies.get(mission.officialSquad)
  if (!policy) { policy = officialMissionSourcePolicy(mission.officialSquad); officialSourcePolicies.set(mission.officialSquad, policy) }
  return policy(source)
}

export function careerMissionCommandMeritPolicy(mission: ActiveCareerMission,
  read: () => ActiveCareerMission = () => mission): PlayerCommandMeritPolicy | undefined {
  if ((!mission.personalSquad && !mission.officialSquad) || mission.kind === 'duel') return undefined
  return { acceptsSource: personalMissionSourcePolicy(mission), initialContribution: mission.personalSquad?.contribution,
    initialMemberIds: mission.personalSquad?.memberIds.filter(id => mission.personalSquad!.members[id]?.status !== 'reserve'),
    departedSurvivors: () => read().personalSquad?.memberIds.filter(id => read().personalSquad!.members[id]?.status === 'exited') ?? [],
    ...(mission.officialSquad?.type === 'mission-official' && mission.officialSquad.missionId === mission.id ? { official: {
      acceptsSource: officialMissionSourcePolicy(mission.officialSquad), initialContribution: mission.officialSquad.contribution,
      initialMemberIds: mission.officialSquad.actorIds,
      ...(mission.officialSquad.commandRank === 'commander' ? { initialSquads: officialCommandSquads(mission.officialSquad).map(squad => ({
        squadId: squad.squadId, memberIds: squad.actorIds, contribution: squad.contribution,
      })) } : {}),
      departedSurvivors: () => read().officialSquad?.actorIds.filter(id => read().officialSquad!.members?.[id]?.status === 'exited') ?? [],
    } } : {}),
    acceptsEvent: event => acceptsCareerMissionStat(read(), event) }
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
