import {
  getUnitPresetsForFaction, UNIT_PRESETS,
  type UnitPreset, type UnitPresetId, type UnitTier,
} from '../battle/UnitPresetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { CareerProfile } from './CareerProfile'
import { createCareerMissionId, type ActiveCareerMission, type CareerMissionOutcome } from './CareerMissionState'

export const CAREER_DUEL_TEMPLATE_ID = 'career-duel'
export const DUEL_COUNTDOWN_SECONDS = 5
export const DUEL_COMBAT_SECONDS = 30
export const CAREER_DUEL_TIERS = [1, 2, 3, 4, 5] as const
export type CareerDuelTier = UnitTier | 5

/** Resources lent to a Duel are restored after its saved settlement, including a scene reload. */
export interface CareerDuelCommanderHome { hp: number; ammo: number }
export interface CareerDuelPosition { x: number; y: number; z: number; yaw: number }
export interface CareerDuelTravelCheckpoint {
  actors: Record<string, CareerDuelPosition>
  player: CareerDuelPosition
  staging: boolean
}

export function parseCareerDuelCommanderHome(value: unknown): CareerDuelCommanderHome | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.hp !== 'number' || !Number.isFinite(raw.hp) || raw.hp <= 0
    || typeof raw.ammo !== 'number' || !Number.isFinite(raw.ammo) || raw.ammo < 0) return undefined
  return { hp: raw.hp, ammo: Math.floor(raw.ammo) }
}

export function parseCareerDuelTravelCheckpoint(value: unknown, actorIds: readonly string[]): CareerDuelTravelCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const position = (value: unknown): CareerDuelPosition | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const p = value as Record<string, unknown>
    if (![p.x, p.y, p.z, p.yaw].every(n => typeof n === 'number' && Number.isFinite(n))) return undefined
    return { x: p.x as number, y: p.y as number, z: p.z as number, yaw: p.yaw as number }
  }
  const player = position(raw.player)
  if (!player || !raw.actors || typeof raw.actors !== 'object') return undefined
  const actors: Record<string, CareerDuelPosition> = {}
  for (const id of actorIds) {
    const p = position((raw.actors as Record<string, unknown>)[id])
    if (!p) return undefined
    actors[id] = p
  }
  return { actors, player, staging: raw.staging === true }
}

export function isCareerDuelTier(value: unknown): value is CareerDuelTier {
  return typeof value === 'number' && (CAREER_DUEL_TIERS as readonly number[]).includes(value)
}

export function isCareerDuelPresetId(value: unknown): value is UnitPresetId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(UNIT_PRESETS, value)
}

/** Keep selection tied to the authoritative faction catalog. */
export function careerDuelPresets(faction: CharacterFaction): UnitPreset[] {
  return getUnitPresetsForFaction(faction)
}

export function isCareerDuelUnlocked(
  profile: Pick<CareerProfile, 'faction' | 'duelHighestDefeatedTierByPreset'>,
  presetId: UnitPresetId,
  tier: CareerDuelTier,
): boolean {
  if (!isCareerDuelPresetId(presetId) || UNIT_PRESETS[presetId].faction !== profile.faction || !isCareerDuelTier(tier)) return false
  return tier === 1 || (profile.duelHighestDefeatedTierByPreset?.[presetId] ?? 0) >= tier - 1
}

/** Acceptance rechecks progression, even when the UI already displayed an unlocked tier. */
export function createCareerDuelMission(
  profile: CareerProfile,
  presetId: UnitPresetId,
  tier: CareerDuelTier,
  opponentActorId: string,
  captainActorId: string,
  id = createCareerMissionId(CAREER_DUEL_TEMPLATE_ID),
  refereeActorId = captainActorId,
): ActiveCareerMission | null {
  if (profile.activeMission || profile.activeOutpostMission || tier === 5 && profile.townEvent?.state === 'hostile' || !isCareerDuelUnlocked(profile, presetId, tier)
    || !opponentActorId.trim() || !captainActorId.trim() || !refereeActorId.trim() || !id.trim()) return null
  const opponent = opponentActorId.trim(), captain = captainActorId.trim(), referee = refereeActorId.trim()
  if (tier === 5 && (opponent !== 'commander' || captain !== 'captain' || referee !== captain)) return null
  return {
    id: id.trim(), templateId: CAREER_DUEL_TEMPLATE_ID, kind: 'duel', targetCampId: -1,
    phase: 'ASSEMBLING', targetActorIds: [opponent], friendlyActorIds: opponent === referee ? [] : [referee],
    duelTier: tier, duelPresetId: presetId, duelOpponentActorId: opponent, duelCaptainActorId: captain,
    duelRefereeActorId: referee,
    duelCountdownElapsed: 0, duelCombatElapsed: 0, duelOpponentDead: false,
    acceptedAt: Date.now(),
  }
}

/** Duel has no allied victory after player death; a simultaneous death is a failure. */
export function resolveCareerDuelOutcome(
  playerDead: boolean,
  opponentDead: boolean,
  combatElapsed: number,
): CareerMissionOutcome | null {
  if (playerDead) return 'failure'
  if (opponentDead) return 'victory'
  return combatElapsed >= DUEL_COMBAT_SECONDS ? 'failure' : null
}
