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
