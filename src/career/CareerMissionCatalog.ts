import { CAPTAIN_MISSION_CATALOG,availableCaptainMissions,getCaptainMissionDefinition,type CaptainMissionDefinition } from './CaptainMissionCatalog'
import { careerMissionTierForTemplateId } from './CareerMissionTier'
import { resolveCareerReliefMount } from './CareerOutpostMission'
import { CAREER_RANKS,enlistmentMerit,type CareerMissionTier,type CareerProfile,type CareerRank } from './CareerProfile'
import { COMMANDER_MISSION_CATALOG,availableCommanderMissions,getCommanderMissionDefinition,type CommanderMissionDefinition } from './CommanderMissionCatalog'
import { HEAVY_FIELD_MISSION_CATALOG,getHeavyFieldMissionAvailability,getHeavyFieldMissionDefinition,type HeavyFieldMissionDefinition } from './HeavyFieldMission'
import { VETERAN_MISSION_CATALOG,getVeteranMissionAvailability,getVeteranMissionDefinition,type VeteranMissionDefinition } from './VeteranMission'

export type RecruitMissionRisk = '低' | '中' | '高' | '極高'

interface RecruitMissionCommon {
  id: string
  name: string
  briefing: string
  /** Total combatants on the Town side, including Player and Mission Leader. */
  friendlyCombatants: number
  risk: RecruitMissionRisk
  requiresEnlistmentMerit: number
  requiresCompletions: number
  storyOnce: boolean
  minRank: CareerRank
}

export interface RecruitBanditMissionTemplate extends RecruitMissionCommon {
  kind: 'bandit'
  /** Followers only; Player + Mission Leader are deliberately excluded. */
  friendlySoldiers: number
  banditCount: number
  preferredCampIndex: number
}

export interface CavalrySweepTemplate extends RecruitMissionCommon { kind: 'cavalry-sweep' }

export type RecruitMissionTemplate =
  | CavalrySweepTemplate

  | RecruitBanditMissionTemplate



export type CareerMissionTemplate = RecruitMissionTemplate | VeteranMissionDefinition | CaptainMissionDefinition | CommanderMissionDefinition | HeavyFieldMissionDefinition

const mission = (
  id: string,
  name: string,
  friendlyCombatants: number,
  banditCount: number,
  risk: RecruitMissionRisk,
  preferredCampIndex: number,
  requiresEnlistmentMerit = 0,
  requiresCompletions = 0,
): RecruitBanditMissionTemplate => ({
  id,
  kind: 'bandit',
  name,
  briefing: friendlyCombatants > banditCount
    ? '目標：跟隨隊長進攻盜匪營地，消滅全部敵人。'
    : '目標：敵眾我寡，跟緊隊長進攻盜匪營地，消滅全部敵人。',
  friendlyCombatants,
  friendlySoldiers: Math.max(0, friendlyCombatants - 2),
  banditCount,
  risk,
  preferredCampIndex,
  requiresEnlistmentMerit,
  requiresCompletions,
  storyOnce: false,
  minRank: 'recruit',
})

/**
 * The board stays intentionally compact and repeatable. Roughly ten ordinary,
 * credited contributions should earn enough merit for Soldier eligibility;
 * the number of templates is not a promotion requirement.
 */
export const RECRUIT_MISSION_CATALOG: readonly RecruitMissionTemplate[] = [
  { id: 'career-cavalry-sweep', kind: 'cavalry-sweep', name: 'Cavalry Sweep · 騎兵清剿', briefing: '目標：在軍營集合後跟隨騎兵出城，消滅全部盜匪。', friendlyCombatants: 60, risk: '低', requiresEnlistmentMerit: 0, requiresCompletions: 0, storyOnce: false, minRank: 'recruit' },
  mission('recruit-bandits-01', '營火邊的三名盜匪', 5, 3, '低', 0),
  mission('recruit-bandits-02', '大隊剿匪', 20, 12, '中', 2, 0, 0),
  mission('recruit-bandits-03', '寡不敵眾', 6, 10, '高', 3, 0),
  mission('recruit-bandits-04', '深入敵營', 10, 20, '極高', 4, 0),
]

export function getRecruitMissionTemplate(id: string): RecruitMissionTemplate | null {
  return RECRUIT_MISSION_CATALOG.find(template => template.id === id) ?? null
}

