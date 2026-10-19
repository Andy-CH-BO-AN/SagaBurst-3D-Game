import { createCareerProfile, promoteCareer, recordCareerMissionCompletion, type CareerProfile } from './CareerProfile'
import { COMMANDER_MISSION_CATALOG } from './CommanderMissionCatalog'
import { grantStarter } from '../town/TownRules'
import type { CharacterFaction } from '../world/CharacterVisuals'

/** Data-only builder. Only the explicitly gated development entry may persist this preset. */
export function createCommanderRetirementQaProfile(faction: CharacterFaction = 'roman'): CareerProfile {
  let profile = grantStarter(createCareerProfile(faction), faction === 'roman' ? 'gladius_rusty' : 'viking_axe_t1')
  profile.totalMerit = 100_000
  profile.availableMerit = 100_000
  while (profile.rank !== 'commander') profile = promoteCareer(profile)!
  profile.completedCareerMissionTemplateIds = COMMANDER_MISSION_CATALOG.map(mission => mission.id)
  for (let victory = 0; victory < 10; victory++) recordCareerMissionCompletion(profile, 5)
  profile.personalSquad = { members: [] }
  return profile
}
