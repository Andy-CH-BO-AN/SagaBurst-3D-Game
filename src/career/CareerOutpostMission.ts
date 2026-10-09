import { parseCommandActorCheckpoint } from './CareerCommandAuthority'
import type { PersonalActorCheckpoint, PersonalActorPosition } from './CareerPersonalSquadMission'
import type { BattleStatsSnapshot, PlayerBattleStats } from '../combat/BattleStatsTracker'
import { claimCareerBattle, cloneCareerProfile, canonicalCareerMountId, recordCareerMissionCompletion, type CareerProfile } from './CareerProfile'
import { canUseCareerMount, ownedCareerMountIds } from './CareerMountController'
import type { CareerMountId } from './CareerProfile'
import type { MeritBreakdown } from './MeritCalculator'
import { snapshotPersonalMission, type PersonalSquadMission } from './CareerPersonalSquadMission'
import type { PlayerBattleStatsCheckpoint } from '../combat/BattleStatsTracker'
import type { DefenseCampaignRuntimeSnapshot } from '../campaign/DefenseCampaignRuntime'

export const CAREER_OUTPOST_SESSION_KEY = 'sagaburst_career_outpost_mission'
export const CAREER_OUTPOST_STAGES = [1, 2, 3] as const
export type CareerOutpostStageId = typeof CAREER_OUTPOST_STAGES[number]
export interface CareerOutpostMission {
  id: string
  kind: 'outpost-defense' | 'outpost-relief'
  stageId: CareerOutpostStageId
  acceptedAt: number
  reliefPhase?: 'march' | 'charge'
  personalSquad?: PersonalSquadMission
  battle?: CareerOutpostCheckpoint
}
export interface CareerOutpostCheckpoint {
  runtime: DefenseCampaignRuntimeSnapshot
  actors: Record<string, { hp: number; x: number; z: number; yaw: number; mountHp?: number; checkpoint?: PersonalActorCheckpoint }>
  player: { hp: number; stamina: number; dead: boolean; x: number; z: number; yaw: number; mountHp?: number; ammo?: number; shieldImpact?: number; mounted?: boolean; mountPosition?: PersonalActorPosition }
  playerStats: PlayerBattleStatsCheckpoint
  wave: 'attackers' | 'reinforcement' | null
  waveIndex: number
  attackersStarted: boolean
  reinforcementsSpawned: boolean
  gate?: { hp: number; state: 'closed' | 'open' | 'destroyed' }
}
export interface CareerOutpostRecord extends CareerOutpostMission {
  outcome: 'victory' | 'defeat'
  completed: boolean
  stats: PlayerBattleStats
  merit: MeritBreakdown
  meritStats?: PlayerBattleStats
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
  profile.activeOutpostMission.personalSquad = snapshotPersonalMission(profile)
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
    id: mission.id, kind: mission.kind, stageId: mission.stageId, acceptedAt: mission.acceptedAt,
    ...(mission.reliefPhase ? { reliefPhase: mission.reliefPhase } : {}),
    outcome, completed: outcome === 'victory', stats: { ...stats.player }, merit: { ...claim.meritBreakdown },
    ...(stats.meritPlayer ? { meritStats: { ...stats.meritPlayer } } : {}),
  }]
  if (outcome === 'victory' && mission.kind === 'outpost-defense') {
    profile.completedOutpostStages = [...new Set([...(profile.completedOutpostStages ?? []), mission.stageId])]
  }
  if (outcome === 'victory' && mission.kind === 'outpost-relief') {
    profile.completedOutpostRelief = true
  }
  return claim
}

