import { resolveCareerReliefMount } from './CareerOutpostMission'
import { CAREER_RANKS, careerMissionCompletionsForTier, enlistmentMerit, type CareerMissionTier, type CareerProfile, type CareerRank } from './CareerProfile'
import { careerMissionTierForTemplateId } from './CareerMissionTier'
import { townDefenseEnemyCount, VETERAN_TOWN_DEFENSE_TEMPLATE_ID } from './TownDefenseState'
import { getVeteranMissionAvailability, getVeteranMissionDefinition, VETERAN_MISSION_CATALOG, type VeteranMissionDefinition } from './VeteranMission'

export type RecruitMissionRisk = '低' | '中' | '高' | '極高'
export type RecruitPatrolRouteId = 'south-road' | 'forest-line'

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

export interface RecruitPatrolMissionTemplate extends RecruitMissionCommon {
  kind: 'patrol'
  routeId: RecruitPatrolRouteId
  encounterBanditCount: number
}

export interface RecruitTownDefenseMissionTemplate extends RecruitMissionCommon {
  kind: 'town-defense'
  targetArea: 'career-town'
  friendlySoldiers: number
  enemyCount: number
  civilianCount: number
  maxCivilianDeaths: number
}

export interface CavalrySweepTemplate extends RecruitMissionCommon { kind: 'cavalry-sweep' }

export interface EnemyTownAssaultTemplate extends RecruitMissionCommon { kind: 'enemy-town-assault' }

export type RecruitMissionTemplate =
  | CavalrySweepTemplate
  | EnemyTownAssaultTemplate
  | RecruitBanditMissionTemplate
  | RecruitPatrolMissionTemplate
  | RecruitTownDefenseMissionTemplate

export type CareerMissionTemplate = RecruitMissionTemplate | VeteranMissionDefinition

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
    ? '跟隨隊長清除營地；保持隊形並確認所有目標。'
    : '敵眾我寡。跟緊隊伍，只對任務指定目標作戰。',
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

const patrol = (
  id: string,
  name: string,
  briefing: string,
  routeId: RecruitPatrolRouteId,
  friendlyCombatants: number,
  encounterBanditCount: number,
  risk: RecruitMissionRisk,
  requiresEnlistmentMerit = 0,
): RecruitPatrolMissionTemplate => ({
  id,
  kind: 'patrol',
  name,
  briefing,
  routeId,
  friendlyCombatants,
  encounterBanditCount,
  risk,
  requiresEnlistmentMerit,
  requiresCompletions: 0,
  storyOnce: false,
  minRank: 'recruit',
})

export const VETERAN_TOWN_DEFENSE_TEMPLATE: RecruitTownDefenseMissionTemplate = {
  id: VETERAN_TOWN_DEFENSE_TEMPLATE_ID,
  kind: 'town-defense',
  name: '守衛家園 · 老兵守城',
  briefing: '敵方騎兵正在逼近城鎮。加入守軍守住防線，並保護居民。',
  targetArea: 'career-town',
  friendlySoldiers: 208,
  friendlyCombatants: 209,
  enemyCount: townDefenseEnemyCount(VETERAN_TOWN_DEFENSE_TEMPLATE_ID, 'veteran'),
  civilianCount: 20,
  maxCivilianDeaths: 10,
  risk: '極高',
  requiresEnlistmentMerit: 0,
  requiresCompletions: 5,
  storyOnce: false,
  minRank: 'veteran',
}

/**
 * The board stays intentionally compact and repeatable. Roughly ten ordinary,
 * credited contributions should earn enough merit for Soldier eligibility;
 * the number of templates is not a promotion requirement.
 */
export const RECRUIT_MISSION_CATALOG: readonly RecruitMissionTemplate[] = [
  { id: 'career-cavalry-sweep', kind: 'cavalry-sweep', name: 'Cavalry Sweep · 騎兵清剿', briefing: '軍營集結，跟隨騎兵出城清剿 · 60 騎兵 vs 40 Bandits', friendlyCombatants: 60, risk: '低', requiresEnlistmentMerit: 0, requiresCompletions: 0, storyOnce: false, minRank: 'recruit' },
  { id: 'career-enemy-town-assault', kind: 'enemy-town-assault', name: 'Enemy Town Assault · 進攻敵方家園', briefing: '120 人攻城軍 · 四門進攻 · 擊敗全部敵方軍事守軍', friendlyCombatants: 120, risk: '極高', requiresEnlistmentMerit: 0, requiresCompletions: 0, storyOnce: false, minRank: 'soldier' },
  mission('recruit-bandits-01', '營火邊的三名盜匪', 5, 3, '低', 0),
  mission('recruit-bandits-02', '大隊剿匪', 20, 12, '中', 2, 0, 1),

  patrol(
    'recruit-patrol-01',
    '南路巡邏',
    '跟隨隊長巡查城鎮外圍道路。保持隊伍，不要落隊，依序完成沿線巡查。',
    'south-road',
    6,
    4,
    '低',
  ),
  patrol(
    'recruit-patrol-02',
    '林線巡邏',
    '沿森林邊緣完成例行巡邏。地形複雜，跟緊隊長並保持警戒。',
    'forest-line',
    8,
    7,
    '中',
    60,
  ),

  mission('recruit-bandits-03', '寡不敵眾', 6, 10, '高', 3, 90),
  mission('recruit-bandits-04', '深入敵營', 10, 20, '極高', 4, 120),


]

