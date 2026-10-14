import type { BattleSpawnPlan, NpcSpawnSpec } from '../battle/BattleSpawner'
import type { PlayerLoadoutConfig } from '../battle/BattleConfig'
import { getCampaignOutpostPlacement } from '../campaign/CampaignOutpost'
import { createDefaultDefensePlayerLoadout, positionDefenseCampaignAttackers, type DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { ARMORS } from '../rpg/ArmorDatabase'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { canUseCareerEquipment } from '../town/TownEquipment'
import { careerMountAppearanceVariant, canUseCareerMount } from './CareerMountController'
import { createLastStandRoster, COMMANDER_LAST_STAND_ID } from './CommanderMissionCatalog'
import { resolveCareerReliefMount } from './CareerOutpostMission'
import { clonePersonalMission } from './CareerPersonalSquadMission'
import { resolveCareerHeroAsset } from './CareerPlayerProfile'
import type { CareerProfile } from './CareerProfile'
import type { ActiveCareerMission, VeteranOutpostBattleState } from './CareerMissionState'

export function isCareerCommanderOutpostMission(mission: ActiveCareerMission | undefined): boolean {
  return mission?.templateId === COMMANDER_LAST_STAND_ID && mission.kind === 'commander-outpost-last-stand'
}

function initialRuntimeState(): VeteranOutpostBattleState {
  return {
    phase: 'deployment', activePhase: 'deployment', assaultElapsedSeconds: 0,
    deploymentRemainingSeconds: 60, reinforcementTriggered: false,
    reinforcementSpawned: false, reinforcementArrived: false,
    reinforcementQueueIndex: 0, assaultChargeTriggered: false,
  }
}

export function createCareerCommanderOutpostLaunch(profile: CareerProfile): DefenseCampaignLaunchConfig {
  const mission = profile.activeMission
  if (!mission || !isCareerCommanderOutpostMission(mission) || profile.rank !== 'commander') {
    throw new Error('Commander Outpost Last Stand must be active')
  }
  const legal = (id: string | null | undefined, type: 'melee' | 'ranged' | 'shield') => {
    const candidates = [id, profile.starterWeaponId, ...(type === 'shield' ? profile.ownedArmors : profile.ownedWeapons)]
    return candidates.find(candidate => candidate && canUseCareerEquipment(profile, candidate)
      && (type === 'shield' ? Boolean(ARMORS[candidate]) : WEAPONS[candidate]?.type === type))
  }
  const defaults = createDefaultDefensePlayerLoadout(profile.faction)
  const mount = resolveCareerReliefMount(profile)
  const playerLoadout = {
    meleeWeaponId: legal(profile.equipment?.melee, 'melee') ?? defaults.meleeWeaponId,
    rangedWeaponId: legal(profile.equipment?.ranged, 'ranged') ?? defaults.rangedWeaponId,
    shieldId: legal(profile.equipment?.shield, 'shield') ?? defaults.shieldId,
    startMounted: Boolean(mount && canUseCareerMount(profile, mount)),
    mountId: mount === 'black-cat' || mount === 'corgi' || mount === 'xongkoro' ? mount : 'horse',
  } as PlayerLoadoutConfig
  const runtimeState = mission.outpostBattleState ?? initialRuntimeState()
  return {
    type: 'defense', defenderFaction: profile.faction, stageId: 9, defenderArmy: {}, playerLoadout,
    deploymentSeconds: 60, playerHeroId: resolveCareerHeroAsset(profile),
    playerMountAppearanceVariant: careerMountAppearanceVariant(mount), commandGrouping: 'squad',
    careerMissionId: mission.id, careerMissionKind: 'commander-outpost-last-stand',
    ...(mission.personalSquad ? { careerPersonalSquad: clonePersonalMission(mission.personalSquad) } : {}),
    capabilities: { reinforcementsEnabled: false, playerCommandsEnabled: true, gateControlEnabled: false, attackerHeroesEnabled: false },
    careerCommanderOutpost: {
      missionId: mission.id, templateId: COMMANDER_LAST_STAND_ID,
      missionKind: 'commander-outpost-last-stand', playerFaction: profile.faction,
      outpostFaction: profile.faction, runtimeState: { ...runtimeState },
    },
  }
}

function positionFriendly(specs: NpcSpawnSpec[], faction: CareerProfile['faction']): void {
  const outpost = getCampaignOutpostPlacement(faction)
  const inward = Math.sign(outpost.backZ - outpost.frontZ)
  specs.forEach((spec, index) => {
    const squad = Math.floor(index / 30)
    const slot = index % 30
    spec.x = (squad - 1.5) * 12 + (slot % 6 - 2.5) * 1.7
    spec.z = outpost.frontZ + inward * (16 + Math.floor(slot / 6) * 2.3)
  })
}

function positionEnemy(specs: NpcSpawnSpec[], faction: CareerProfile['faction']): void {
  const outpost = getCampaignOutpostPlacement(faction)
  const inward = Math.sign(outpost.backZ - outpost.frontZ)
  specs.forEach((spec, index) => {
    const lancer = index < 50
    const sword = index >= 50 && index < 75
    const local = lancer ? index : sword ? index - 50 : index - 75
    const centerX = lancer ? 0 : sword ? -34 : 34
    const columns = lancer ? 10 : 5
    spec.x = centerX + (local % columns - (columns - 1) / 2) * 3.8
    // Preserve the three formation lanes; the shared Campaign staging policy
    // translates the complete wave beyond the minimum attack distance.
    const distance = lancer ? 72 : sword ? 78 : 94
    spec.z = outpost.frontZ - inward * (distance + Math.floor(local / columns) * 4.4)
  })
  positionDefenseCampaignAttackers(specs, faction, 150)
}

export function createCareerCommanderOutpostSpawnPlan(launch: DefenseCampaignLaunchConfig,
  wave: 'initial' | 'attackers' = 'initial', mission?: ActiveCareerMission): BattleSpawnPlan {
  const data = launch.careerCommanderOutpost
  if (!data) throw new Error('Expected Commander Last Stand launch')
  const profileMission = {
    id: data.missionId, templateId: data.templateId, kind: data.missionKind,
    targetActorIds: Array.from({ length: 100 }, (_, index) => `${data.missionId}:attacker:${index}`),
    friendlyActorIds: Array.from({ length: 120 }, (_, index) => `${data.missionId}:defender:${index}`),
  } as ActiveCareerMission
  const roster = createLastStandRoster(profileMission, data.playerFaction)
  positionFriendly(roster.friendly, data.outpostFaction)
  positionEnemy(roster.enemy, data.outpostFaction)
  const outpost = getCampaignOutpostPlacement(data.outpostFaction)
  const inward = Math.sign(outpost.backZ - outpost.frontZ)
  const terminal = Boolean(mission?.result || data.runtimeState.battleFinished)
  const alive = (spec: NpcSpawnSpec) => !commanderActorConfirmedDead(mission, spec.actorId!)
  // Round-robin squads so every formation begins arriving in the first three jobs.
  const enemies = Array.from({ length: 50 }, (_, index) => [roster.enemy[index],
    ...(index < 25 ? [roster.enemy[50 + index], roster.enemy[75 + index]] : [])]).flat()
  const restoredEnemies = data.runtimeState.activePhase === 'assault'
    ? enemies.filter(spec => mission?.actorHealth?.[spec.actorId!] !== undefined
      || mission?.actorPositions?.[spec.actorId!] !== undefined) : []
  return {
    playerSpawn: { x: outpost.centerX, z: outpost.frontZ + inward * 28 },
    npcSpecs: terminal ? [] : (wave === 'attackers' ? enemies : [...roster.friendly, ...restoredEnemies]).filter(alive),
    horseSpecs: [], pickupSpecs: [],
  }
}

export function commanderActorConfirmedDead(mission: ActiveCareerMission | undefined, actorId: string): boolean {
  return Boolean(mission?.deadTargetActorIds?.includes(actorId) || mission?.deadFriendlyActorIds?.includes(actorId)
    || mission?.actorHealth?.[actorId]?.hp === 0 || mission?.officialSquad?.members?.[actorId]?.status === 'dead')
}

/** Unmaterialized stable objectives remain alive; neither queue cadence nor
 * an empty battlefield can turn them into kills. */
export function remainingCommanderAttackers(mission: ActiveCareerMission,
  actors: readonly { combatantId: string; dead: boolean }[]): number {
  const dead = new Set(actors.filter(actor => actor.dead).map(actor => actor.combatantId))
  return mission.targetActorIds.filter(id => !dead.has(id) && !commanderActorConfirmedDead(mission, id)).length
}

export function careerCommanderOutpostOwner(launch: DefenseCampaignLaunchConfig) {
  return launch.careerCommanderOutpost?.outpostFaction
}
