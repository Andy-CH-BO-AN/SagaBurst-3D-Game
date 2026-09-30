import { enlistmentMerit, type CareerProfile } from './CareerProfile'

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

export type RecruitMissionTemplate =
  | RecruitBanditMissionTemplate
  | RecruitPatrolMissionTemplate
  | RecruitTownDefenseMissionTemplate

const mission = (
  id: string,
  name: string,
  friendlyCombatants: number,
  banditCount: number,
  risk: RecruitMissionRisk,
  preferredCampIndex: number,
  requiresEnlistmentMerit = 0,
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
  requiresCompletions: 0,
  storyOnce: false,
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
})

/**
 * The board stays intentionally compact and repeatable. Roughly ten ordinary,
 * credited contributions should earn enough merit for Soldier eligibility;
 * the number of templates is not a promotion requirement.
 */
export const RECRUIT_MISSION_CATALOG: readonly RecruitMissionTemplate[] = [
  mission('recruit-bandits-01', '營火邊的三名盜匪', 5, 3, '低', 0),
  mission('recruit-bandits-02', '大隊剿匪', 20, 12, '中', 2),

  patrol(
    'recruit-patrol-01',
    '南路巡邏',
    '跟隨隊長巡查城鎮外圍道路。保持隊伍，不要落隊；途中可能遭遇敵人。',
    'south-road',
    6,
    4,
    '低',
  ),
  patrol(
    'recruit-patrol-02',
    '林線巡邏',
    '沿森林邊緣完成巡邏。敵軍活動增加，做好接敵準備。',
    'forest-line',
    8,
    7,
    '中',
    60,
  ),

  mission('recruit-bandits-03', '寡不敵眾', 6, 10, '高', 3, 90),
  mission('recruit-bandits-04', '深入敵營', 10, 20, '極高', 4, 120),

  {
    id: 'recruit-town-defense-01',
    kind: 'town-defense',
    name: '家門口的戰爭 · Town Defense',
    briefing: '敵方騎兵正在逼近城鎮。加入守軍，守住防線並保護居民。',
    targetArea: 'career-town',
    friendlySoldiers: 60,
    friendlyCombatants: 62,
    enemyCount: 50,
    civilianCount: 20,
    maxCivilianDeaths: 10,
    risk: '極高',
    requiresEnlistmentMerit: 120,
    requiresCompletions: 5,
    storyOnce: true,
  },
]

export function patrolPreferredCamp(routeId: RecruitPatrolRouteId): number {
  return routeId === 'south-road' ? 1 : 4
}

export function getRecruitMissionTemplate(id: string): RecruitMissionTemplate | null {
  return RECRUIT_MISSION_CATALOG.find(template => template.id === id) ?? null
}

export function availableRecruitMissions(profile: CareerProfile): RecruitMissionTemplate[] {
  if (profile.rank !== 'recruit' || profile.activeMission) return []
  const merit = enlistmentMerit(profile)
  const completions = profile.careerMissionCompletions ?? 0
  const completedStory = profile.completedCareerMissionTemplateIds ?? []
  return RECRUIT_MISSION_CATALOG.filter(template => (
    merit >= template.requiresEnlistmentMerit
    && completions >= template.requiresCompletions
    && (!template.storyOnce || !completedStory.includes(template.id))
  ))
}
