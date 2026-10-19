import { careerMissionCompletionsForTier, cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { COMMANDER_FOUR_GATE_DEFENSE_ID } from './CommanderFourGateDefenseRoster'

export const COMMANDER_RETIREMENT_REQUIRED_VICTORIES = 10

export interface CommanderRetirementEligibility {
  eligible: boolean
  commanderVictories: number
  requiredVictories: number
  fourGateDefenseCompleted: boolean
}

/** Historical qualification, independent of any accepted retirement or future action gate. */
export function commanderRetirementEligibility(profile: CareerProfile): CommanderRetirementEligibility {
  const commanderVictories = careerMissionCompletionsForTier(profile, 5)
  const fourGateDefenseCompleted = profile.completedCareerMissionTemplateIds?.includes(COMMANDER_FOUR_GATE_DEFENSE_ID) === true
  return {
    eligible: profile.rank === 'commander'
      && commanderVictories >= COMMANDER_RETIREMENT_REQUIRED_VICTORIES && fourGateDefenseCompleted,
    commanderVictories,
    requiredVictories: COMMANDER_RETIREMENT_REQUIRED_VICTORIES,
    fourGateDefenseCompleted,
  }
}

export type CommanderRetirementStartFailure =
  | 'not-eligible'
  | 'already-started'
  | 'mission-active'
  | 'race-active'
  | 'town-hostile'
  | 'invalid-time'

export interface CommanderRetirementStartResult {
  started: boolean
  profile: CareerProfile
  reason?: CommanderRetirementStartFailure
}

/** Stage only. The caller must durably commit this profile before applying departure effects. */
export function startCommanderRetirement(current: CareerProfile, acceptedAt: number): CommanderRetirementStartResult {
  const fail = (reason: CommanderRetirementStartFailure): CommanderRetirementStartResult => ({
    started: false, profile: current, reason,
  })
  if (current.careerRetirement !== undefined) return fail('already-started')
  if (!commanderRetirementEligibility(current).eligible) return fail('not-eligible')
  if (current.activeMission !== undefined || current.activeOutpostMission !== undefined) return fail('mission-active')
  if (current.activeRace !== undefined) return fail('race-active')
  if (current.townEvent?.state === 'hostile') return fail('town-hostile')
  if (!Number.isFinite(acceptedAt) || !Number.isInteger(acceptedAt) || acceptedAt < 0) return fail('invalid-time')
  const next = cloneCareerProfile(current)
  next.careerRetirement = { version: 1, phase: 'departing', acceptedAt, combatElapsedSeconds: 0 }
  return { started: true, profile: next }
}

export type RetirementCommitPermission =
  | { allowed: true }
  | { allowed: false; reason: 'retirement-checkpoint-missing' | 'retirement-checkpoint-changed' | 'retirement-new-work' }

/** Compare the persisted plain-data checkpoint, including any nested mobilization receipt.
 * Property order and omitted undefined fields do not change its persisted meaning.
 */
function equalRetirementCheckpoint(current: unknown, next: unknown): boolean {
  if (current === next) return true
  if (!current || !next || typeof current !== 'object' || typeof next !== 'object') return false
  if (Array.isArray(current) || Array.isArray(next)) return Array.isArray(current) && Array.isArray(next)
    && current.length === next.length && current.every((value, index) => equalRetirementCheckpoint(value, next[index]))
  const saved = current as Record<string, unknown>, proposed = next as Record<string, unknown>
  const keys = Object.keys(saved).filter(key => saved[key] !== undefined)
  return keys.length === Object.keys(proposed).filter(key => proposed[key] !== undefined).length
    && keys.every(key => equalRetirementCheckpoint(saved[key], proposed[key]))
}

/** Validate before saving or applying runtime effects. Ordinary Town transactions cannot
 * rewrite an irreversible checkpoint or start new work after retirement has begun.
 * Phase advancement belongs to a separately validated retirement-owner transition.
 */
export function validateOrdinaryRetirementCommit(current: CareerProfile, next: CareerProfile): RetirementCommitPermission {
  const saved = current.careerRetirement, proposed = next.careerRetirement
  if (saved === undefined) return { allowed: true }
  if (proposed === undefined) return { allowed: false, reason: 'retirement-checkpoint-missing' }
  if (!equalRetirementCheckpoint(saved, proposed)) return { allowed: false, reason: 'retirement-checkpoint-changed' }
  if (next.activeMission && next.activeMission.id !== current.activeMission?.id
    || next.activeOutpostMission && next.activeOutpostMission.id !== current.activeOutpostMission?.id
    || next.activeRace && next.activeRace.id !== current.activeRace?.id) {
    return { allowed: false, reason: 'retirement-new-work' }
  }
  return { allowed: true }
}
