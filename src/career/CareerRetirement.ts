import { careerMissionCompletionsForTier, type CareerProfile } from './CareerProfile'
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
