import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { acceptVeteranMission, VETERAN_MISSION_IDS, type VeteranMissionTemplateId } from '../../src/career/VeteranMission'
import type { CharacterFaction } from '../../src/world/CharacterVisuals'

/** Inputs remain explicit; acceptance and roster rules come from the mission domain. */
export function createVeteranMissionProfile(
  templateId: VeteranMissionTemplateId,
  options: { faction?: CharacterFaction; missionId?: string; overrides?: Partial<CareerProfile> } = {},
): CareerProfile {
  const index = VETERAN_MISSION_IDS.indexOf(templateId)
  const profile: CareerProfile = {
    ...createCareerProfile(options.faction ?? 'roman'),
    rank: 'veteran', totalMerit: 900, availableMerit: 900, ownedMounts: ['horse'],
    completedCareerMissionTemplateIds: [...VETERAN_MISSION_IDS.slice(0, index)],
    ...options.overrides,
  }
  const accepted = acceptVeteranMission(profile, templateId, {
    missionId: options.missionId ?? `controller-${templateId}`, acceptedAt: 0,
  })
  if (!accepted) throw new Error(`Cannot accept fixture mission: ${templateId}`)
  return accepted
}