/** Generic lookup used by the active-mission save parser; the legacy Recruit lookup stays narrow. */
export function getCareerMissionTemplate(id: string): CareerMissionTemplate | null {
  return getRecruitMissionTemplate(id)
    ?? getVeteranMissionDefinition(id)
    ?? getCaptainMissionDefinition(id)
    ?? getCommanderMissionDefinition(id)
    ?? getHeavyFieldMissionDefinition(id)
}

export function availableRecruitMissions(profile: CareerProfile): RecruitMissionTemplate[] {
  if (profile.activeRace || profile.activeMission) return []
  const merit = enlistmentMerit(profile)
  const completions = profile.careerMissionCompletions ?? 0
  const completedStory = profile.completedCareerMissionTemplateIds ?? []
  return RECRUIT_MISSION_CATALOG.filter(template => (
    CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf(template.minRank)
    && merit >= template.requiresEnlistmentMerit
    && completions >= template.requiresCompletions
    && (template.kind !== 'cavalry-sweep' || Boolean(resolveCareerReliefMount(profile)))
    && (!template.storyOnce || !completedStory.includes(template.id))
  ))
}

export type CareerMissionPage = 'recruit' | 'soldier' | 'veteran' | 'captain' | 'commander'

export function defaultCareerMissionPage(profile: Pick<CareerProfile, 'rank'>): CareerMissionPage {
  return CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf('commander') ? 'commander'
    : CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf('captain') ? 'captain'
    : CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf('veteran') ? 'veteran'
    : CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf('soldier') ? 'soldier' : 'recruit'
}

export function isCareerMissionPageUnlocked(profile: Pick<CareerProfile, 'rank'>, page: CareerMissionPage): boolean {
  const requiredRank: CareerRank = page === 'commander' ? 'commander' : page === 'captain' ? 'captain' : page === 'veteran' ? 'veteran' : page === 'soldier' ? 'soldier' : 'recruit'
  return CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf(requiredRank)
}

export function careerMissionPage(template: CareerMissionTemplate): CareerMissionPage {
  const tier = careerMissionTier(template)
  return tier === 5 ? 'commander' : tier === 4 ? 'captain' : tier === 3 ? 'veteran' : tier === 2 ? 'soldier' : 'recruit'
}

export function careerMissionTier(template: CareerMissionTemplate): CareerMissionTier {
  return careerMissionTierForTemplateId(template.id)
}

export function careerMissionTemplatesForPage(profile: CareerProfile, page: CareerMissionPage): CareerMissionTemplate[] {
  if (page === 'commander') return [...COMMANDER_MISSION_CATALOG]
  if (page === 'captain') return isCareerMissionPageUnlocked(profile, page) ? [...CAPTAIN_MISSION_CATALOG, ...heavyTemplatesForTier(4)] : []
  if (page === 'veteran') {
    return isCareerMissionPageUnlocked(profile, page) ? [...VETERAN_MISSION_CATALOG, ...heavyTemplatesForTier(3)] : []
  }
  const ordinary = availableRecruitMissions(profile).filter(template => careerMissionPage(template) === page)
  return page === 'soldier' && isCareerMissionPageUnlocked(profile, page) ? [...ordinary, ...heavyTemplatesForTier(2)] : ordinary
}

function heavyTemplatesForTier(tier: CareerMissionTier): HeavyFieldMissionDefinition[] {
  return HEAVY_FIELD_MISSION_CATALOG.filter(template => careerMissionTier(template) === tier)
}

export function availableCareerMissionsForPage(profile: CareerProfile, page: CareerMissionPage): CareerMissionTemplate[] {
  if (page === 'commander') return availableCommanderMissions(profile)
  if (page === 'captain') return [...availableCaptainMissions(profile), ...heavyTemplatesForTier(4).filter(template => getHeavyFieldMissionAvailability(profile, template.id).unlocked)]
  const heavyUnlocked = (template: CareerMissionTemplate) => template.kind === 'heavy-cavalry-field' && getHeavyFieldMissionAvailability(profile, template.id).unlocked
  if (page === 'veteran') return careerMissionTemplatesForPage(profile, page).filter(template => template.kind === 'heavy-cavalry-field' ? heavyUnlocked(template) : getVeteranMissionAvailability(profile, template.id).unlocked)
  return careerMissionTemplatesForPage(profile, page).filter(template => template.kind !== 'heavy-cavalry-field' || heavyUnlocked(template))
}
