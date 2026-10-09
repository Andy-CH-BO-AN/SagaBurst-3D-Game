import { BattleSpawner, type BattleSpawnPlan } from '../battle/BattleSpawner'
import { createEmptyRomanArmyConfig, createEmptyVikingArmyConfig, type BattleConfig, type PlayerLoadoutConfig } from '../battle/BattleConfig'
import { getDefenseCampaignStage, resolveCampaignRolePreset } from '../campaign/CampaignConfig'
import { createDefenseCampaignWaveConfig, positionDefenseCampaignDefenders, type DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { canUseCareerMount } from './CareerMountController'
import { careerItemTotal } from './CareerInventory'
import { resolveCareerHeroAsset } from './CareerPlayerProfile'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { createCareerMissionId, type ActiveCareerMission } from './CareerMissionState'
import { snapshotPersonalMission, clonePersonalMission } from './CareerPersonalSquadMission'
import { emptyPersonalContribution } from '../combat/CommandMerit'
import { getCampaignOutpostPlacement } from '../campaign/CampaignOutpost'
import { CAPTAIN_EAGLE_BATTLE_ID, CAPTAIN_FRONTLINE_COMMAND_ID } from './CaptainMissionCatalog'

export interface CaptainEagleLaunchConfig { type: 'captain-eagle'; careerMissionId: string; battle: BattleConfig }
export type CareerCombatLaunch = DefenseCampaignLaunchConfig | CaptainEagleLaunchConfig

function captainAvailable(profile: CareerProfile): boolean {
  return (profile.rank === 'captain' || profile.rank === 'commander') && !profile.activeMission && !profile.activeOutpostMission && profile.townEvent?.state !== 'hostile'
}

function playerLoadout(profile: CareerProfile, eagle = false): PlayerLoadoutConfig {
  const mount = eagle ? 'xongkoro' : profile.selectedMountId
  return {
    meleeWeaponId: profile.equipment?.melee ?? profile.starterWeaponId ?? 'gladius_rusty',
    rangedWeaponId: profile.equipment?.ranged ?? 'wooden_shortbow',
    shieldId: profile.equipment?.shield ?? null,
    startMounted: Boolean(mount && canUseCareerMount(profile, mount)),
    mountId: mount === 'black-cat' || mount === 'corgi' || mount === 'xongkoro' ? mount : 'horse',
  } as PlayerLoadoutConfig
}

/** Career owns the mission; Stage IX remains the source of map, enemy, reinforcement and timing rules. */
export function createCaptainFrontlineLaunch(profile: CareerProfile): DefenseCampaignLaunchConfig {
  const mission = profile.activeMission
  if (mission?.templateId !== CAPTAIN_FRONTLINE_COMMAND_ID || mission.kind !== 'captain-outpost-defense') throw new Error('Expected Captain Frontline mission')
  const faction = profile.faction
  return {
    type: 'defense', careerMissionId: mission.id, careerMissionKind: 'captain-outpost-defense',
    defenderFaction: faction, stageId: 9, playerHeroId: resolveCareerHeroAsset(profile),
    commandGrouping: 'squad', playerLoadout: playerLoadout(profile),
    defenderArmy: {
      [resolveCampaignRolePreset(faction, 'frontline')]: { 1: 0, 2: 0, 3: 40 },
      [`${faction}_archer`]: { 1: 0, 2: 0, 3: 30 },
      [resolveCampaignRolePreset(faction, 'sword_cavalry')]: { 1: 0, 2: 0, 3: 20 },
    },
    capabilities: { playerCommandsEnabled: true },
    ...(mission.personalSquad ? { careerPersonalSquad: clonePersonalMission(mission.personalSquad) } : {}),
  }
}

export function createCaptainFrontlineSpawnPlan(launch: DefenseCampaignLaunchConfig): BattleSpawnPlan {
  const plan = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'defenders'))
  positionDefenseCampaignDefenders(plan.npcSpecs, launch.defenderFaction)
  const placement = getCampaignOutpostPlacement(launch.defenderFaction)
  const melee = plan.npcSpecs.filter(spec => spec.presetId === resolveCampaignRolePreset(launch.defenderFaction, 'frontline'))
    .sort((a, b) => Math.abs(a.z - placement.frontZ) - Math.abs(b.z - placement.frontZ)).slice(0, 20)
  const authorized = new Set(melee)
  plan.npcSpecs.forEach((spec, index) => { spec.actorId = `${launch.careerMissionId}:initial:${index}`; spec.squadId = authorized.has(spec) ? 1 : 2 })
  return plan
}

