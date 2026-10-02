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
export const CAREER_DUEL_TIERS = [1, 2, 3, 4] as const

export function isCareerDuelTier(value: unknown): value is UnitTier {
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
  tier: UnitTier,
): boolean {
  if (!isCareerDuelPresetId(presetId) || UNIT_PRESETS[presetId].faction !== profile.faction || !isCareerDuelTier(tier)) return false
  return tier === 1 || (profile.duelHighestDefeatedTierByPreset?.[presetId] ?? 0) >= tier - 1
}

/** Acceptance rechecks progression, even when the UI already displayed an unlocked tier. */
export function createCareerDuelMission(
  profile: CareerProfile,
  presetId: UnitPresetId,
  tier: UnitTier,
  opponentActorId: string,
  captainActorId: string,
  id = createCareerMissionId(CAREER_DUEL_TEMPLATE_ID),
  refereeActorId = captainActorId,
): ActiveCareerMission | null {
  if (profile.activeMission || profile.activeOutpostMission || !isCareerDuelUnlocked(profile, presetId, tier)
    || !opponentActorId.trim() || !captainActorId.trim() || !refereeActorId.trim() || !id.trim()) return null
  const opponent = opponentActorId.trim(), captain = captainActorId.trim(), referee = refereeActorId.trim()
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
