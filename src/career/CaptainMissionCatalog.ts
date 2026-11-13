import { commanderGateDefenseSlots } from './CommanderTownRoster'
export { commanderGateDefenseSlots } from './CommanderTownRoster'
import { CAREER_RANKS, type CareerProfile } from './CareerProfile'
import { careerItemTotal } from './CareerInventory'
import { resolveCareerReliefMount } from './CareerOutpostMission'
import { createCareerMissionId, createTownDefenseMission, type ActiveCareerMission } from './CareerMissionState'
import { snapshotPersonalMission } from './CareerPersonalSquadMission'
import { townDefenseForceCounts, type TownActorSpec } from '../town/TownRules'
import type { TownGateId } from '../town/TownLayout'
import { siegeDefensePlans, type SiegeDefensePlan } from './TownSiege'
import { createMissionCommandAuthority, type OfficialCommandSquad } from './CareerCommandAuthority'
import { townDefenseCommanderIds } from './TownDefenseRoster'

export const CAPTAIN_PATROL_COMMAND_ID = 'captain-patrol-command'
export const CAPTAIN_CAVALRY_COMMAND_ID = 'captain-cavalry-command'
export const CAPTAIN_GATE_DEFENSE_ID = 'captain-gate-defense'
export const CAPTAIN_DEFENSE_GATE: TownGateId = 'north'
export const CAPTAIN_DEFENSE_GATE_LABEL = '北門'
export const CAPTAIN_FRONTLINE_COMMAND_ID = 'captain-frontline-command'
export const CAPTAIN_SIEGE_COMMAND_ID = 'captain-siege-command'
export const CAPTAIN_EAGLE_BATTLE_ID = 'captain-eagle-battle'

interface CaptainMissionCommon {
  id: string
  name: string
  briefing: string
  friendlyCombatants: number
  enemyCombatants: number
  risk: '低' | '中' | '高' | '極高'
  minRank: 'captain'
  requiresCompletions: 0
  requiresEnlistmentMerit: 0
  storyOnce: false
}
export type CaptainMissionKind = 'captain-patrol-command' | 'cavalry-sweep' | 'town-defense' | 'captain-outpost-defense' | 'enemy-town-assault' | 'captain-eagle-battle'
export type CaptainMissionDefinition = CaptainMissionCommon & (
  | { kind: 'town-defense'; targetArea: 'career-town'; friendlySoldiers: number; enemyCount: number; civilianCount: number; maxCivilianDeaths: number }
  | { kind: Exclude<CaptainMissionKind, 'town-defense'> }
)
const entry = (id: string, kind: CaptainMissionKind, name: string, briefing: string, friendlyCombatants: number, enemyCombatants: number): CaptainMissionDefinition => {
  const common: CaptainMissionCommon = { id, name, briefing, friendlyCombatants, enemyCombatants, risk: '高', minRank: 'captain', requiresCompletions: 0, requiresEnlistmentMerit: 0, storyOnce: false }
  return kind === 'town-defense' ? { ...common, kind, targetArea: 'career-town', friendlySoldiers: friendlyCombatants - 1, enemyCount: enemyCombatants, civilianCount: 20, maxCivilianDeaths: 10 } : { ...common, kind }
}
export const CAPTAIN_MISSION_CATALOG: readonly CaptainMissionDefinition[] = [
  entry(CAPTAIN_PATROL_COMMAND_ID, 'captain-patrol-command', 'Captain I · Patrol Command · 實習隊長巡邏', '目標：指揮 20 人巡邏隊，累積 30 次有效擊殺。', 21, 30),
  entry(CAPTAIN_CAVALRY_COMMAND_ID, 'cavalry-sweep', 'Captain II · Cavalry Command · 騎兵清剿', '目標：率領 29 人騎兵隊，與其他騎兵一同出城，消滅 40 名盜匪（我方共 60 騎，含你）。', 60, 40),
  entry(CAPTAIN_FRONTLINE_COMMAND_ID, 'captain-outpost-defense', 'Captain III · Frontline Commander · 前線指揮官', '目標：守住前線營地。90 名守軍加上你，迎戰 200 名 T3 與 2 名 T4 敵軍；120 秒後有 50 名友軍騎兵增援。', 91, 202),
  entry(CAPTAIN_EAGLE_BATTLE_ID, 'captain-eagle-battle', 'Captain IV · Eagle Battle · 巨鷹空戰', '目標：30 對 30 巨鷹空戰（我方含你）。已招募的私兵會額外參戰。', 30, 30),
]
export const RETIRED_CAPTAIN_GATE_DEFENSE_DEFINITION: CaptainMissionDefinition = entry(CAPTAIN_GATE_DEFENSE_ID, 'town-defense', 'Captain III · Gate Defense · 城門防衛', '目標：指揮北門步兵守住城門，擊退來襲敵軍；其他城門由守軍自行防守。', townDefenseForceCounts().friendlyCombatants, 120)
export const RETIRED_CAPTAIN_SIEGE_COMMAND_DEFINITION: CaptainMissionDefinition = entry(CAPTAIN_SIEGE_COMMAND_ID, 'enemy-town-assault', 'Captain V · Siege Commander · 攻城隊長', '目標：率領 120 人（含你）從四門進攻敵城。你指揮北門 29 人，其餘三門由 AI 指揮；擊潰全部地面守軍並迫使空軍撤離。', 120, 0)
export function getCaptainMissionDefinition(id: string): CaptainMissionDefinition | null {
  return CAPTAIN_MISSION_CATALOG.find(template => template.id === id) ?? null
}
export function hasCaptainCommandRank(profile: Pick<CareerProfile, 'rank'>): boolean {
  return CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf('captain')
}
export function getCaptainMissionAvailability(profile: CareerProfile, templateId: string): { unlocked: boolean; reason?: string } {
  const template = getCaptainMissionDefinition(templateId)
  if (!template || !hasCaptainCommandRank(profile)) return { unlocked: false, reason: '需要晉升為隊長。' }
  if (profile.activeRace || profile.activeMission || profile.activeOutpostMission) return { unlocked: false, reason: '請先完成目前的任務。' }
  if (profile.townEvent?.state === 'hostile') return { unlocked: false, reason: '目前仍在交戰，暫時無法接取。' }
  if (templateId === CAPTAIN_CAVALRY_COMMAND_ID && !resolveCareerReliefMount(profile)) return { unlocked: false, reason: '需要一匹可使用的自有坐騎。' }
  if (templateId === CAPTAIN_EAGLE_BATTLE_ID && careerItemTotal(profile, 'xongkoro') === 0) return { unlocked: false, reason: '需要一隻自有巨鷹：請先到巨鷹訓練場購買。' }
  return { unlocked: true }
}
export function availableCaptainMissions(profile: CareerProfile): CaptainMissionDefinition[] {
  return CAPTAIN_MISSION_CATALOG.filter(template => getCaptainMissionAvailability(profile, template.id).unlocked)
}
/** The complete gate infantry plan owns authorization, including ranged infantry and officers. */
export function captainGateDefenseActorIds(residents: readonly TownActorSpec[], unavailableActorIds: ReadonlySet<string> = new Set(), defensePlans: readonly SiegeDefensePlan[] = siegeDefensePlans(residents)): string[] {
  const residentIds = new Set(residents.map(actor => actor.id))
  return (defensePlans.find(plan => plan.gateId === CAPTAIN_DEFENSE_GATE)?.infantry ?? [])
    .filter(id => residentIds.has(id) && !unavailableActorIds.has(id))
}
export function captainGateDefenseBriefing(residents: readonly TownActorSpec[], unavailableActorIds: ReadonlySet<string> = new Set()): string {
  const count = captainGateDefenseActorIds(residents, unavailableActorIds).length
  return `目標：指揮${CAPTAIN_DEFENSE_GATE_LABEL} ${count} 名步兵守住城門，擊退來襲敵軍；其他城門由守軍自行防守。`
}