export function parseCareerOutpostCheckpoint(value: unknown): CareerOutpostCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as CareerOutpostCheckpoint
  const number = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  const point = (p: { x: number; z: number; yaw: number } | undefined) => p && typeof p === 'object' && number(p.x) && number(p.z) && number(p.yaw)
  if (!raw.runtime || !['deployment', 'assault', 'victory', 'defeat'].includes(raw.runtime.phase)
    || !['deployment', 'assault'].includes(raw.runtime.activePhase) || !point(raw.player)
    || !number(raw.player.hp) || raw.player.hp < 0 || !number(raw.player.stamina) || raw.player.stamina < 0
    || typeof raw.player.dead !== 'boolean' || typeof raw.runtime.reinforcementTriggered !== 'boolean'
    || typeof raw.runtime.battleFinished !== 'boolean' || typeof raw.attackersStarted !== 'boolean'
    || typeof raw.reinforcementsSpawned !== 'boolean' || !raw.actors || typeof raw.actors !== 'object' || Array.isArray(raw.actors)
    || Object.keys(raw.actors).length > 1024 || !raw.playerStats || typeof raw.playerStats !== 'object') return undefined
  for (const key of ['mountHp', 'ammo', 'shieldImpact'] as const) {
    if (raw.player[key] !== undefined && (!number(raw.player[key]) || raw.player[key]! < 0)) return undefined
  }
  if (raw.player.mounted !== undefined && typeof raw.player.mounted !== 'boolean') return undefined
  if (raw.player.mountPosition !== undefined && (!point(raw.player.mountPosition)
    || raw.player.mountPosition.y !== undefined && !number(raw.player.mountPosition.y))) return undefined
  for (const key of ['deploymentRemainingSeconds', 'assaultElapsedSeconds', 'reinforcementRemainingSeconds'] as const) {
    if (!number(raw.runtime[key]) || raw.runtime[key] < 0) return undefined
  }
  for (const [id, actor] of Object.entries(raw.actors)) {
    if (!id || id.length > 256 || !point(actor) || !number(actor.hp) || actor.hp < 0
      || actor.mountHp !== undefined && (!number(actor.mountHp) || actor.mountHp < 0)
      || actor.checkpoint !== undefined && !parseCommandActorCheckpoint(actor.checkpoint)) return undefined
  }
  for (const key of ['damageDealt', 'damageTaken', 'kills', 'structureDamage', 'structuresDestroyed', 'gateBreaches'] as const) {
    if (!number(raw.playerStats[key]) || raw.playerStats[key] < 0) return undefined
  }
  if (raw.wave !== null && raw.wave !== 'attackers' && raw.wave !== 'reinforcement') return undefined
  if (!Number.isSafeInteger(raw.waveIndex) || raw.waveIndex < 0 || raw.waveIndex > 1024) return undefined
  if (raw.gate && (!number(raw.gate.hp) || raw.gate.hp < 0 || !['closed', 'open', 'destroyed'].includes(raw.gate.state))) return undefined
  return {
    runtime: {
      phase: raw.runtime.phase, activePhase: raw.runtime.activePhase,
      deploymentRemainingSeconds: raw.runtime.deploymentRemainingSeconds,
      assaultElapsedSeconds: raw.runtime.assaultElapsedSeconds,
      reinforcementRemainingSeconds: raw.runtime.reinforcementRemainingSeconds,
      reinforcementTriggered: raw.runtime.reinforcementTriggered, battleFinished: raw.runtime.battleFinished,
    },
    actors: Object.fromEntries(Object.entries(raw.actors).map(([id, actor]) => [id, {
      hp: actor.hp, x: actor.x, z: actor.z, yaw: actor.yaw,
      ...(actor.mountHp !== undefined ? { mountHp: actor.mountHp } : {}),
      ...(actor.checkpoint ? { checkpoint: parseCommandActorCheckpoint(actor.checkpoint)! } : {}),
    }])),
    player: { hp: raw.player.hp, stamina: raw.player.stamina, dead: raw.player.dead,
      x: raw.player.x, z: raw.player.z, yaw: raw.player.yaw,
      ...(raw.player.mountHp !== undefined ? { mountHp: raw.player.mountHp } : {}),
      ...(raw.player.ammo !== undefined ? { ammo: Math.floor(raw.player.ammo) } : {}),
      ...(raw.player.shieldImpact !== undefined ? { shieldImpact: raw.player.shieldImpact } : {}),
      ...(raw.player.mounted !== undefined ? { mounted: raw.player.mounted } : {}),
      ...(raw.player.mountPosition ? { mountPosition: {
        x: raw.player.mountPosition.x, z: raw.player.mountPosition.z, yaw: raw.player.mountPosition.yaw,
        ...(raw.player.mountPosition.y !== undefined ? { y: raw.player.mountPosition.y } : {}),
      } } : {}),
    },
    playerStats: {
      damageDealt: raw.playerStats.damageDealt, damageTaken: raw.playerStats.damageTaken,
      kills: Math.floor(raw.playerStats.kills), structureDamage: raw.playerStats.structureDamage,
      structuresDestroyed: Math.floor(raw.playerStats.structuresDestroyed), gateBreaches: Math.floor(raw.playerStats.gateBreaches),
    },
    wave: raw.wave, waveIndex: raw.waveIndex,
    attackersStarted: raw.attackersStarted, reinforcementsSpawned: raw.reinforcementsSpawned,
    ...(raw.gate ? { gate: { hp: raw.gate.hp, state: raw.gate.state } } : {}),
  }
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
  profile.activeOutpostMission.personalSquad = snapshotPersonalMission(profile)
  return profile
}
