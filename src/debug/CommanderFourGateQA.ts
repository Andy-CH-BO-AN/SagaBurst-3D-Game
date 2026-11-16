import { CareerProfileStore } from '../career/CareerProfileStore'
import { createCareerProfile, promoteCareer, type CareerProfile } from '../career/CareerProfile'
import { CAREER_TUTORIAL_OPERATIONS, CAREER_TUTORIAL_STAGES } from '../career/CareerTutorialState'
import { acceptCommanderMission } from '../career/CommanderMissionCatalog'
import { COMMANDER_FOUR_GATE_DEFENSE_ID } from '../career/CommanderFourGateDefenseRoster'
import { createDefaultSkillState, MAX_SKILL_LEVEL } from '../rpg/SkillManager'
import { TOWN_ENTRY_KEY } from '../town/CareerTownEntry'
import { grantStarter } from '../town/TownRules'
import type { CharacterFaction } from '../world/CharacterVisuals'

/** Fresh T5 Commander with every tutorial stage done and Commander V (Four-Gate Defense) just accepted. */
export function createCommanderFourGateQaProfile(faction: CharacterFaction): CareerProfile {
  let profile = grantStarter(createCareerProfile(faction), faction === 'roman' ? 'gladius_rusty' : 'viking_axe_t1')
  profile.totalMerit = 100_000
  profile.availableMerit = 100_000
  while (profile.rank !== 'commander') profile = promoteCareer(profile)!
  profile.skills = createDefaultSkillState()
  for (const skill of Object.values(profile.skills)) skill.level = MAX_SKILL_LEVEL
  const tutorial = profile.tutorial!
  for (const stage of CAREER_TUTORIAL_STAGES) {
    tutorial[stage] = { status: 'completed', step: 'complete', operations: CAREER_TUTORIAL_OPERATIONS[stage].flat(), replay: false }
  }
  const accepted = acceptCommanderMission(profile, COMMANDER_FOUR_GATE_DEFENSE_ID)
  if (!accepted) throw new Error('Commander V QA profile could not accept the Four-Gate Defense')
  return accepted
}

/**
 * DEV `?careerQa=commander-v[&faction=viking]`: replaces the single Career save (asking first when one
 * exists) with the QA profile, then lets bootstrap resume into the Four-Gate Town mission. Returns
 * false when the replacement was declined or could not be saved.
 */
export function installCommanderFourGateQa(query: URLSearchParams): boolean {
  if (!import.meta.env.DEV) return false
  const store = new CareerProfileStore()
  if (store.loadChecked().profile
    && !window.confirm('Commander V QA 將取代目前的 Career 存檔。確定要繼續嗎？')) return false
  const profile = createCommanderFourGateQaProfile(query.get('faction') === 'viking' ? 'viking' : 'roman')
  if (!store.save(profile)) return false
  sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
  // A reload resumes the saved mission instead of replacing it again.
  query.delete('careerQa'); query.delete('faction')
  history.replaceState(null, '', `${location.pathname}${query.size ? `?${query}` : ''}`)
  return true
}