export function commanderGateDefenseSquads(residents: readonly TownActorSpec[], friendlyActorIds: readonly string[], unavailableActorIds: ReadonlySet<string> = new Set()): OfficialCommandSquad[] {
  const residentIds = new Set(residents.map(actor => actor.id)), accepted = new Set(friendlyActorIds)
  return commanderGateDefenseSlots().map(squad => ({ ...squad,
    actorIds: squad.actorIds.filter(id => residentIds.has(id) && accepted.has(id) && !unavailableActorIds.has(id)),
  })).filter(squad => squad.actorIds.length > 0)
}
export function createCaptainGateDefenseMission(profile: CareerProfile, friendlyActorIds: string[], civilianActorIds: string[], residents: readonly TownActorSpec[], id = createCareerMissionId(CAPTAIN_GATE_DEFENSE_ID), unavailableActorIds: ReadonlySet<string> = new Set()): ActiveCareerMission {
  const commanders = townDefenseCommanderIds(profile, residents, unavailableActorIds)
  const defenders = commanders.length ? [...new Set([...friendlyActorIds, ...commanders])] : friendlyActorIds
  const mission = createTownDefenseMission(defenders, civilianActorIds, id, CAPTAIN_GATE_DEFENSE_ID, profile.rank)
  const actorIds = captainGateDefenseActorIds(residents, unavailableActorIds).filter(actorId => friendlyActorIds.includes(actorId))
  mission.officialSquad = createMissionCommandAuthority(id, profile.faction, profile.rank, actorIds,
    profile.rank === 'commander' ? commanderGateDefenseSquads(residents, defenders, unavailableActorIds) : [])
  mission.personalSquad = snapshotPersonalMission(profile)
  return mission
}
export function createCaptainPatrolCommandMission(profile: CareerProfile, patrolActorIds: readonly string[], id = createCareerMissionId(CAPTAIN_PATROL_COMMAND_ID)): ActiveCareerMission {
  const actorIds = [...new Set(patrolActorIds)].slice(0, 20)
  return { id, templateId: CAPTAIN_PATROL_COMMAND_ID, kind: 'captain-patrol-command', phase: 'ENGAGING', targetCampId: -1,
    targetActorIds: [], friendlyActorIds: actorIds, borrowedActorIds: [...actorIds], patrolKilledActorIds: [], acceptedAt: Date.now(),
    officialSquad: createMissionCommandAuthority(id, profile.faction, profile.rank, actorIds,
      actorIds.length ? [{ squadId: 1, actorIds }] : []),
    personalSquad: snapshotPersonalMission(profile) }
}