export function patrolPreferredCamp(routeId: RecruitPatrolRouteId): number {
  return routeId === 'south-road' ? 1 : 4
}

export function getRecruitMissionTemplate(id: string): RecruitMissionTemplate | null {
  return RECRUIT_MISSION_CATALOG.find(template => template.id === id) ?? null
}

/** Generic lookup used by the active-mission save parser; the legacy Recruit lookup stays narrow. */
export function getCareerMissionTemplate(id: string): CareerMissionTemplate | null {
  if (id === VETERAN_TOWN_DEFENSE_TEMPLATE_ID) return VETERAN_TOWN_DEFENSE_TEMPLATE
  return getRecruitMissionTemplate(id) ?? getVeteranMissionDefinition(id)
}

export function isEnemyTownAssaultUnlocked(profile: Pick<CareerProfile, 'completedOutpostRelief'>): boolean {
  return profile.completedOutpostRelief === true
}

export function availableRecruitMissions(profile: CareerProfile): RecruitMissionTemplate[] {
  if (profile.activeMission) return []
  const merit = enlistmentMerit(profile)
  const completions = profile.careerMissionCompletions ?? 0
  const completedStory = profile.completedCareerMissionTemplateIds ?? []
  const available = RECRUIT_MISSION_CATALOG.filter(template => (
    CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf(template.minRank)
    && merit >= template.requiresEnlistmentMerit
    && (template.kind === 'town-defense' ? careerMissionCompletionsForTier(profile, careerMissionTier(template)) : completions) >= template.requiresCompletions
    && (template.kind !== 'cavalry-sweep' || Boolean(resolveCareerReliefMount(profile)))
    && (template.kind !== 'enemy-town-assault' || isEnemyTownAssaultUnlocked(profile))
    && (!template.storyOnce || !completedStory.includes(template.id))
  )).map(template => template.kind === 'town-defense'
    ? { ...template, enemyCount: townDefenseEnemyCount(template.id, profile.rank) }
    : template)
  return isTownDefenseMissionAvailable(profile, VETERAN_TOWN_DEFENSE_TEMPLATE)
    ? [...available, { ...VETERAN_TOWN_DEFENSE_TEMPLATE, enemyCount: townDefenseEnemyCount(VETERAN_TOWN_DEFENSE_TEMPLATE_ID, profile.rank) }]
    : available
}

export type CareerMissionPage = 'recruit' | 'soldier' | 'veteran'

export function defaultCareerMissionPage(profile: Pick<CareerProfile, 'rank'>): CareerMissionPage {
  return CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf('veteran') ? 'veteran'
    : CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf('soldier') ? 'soldier' : 'recruit'
}

export function isCareerMissionPageUnlocked(profile: Pick<CareerProfile, 'rank'>, page: CareerMissionPage): boolean {
  const requiredRank: CareerRank = page === 'veteran' ? 'veteran' : page === 'soldier' ? 'soldier' : 'recruit'
  return CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf(requiredRank)
}

export function careerMissionPage(template: CareerMissionTemplate): CareerMissionPage {
  const tier = careerMissionTier(template)
  return tier === 3 ? 'veteran' : tier === 2 ? 'soldier' : 'recruit'
}

export function careerMissionTier(template: CareerMissionTemplate): CareerMissionTier {
  return careerMissionTierForTemplateId(template.id)
}

export function careerMissionTemplatesForPage(profile: CareerProfile, page: CareerMissionPage): CareerMissionTemplate[] {
  if (page === 'veteran') {
    if (!isCareerMissionPageUnlocked(profile, page)) return []
    const homeDefense = { ...VETERAN_TOWN_DEFENSE_TEMPLATE, enemyCount: townDefenseEnemyCount(VETERAN_TOWN_DEFENSE_TEMPLATE_ID, profile.rank) }
    return [...VETERAN_MISSION_CATALOG, homeDefense]
  }
  return availableRecruitMissions(profile).filter(template => careerMissionPage(template) === page)
}

function isTownDefenseMissionAvailable(profile: CareerProfile, template: RecruitTownDefenseMissionTemplate): boolean {
  return !profile.activeMission
    && CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf(template.minRank)
    && enlistmentMerit(profile) >= template.requiresEnlistmentMerit
    && careerMissionCompletionsForTier(profile, careerMissionTier(template)) >= template.requiresCompletions
    && !(template.storyOnce && (profile.completedCareerMissionTemplateIds ?? []).includes(template.id))
}

export function availableCareerMissionsForPage(profile: CareerProfile, page: CareerMissionPage): CareerMissionTemplate[] {
  if (page === 'veteran') return careerMissionTemplatesForPage(profile, page).filter(template => template.kind === 'town-defense'
    ? availableRecruitMissions(profile).some(available => available.id === template.id)
    : getVeteranMissionAvailability(profile, template.id).unlocked)
  return careerMissionTemplatesForPage(profile, page)
}