export function acceptCaptainFrontline(current: CareerProfile, id = createCareerMissionId(CAPTAIN_FRONTLINE_COMMAND_ID)): CareerProfile | null {
  if (!captainAvailable(current)) return null
  const next = cloneCareerProfile(current)
  const mission: ActiveCareerMission = {
    id, templateId: CAPTAIN_FRONTLINE_COMMAND_ID, kind: 'captain-outpost-defense', targetCampId: -1,
    phase: 'PREPARING', acceptedAt: Date.now(), friendlyActorIds: [], targetActorIds: [],
    personalSquad: snapshotPersonalMission(next),
  }
  next.activeMission = mission
  const launch = createCaptainFrontlineLaunch(next)
  const plan = createCaptainFrontlineSpawnPlan(launch)
  const stage = getDefenseCampaignStage(9)
  mission.friendlyActorIds = plan.npcSpecs.map(spec => spec.actorId!)
  mission.reinforcementActorIds = Array.from({ length: stage.reinforcement.count }, (_, index) => `${id}:reinforcement:${index}`)
  const attackers = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'attackers'))
  mission.targetActorIds = attackers.npcSpecs.map((_, index) => `${id}:attackers:${index}`)
  mission.officialSquad = { type: 'mission-official', missionId: id, townFaction: next.faction, squadId: 1,
    actorIds: plan.npcSpecs.filter(spec => spec.squadId === 1).map(spec => spec.actorId!), contribution: emptyPersonalContribution() }
  return next
}

export function createCaptainEagleLaunch(profile: CareerProfile): CaptainEagleLaunchConfig {
  const mission = profile.activeMission
  if (mission?.templateId !== CAPTAIN_EAGLE_BATTLE_ID || mission.kind !== 'captain-eagle-battle' || careerItemTotal(profile, 'xongkoro') < 1) throw new Error('Expected owned xongkoro and Captain Eagle mission')
  const roman = createEmptyRomanArmyConfig(), viking = createEmptyVikingArmyConfig()
  roman.roman_archer = { 1: 0, 2: 0, 3: profile.faction === 'roman' ? 29 : 30 }
  viking.viking_archer = { 1: 0, 2: 0, 3: profile.faction === 'viking' ? 29 : 30 }
  return { type: 'captain-eagle', careerMissionId: mission.id, battle: {
    careerEagleMissionId: mission.id, mode: 'formation', commandGrouping: 'squad', playerFaction: profile.faction,
    playerHeroId: resolveCareerHeroAsset(profile), playerLoadout: playerLoadout(profile, true), roman, viking,
    rules: { respawnEnabled: false, includeCamps: false },
  } }
}

/** Temporary aerial roster, using the existing Custom Battle terrain and spawn scheduler caller. */
export function createCaptainEagleSpawnPlan(profile: CareerProfile): BattleSpawnPlan {
  const launch = createCaptainEagleLaunch(profile), mission = profile.activeMission!
  const plan = BattleSpawner.createSpawnPlan(launch.battle)
  let friendly = 0, enemy = 0
  for (const spec of plan.npcSpecs) {
    const ours = spec.characterFaction === profile.faction
    const index = ours ? friendly++ : enemy++
    spec.actorId = ours ? mission.friendlyActorIds[index] : mission.targetActorIds[index]
    spec.squadId = ours ? 1 : undefined
    spec.cavalry = true
    spec.loadout = { ...spec.loadout!, mountId: 'xongkoro', shieldId: null }
    // Flight wings need actual separation at takeoff, without altering the map.
    spec.x = (index % 6 - 2.5) * 22
    spec.z = (ours === (profile.faction === 'roman') ? -1 : 1) * (110 + Math.floor(index / 6) * 22)
  }
  plan.playerSpawn = { x: 0, z: profile.faction === 'roman' ? -225 : 225 }
  return plan
}

export function acceptCaptainEagle(current: CareerProfile, id = createCareerMissionId(CAPTAIN_EAGLE_BATTLE_ID)): CareerProfile | null {
  if (!captainAvailable(current) || careerItemTotal(current, 'xongkoro') < 1 || !canUseCareerMount(current, 'xongkoro')) return null
  const next = cloneCareerProfile(current)
  next.selectedMountId = 'xongkoro'
  next.activeMission = {
    id, templateId: CAPTAIN_EAGLE_BATTLE_ID, kind: 'captain-eagle-battle', targetCampId: -1, phase: 'ASSEMBLING', acceptedAt: Date.now(),
    friendlyActorIds: Array.from({ length: 29 }, (_, index) => `${id}:eagle:friendly:${index}`),
    targetActorIds: Array.from({ length: 30 }, (_, index) => `${id}:eagle:enemy:${index}`),
    personalSquad: snapshotPersonalMission(next),
    officialSquad: { type: 'mission-official', missionId: id, townFaction: next.faction, squadId: 1,
      actorIds: Array.from({ length: 29 }, (_, index) => `${id}:eagle:friendly:${index}`), contribution: emptyPersonalContribution() },
  }
  return next
}
