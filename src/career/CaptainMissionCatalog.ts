import { CAREER_RANKS, type CareerProfile } from './CareerProfile'
import { careerItemTotal } from './CareerInventory'
import { resolveCareerReliefMount } from './CareerOutpostMission'
import { createCareerMissionId, createTownDefenseMission, type ActiveCareerMission } from './CareerMissionState'
import { snapshotPersonalMission } from './CareerPersonalSquadMission'
import { emptyPersonalContribution } from '../combat/CommandMerit'
import type { TownActorSpec } from '../town/TownRules'
import type { TownGateId } from '../town/TownLayout'
import { siegeDefensePlans } from './TownSiege'

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
  entry(CAPTAIN_PATROL_COMMAND_ID, 'captain-patrol-command', 'Captain I · Patrol Command · 實習隊長巡邏', '指揮既有 20 人巡邏隊，累積 30 次有效敵軍擊殺。', 21, 30),
  entry(CAPTAIN_CAVALRY_COMMAND_ID, 'cavalry-sweep', 'Captain II · Cavalry Command · 騎兵清剿', '60 騎兵（含玩家）對抗 40 Bandits；指揮第一支 29 人騎兵隊。', 60, 40),
  entry(CAPTAIN_GATE_DEFENSE_ID, 'town-defense', 'Captain III · Gate Defense · 城門防衛', '指揮北門既有步兵；定位後聽從玩家命令，其餘守軍守住各自城門。', 209, 120),
  entry(CAPTAIN_FRONTLINE_COMMAND_ID, 'captain-outpost-defense', 'Captain IV · Frontline Commander · 前線指揮官', 'Campaign Stage IX 防線；90 名既有守軍加玩家，200 名 T3 與 2 名 T4 敵軍；120 秒後 50 名援軍。', 91, 202),
  entry(CAPTAIN_SIEGE_COMMAND_ID, 'enemy-town-assault', 'Captain V · Siege Commander · 攻城隊長', '120 人四門進攻（含玩家）；指揮北門 29 人，其餘三門由 AI 指揮。', 120, 0),
  entry(CAPTAIN_EAGLE_BATTLE_ID, 'captain-eagle-battle', 'Captain VI · Eagle Battle · 巨鷹空戰', '30 對 30 巨鷹空戰（含玩家）；全部已招募私兵額外參戰。', 30, 30),
]
export function getCaptainMissionDefinition(id: string): CaptainMissionDefinition | null {
  return CAPTAIN_MISSION_CATALOG.find(template => template.id === id) ?? null
}
export function hasCaptainCommandRank(profile: Pick<CareerProfile, 'rank'>): boolean {
  return CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf('captain')
}
export function getCaptainMissionAvailability(profile: CareerProfile, templateId: string): { unlocked: boolean; reason?: string } {
  const template = getCaptainMissionDefinition(templateId)
  if (!template || !hasCaptainCommandRank(profile)) return { unlocked: false, reason: '需要 Captain 軍階。' }
  if (profile.activeMission || profile.activeOutpostMission) return { unlocked: false, reason: '請先完成目前的正式任務。' }
  if (profile.townEvent?.state === 'hostile') return { unlocked: false, reason: '城鎮敵對事件中無法接受任務。' }
  if (templateId === CAPTAIN_CAVALRY_COMMAND_ID && !resolveCareerReliefMount(profile)) return { unlocked: false, reason: '需要可使用的已購買坐騎。' }
  if (templateId === CAPTAIN_EAGLE_BATTLE_ID && careerItemTotal(profile, 'xongkoro') === 0) return { unlocked: false, reason: '需要先購買 xongkoro。' }
  return { unlocked: true }
}
export function availableCaptainMissions(profile: CareerProfile): CaptainMissionDefinition[] {
  return CAPTAIN_MISSION_CATALOG.filter(template => getCaptainMissionAvailability(profile, template.id).unlocked)
}
/** Only the established gate plan contributes residents; never borrow another gate's guards. */
export function captainGateDefenseActorIds(residents: readonly TownActorSpec[], unavailableActorIds: ReadonlySet<string> = new Set()): string[] {
  const plan = siegeDefensePlans(residents).find(plan => plan.gateId === CAPTAIN_DEFENSE_GATE)
  const eligible = new Set(plan?.infantry ?? [])
  return residents.filter(actor => eligible.has(actor.id) && !unavailableActorIds.has(actor.id)
    && !actor.mounted && ['melee_infantry', 'spearman_infantry', 'archer_infantry'].includes(actor.role))
    .sort((a, b) => Number(b.gateId === CAPTAIN_DEFENSE_GATE) - Number(a.gateId === CAPTAIN_DEFENSE_GATE)).slice(0, 30).map(actor => actor.id)
}
export function captainGateDefenseBriefing(residents: readonly TownActorSpec[], unavailableActorIds: ReadonlySet<string> = new Set()): string {
  const count = captainGateDefenseActorIds(residents, unavailableActorIds).length
  return `指揮${CAPTAIN_DEFENSE_GATE_LABEL} ${count} 名既有步兵；定位後聽從玩家命令，其餘守軍守住各自城門。`
}
export function createCaptainGateDefenseMission(profile: CareerProfile, friendlyActorIds: string[], civilianActorIds: string[], residents: readonly TownActorSpec[], id = createCareerMissionId(CAPTAIN_GATE_DEFENSE_ID), unavailableActorIds: ReadonlySet<string> = new Set()): ActiveCareerMission {
  const mission = createTownDefenseMission(friendlyActorIds, civilianActorIds, id, CAPTAIN_GATE_DEFENSE_ID, profile.rank)
  const actorIds = captainGateDefenseActorIds(residents, unavailableActorIds).filter(actorId => friendlyActorIds.includes(actorId))
  mission.officialSquad = { type: 'mission-official', missionId: id, townFaction: profile.faction, squadId: 1, actorIds, contribution: emptyPersonalContribution() }
  mission.personalSquad = snapshotPersonalMission(profile)
  return mission
}
export function createCaptainPatrolCommandMission(profile: CareerProfile, patrolActorIds: readonly string[], id = createCareerMissionId(CAPTAIN_PATROL_COMMAND_ID)): ActiveCareerMission {
  const actorIds = [...new Set(patrolActorIds)].slice(0, 20)
  return { id, templateId: CAPTAIN_PATROL_COMMAND_ID, kind: 'captain-patrol-command', phase: 'ENGAGING', targetCampId: -1,
    targetActorIds: [], friendlyActorIds: actorIds, borrowedActorIds: [...actorIds], patrolKilledActorIds: [], acceptedAt: Date.now(),
    officialSquad: { type: 'mission-official', missionId: id, townFaction: profile.faction, squadId: 1, actorIds: [...actorIds], contribution: emptyPersonalContribution() },
    personalSquad: snapshotPersonalMission(profile) }
}
