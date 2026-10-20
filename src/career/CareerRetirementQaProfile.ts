import { createCareerProfile, promoteCareer, recordCareerMissionCompletion, type CareerProfile } from './CareerProfile'
import { addCareerItem } from './CareerInventory'
import { createDefaultSkillState, MAX_SKILL_LEVEL } from '../rpg/SkillManager'
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
  profile.skills = createDefaultSkillState()
  for (const skill of Object.values(profile.skills)) skill.level = MAX_SKILL_LEVEL
  // Grant real inventory copies before allocating them, so reload cannot strip the loadout.
  for (const [id, quantity] of Object.entries({
    axe_t5: 15, spear_t5: 15, bow_t5: 15, paladin_shield_t4: 30, 'black-cat': 30,
  })) addCareerItem(profile, id, quantity)
  profile.personalSquad = { members: Array.from({ length: 30 }, (_, index) => ({
    id: `personal:retirement-qa-${index + 1}`,
    type: 'commander',
    originalHirePrice: 2000,
    equipment: {
      melee: index < 15 ? 'axe_t5' : 'spear_t5',
      ranged: index < 15 ? 'bow_t5' : null,
      shield: 'paladin_shield_t4',
      mount: 'black-cat',
    },
  })) }
  return profile
}
