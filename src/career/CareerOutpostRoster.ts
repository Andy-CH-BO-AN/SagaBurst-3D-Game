import type { UnitTierCounts } from '../battle/BattleConfig'
import { BattleSpawner, type NpcSpawnSpec } from '../battle/BattleSpawner'
import { getDefenseCampaignStage, resolveCampaignRolePreset, type CampaignFaction } from '../campaign/CampaignConfig'
import { createDefaultDefensePlayerLoadout, createDefenseCampaignWaveConfig, type DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { Faction } from '../combat/CombatFaction'
import type { OfficialCommandSquad } from './CareerCommandAuthority'
import type { CareerOutpostMission } from './CareerOutpostMission'
import { createCareerReliefSpawnPlan } from './CareerOutpostRelief'
import { commandSquadsFromActorIds, commandSquadsFromSlots } from './MissionCommandRoster'

/** This is the production army used by both launch and the accepted command grant. */
export function createCareerOutpostDefenderArmy(faction: CampaignFaction,
  mission: Pick<CareerOutpostMission, 'kind' | 'stageId'>): Record<string, UnitTierCounts> {
  if (mission.kind === 'outpost-relief') return {
    [resolveCampaignRolePreset(faction, 'frontline')]: { 1: 0, 2: 16, 3: 0 },
    [resolveCampaignRolePreset(faction, 'ranged')]: { 1: 0, 2: 4, 3: 0 },
  }
  const stage = getDefenseCampaignStage(mission.stageId)
  const upper = stage.defenderDeployment.upperTierPoolCap ?? stage.defenderDeployment.maxUnits
  const t3 = Math.min(stage.defenderDeployment.tierCapacity[3], upper)
  const t2 = upper - t3
  const t1 = stage.defenderDeployment.maxUnits - upper
  const cavalry = stage.defenderDeployment.cavalryCap ?? t3
  const infantryT3 = Math.max(0, t3 - cavalry)
  const cavalryT2 = Math.max(0, cavalry - t3)
  const infantryT2 = t2 - cavalryT2
  // The AI Captain occupies one melee slot; Player is additional to this army.
  return {
    [resolveCampaignRolePreset(faction, 'frontline')]: { 1: 0, 2: Math.floor(infantryT2 / 2) - 1, 3: Math.floor(infantryT3 / 2), 4: 1 },
    [`${faction}_spearman`]: { 1: 0, 2: Math.ceil(infantryT2 / 2), 3: Math.ceil(infantryT3 / 2) },
    [`${faction}_archer`]: { 1: t1, 2: 0, 3: 0 },
    [resolveCampaignRolePreset(faction, 'lancer')]: { 1: 0, 2: cavalryT2, 3: Math.min(cavalry, t3) },
  }
}

export function careerOutpostActorId(missionId: string, wave: 'initial' | 'attackers' | 'reinforcement', index: number): string {
  return `${missionId}:${wave}:${index}`
}

/** Group existing production slots without spawning actors or inventing extra soldiers. */
export function createCareerOutpostCommandSquads(faction: CampaignFaction,
  mission: Pick<CareerOutpostMission, 'id' | 'kind' | 'stageId'>): OfficialCommandSquad[] {
  const relief = mission.kind === 'outpost-relief'
  const launch: DefenseCampaignLaunchConfig = {
    type: 'defense', defenderFaction: faction, stageId: mission.stageId,
    careerMissionId: mission.id, careerMissionKind: mission.kind,
    defenderArmy: createCareerOutpostDefenderArmy(faction, mission),
    playerLoadout: createDefaultDefensePlayerLoadout(faction),
    capabilities: { reinforcementsEnabled: !relief, playerCommandsEnabled: false, gateControlEnabled: false, attackerHeroesEnabled: false },
  }
  const accepted = (specs: readonly NpcSpawnSpec[], wave: 'initial' | 'reinforcement') => specs
    .map((spec, index) => ({ spec, actorId: careerOutpostActorId(mission.id, wave, index) }))
    .filter(({ spec }) => spec.characterFaction === faction && spec.faction === Faction.PLAYER)
  const initial = accepted(relief ? createCareerReliefSpawnPlan(launch).npcSpecs
    : BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'defenders')).npcSpecs, 'initial')
  // Relief's Captain/Maki groups are authored; regular defense only has generic
  // ten-person auto buckets, so use stable production-slot chunks like Frontline.
  const authored = relief ? initial.filter(({ spec }) => spec.squadId !== undefined) : []
  const squads = commandSquadsFromSlots(authored.map(slot => slot.actorId), authored.map(slot => slot.spec))
  const unassigned = initial.filter(({ spec }) => !relief || spec.squadId === undefined).map(slot => slot.actorId)
  const nextSquadId = () => Math.max(0, ...squads.map(squad => squad.squadId)) + 1
  squads.push(...commandSquadsFromActorIds(unassigned, nextSquadId()))
  if (!relief) {
    const reinforcement = accepted(BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'reinforcement')).npcSpecs, 'reinforcement')
    squads.push(...commandSquadsFromActorIds(reinforcement.map(slot => slot.actorId), nextSquadId()))
  }
  return squads
}
