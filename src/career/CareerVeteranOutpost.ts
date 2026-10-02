import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import type { PlayerLoadoutConfig } from '../battle/BattleConfig'
import { createDefaultDefensePlayerLoadout, type CareerVeteranOutpostLaunchData, type DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { getCampaignOutpostPlacement } from '../campaign/CampaignOutpost'
import { DEFENSE_CAMPAIGN_REINFORCEMENT_STAGING } from '../campaign/CampaignConfig'
import { allegianceFor, type BattleSpawnPlan, type NpcSpawnSpec } from '../battle/BattleSpawner'
import { canUseCareerEquipment } from '../town/TownEquipment'
import { canUseCareerMount, careerMountAppearanceVariant } from './CareerMountController'
import { resolveCareerHeroAsset } from './CareerPlayerProfile'
import { resolveCareerReliefMount } from './CareerOutpostMission'
import { createVeteranRoster, createVeteranSpawnSpec, type VeteranMissionRoster, type VeteranRosterUnit } from './VeteranMission'
import type { CareerProfile } from './CareerProfile'
import type { ActiveCareerMission, VeteranOutpostBattleState } from './CareerMissionState'
import type { CampaignFaction } from '../campaign/CampaignConfig'

export type CareerVeteranOutpostSpawnWave = 'initial' | 'reinforcement'

export type { CareerVeteranOutpostLaunchData } from '../campaign/DefenseCampaignLaunch'

function defaultOutpostBattleState(): VeteranOutpostBattleState {
  return {
    phase: 'assault', activePhase: 'assault', assaultElapsedSeconds: 0,
    deploymentRemainingSeconds: 0, reinforcementTriggered: false,
    reinforcementSpawned: false, reinforcementArrived: false,
    reinforcementQueueIndex: 0, assaultChargeTriggered: false,
  }
}

function isVeteranOutpostMission(mission: ActiveCareerMission | undefined): mission is ActiveCareerMission & {
  templateId: CareerVeteranOutpostLaunchData['templateId']
  kind: CareerVeteranOutpostLaunchData['missionKind']
} {
  return Boolean(mission && (
    (mission.templateId === 'veteran-dread-outpost' && mission.kind === 'veteran-outpost-defense')
    || (mission.templateId === 'veteran-outpost-assault' && mission.kind === 'veteran-outpost-assault')
  ))
}

export function isCareerVeteranOutpostMission(mission: ActiveCareerMission | undefined): mission is ActiveCareerMission & {
  templateId: CareerVeteranOutpostLaunchData['templateId']
  kind: CareerVeteranOutpostLaunchData['missionKind']
} {
  return isVeteranOutpostMission(mission)
}

/** A defeat lock keeps its spectator timeline alive even after its failure reward was claimed. */
export function shouldResumeCareerVeteranOutpost(mission: ActiveCareerMission | undefined): boolean {
  if (!isVeteranOutpostMission(mission)) return false
  return mission.outpostBattleState?.battleFinished !== true || mission.result?.claimed !== true
}

/** Build the outpost Career launch from the persisted Veteran mission. */
export function createCareerVeteranOutpostLaunch(profile: CareerProfile): DefenseCampaignLaunchConfig {
  const mission = profile.activeMission
  if (!isVeteranOutpostMission(mission)) throw new Error('A Veteran Outpost mission must be active')

  const outpostFaction = mission.templateId === 'veteran-dread-outpost'
    ? profile.faction
    : profile.faction === 'roman' ? 'viking' : 'roman'
  const requiresMount = mission.templateId === 'veteran-outpost-assault'
  const mount = resolveCareerReliefMount(profile)
  if (requiresMount && (!mount || !canUseCareerMount(profile, mount))) {
    throw new Error('Veteran Outpost Assault requires an owned legal mount')
  }

  const legal = (id: string | null | undefined, type: 'melee' | 'ranged' | 'shield') => {
    const candidates = [id, profile.starterWeaponId, ...(type === 'shield' ? profile.ownedArmors : profile.ownedWeapons)]
    return candidates.find(candidate => candidate && canUseCareerEquipment(profile, candidate)
      && (type === 'shield' ? Boolean(ARMORS[candidate]) : WEAPONS[candidate]?.type === type))
  }
  const defaultLoadout = createDefaultDefensePlayerLoadout(profile.faction)
  const playerLoadout = {
    meleeWeaponId: legal(profile.equipment?.melee, 'melee') ?? defaultLoadout.meleeWeaponId,
    rangedWeaponId: legal(profile.equipment?.ranged, 'ranged') ?? defaultLoadout.rangedWeaponId,
    shieldId: legal(profile.equipment?.shield, 'shield') ?? defaultLoadout.shieldId,
    startMounted: Boolean(mount && canUseCareerMount(profile, mount)),
    mountId: mount === 'black-cat' || mount === 'corgi' ? mount : 'horse',
  } as PlayerLoadoutConfig
  const missionKind = mission.kind
  const runtimeState = mission.outpostBattleState ?? defaultOutpostBattleState()

  return {
    type: 'defense',
    defenderFaction: outpostFaction,
    stageId: mission.templateId === 'veteran-dread-outpost' ? 1 : 4,
    defenderArmy: {},
    playerLoadout,
    deploymentSeconds: 0,
    playerHeroId: resolveCareerHeroAsset(profile),
    playerMountAppearanceVariant: careerMountAppearanceVariant(mount),
    careerMissionId: mission.id,
    careerMissionKind: missionKind,
    capabilities: {
      reinforcementsEnabled: mission.templateId === 'veteran-dread-outpost',
      playerCommandsEnabled: false,
      gateControlEnabled: false,
      attackerHeroesEnabled: false,
    },
    careerVeteranOutpost: {
      missionId: mission.id,
      templateId: mission.templateId,
      missionKind,
      playerFaction: profile.faction,
      outpostFaction,
      runtimeState: { ...runtimeState },
      reinforcementDelaySeconds: mission.templateId === 'veteran-dread-outpost' ? 90 : 0,
      assaultChargeDistanceMeters: 50,
    },
  }
}

export function getCareerVeteranOutpostRoster(launch: DefenseCampaignLaunchConfig): VeteranMissionRoster {
  const data = launch.careerVeteranOutpost
  if (!data || launch.careerMissionId !== data.missionId) throw new Error('Expected a Veteran Outpost launch')
  return createVeteranRoster(data.templateId, data.playerFaction, data.missionId)
}

function positionVeteranOutpostRoster(
  entries: Array<{ spec: NpcSpawnSpec; unit: VeteranRosterUnit }>,
  outpostFaction: CampaignFaction,
  playerFaction: CampaignFaction,
): void {
  const outpost = getCampaignOutpostPlacement(outpostFaction)
  const inward = Math.sign(outpost.backZ - outpost.frontZ)
  const offense = playerFaction !== outpostFaction
  const squadIdsByFaction = new Map<CampaignFaction, number[]>()
  const slotBySquad = new Map<string, number>()
  for (const { spec, unit } of entries) {
    const faction = spec.characterFaction
    const squadIds = squadIdsByFaction.get(faction) ?? []
    if (!squadIds.includes(unit.squadId)) squadIds.push(unit.squadId)
    squadIdsByFaction.set(faction, squadIds)
  }
  for (const { spec, unit } of entries) {
    const faction = spec.characterFaction
    const squadIds = squadIdsByFaction.get(faction) ?? [unit.squadId]
    const squadIndex = squadIds.indexOf(unit.squadId)
    const groupKey = `${faction}:${unit.squadId}`
    const localIndex = slotBySquad.get(groupKey) ?? 0
    slotBySquad.set(groupKey, localIndex + 1)
    const column = (localIndex % 5) - 2
    const row = Math.floor(localIndex / 5)
    const squadCenterX = (squadIndex - (squadIds.length - 1) / 2) * 13
    spec.x = squadCenterX + column * 2.1
    const inside = faction === outpostFaction
    if (inside) {
      spec.z = outpost.frontZ + inward * (18 + row * 2.7)
    } else {
      const outsideDistance = offense ? 65 : 24
      spec.z = outpost.frontZ - inward * (outsideDistance + row * 1.2)
    }
  }
}

function toMissionSpec(
  unit: VeteranRosterUnit,
  playerFaction: CampaignFaction,
  side: 'friendly' | 'enemy',
): NpcSpawnSpec {
  const spec = createVeteranSpawnSpec(unit, playerFaction, side)
  spec.characterFaction = side === 'friendly'
    ? playerFaction
    : playerFaction === 'roman' ? 'viking' : 'roman'
  spec.faction = allegianceFor(spec.characterFaction, playerFaction)
  spec.respawnEnabled = false
  ;(spec as NpcSpawnSpec & { actorId?: string }).actorId = unit.actorId
  return spec
}

/** Build both sides of the real Campaign Outpost battlefield using authoritative Veteran roster data. */
export function createCareerVeteranOutpostSpawnPlan(
  launch: DefenseCampaignLaunchConfig,
  wave: CareerVeteranOutpostSpawnWave,
): BattleSpawnPlan {
  const data = launch.careerVeteranOutpost
  if (!data || launch.careerMissionId !== data.missionId) throw new Error('Expected a Veteran Outpost launch')
  const roster = getCareerVeteranOutpostRoster(launch)
  const entries = wave === 'initial'
    ? [
        ...roster.friendly.map(unit => ({ unit, side: 'friendly' as const })),
        ...roster.enemy.map(unit => ({ unit, side: 'enemy' as const })),
      ]
    : roster.reinforcements.map(unit => ({ unit, side: 'friendly' as const }))
  const planned = entries.map(({ unit, side }) => ({ unit, spec: toMissionSpec(unit, data.playerFaction, side) }))

  if (wave === 'initial') {
    positionVeteranOutpostRoster(planned, data.outpostFaction, data.playerFaction)
  } else {
    const outpost = getCampaignOutpostPlacement(data.outpostFaction)
    const inward = Math.sign(outpost.backZ - outpost.frontZ)
    planned.forEach(({ spec, unit }, index) => {
      const squadIndex = Math.max(0, unit.squadId - 1)
      const slot = index % 25
      spec.x = (squadIndex === 0 ? -12 : 12) + (slot % 5 - 2) * 2.1
      const row = Math.floor(slot / 5)
      spec.z = outpost.frontZ - inward * (DEFENSE_CAMPAIGN_REINFORCEMENT_STAGING.distanceFromCenter + row * 2.7)
    })
  }

  const outpost = getCampaignOutpostPlacement(data.outpostFaction)
  const inward = Math.sign(outpost.backZ - outpost.frontZ)
  const playerSpawn = data.playerFaction === data.outpostFaction
    ? { x: 0, z: outpost.frontZ + inward * 24 }
    : { x: 0, z: outpost.frontZ - inward * 50 }
  return { playerSpawn, npcSpecs: planned.map(entry => entry.spec), horseSpecs: [], pickupSpecs: [] }
}

/** Frame-spawned Rescue Cavalry uses the campaign's established rear staging. */
export function createCareerVeteranOutpostReinforcementPlan(launch: DefenseCampaignLaunchConfig): BattleSpawnPlan {
  if (launch.careerVeteranOutpost?.templateId !== 'veteran-dread-outpost') {
    throw new Error('Only Dread Outpost launches a rescue wave')
  }
  return createCareerVeteranOutpostSpawnPlan(launch, 'reinforcement')
}

/** The owner is explicit so Career IV keeps the actual enemy fort and gate ownership. */
export function careerVeteranOutpostOwner(launch: DefenseCampaignLaunchConfig): CampaignFaction {
  return launch.careerVeteranOutpost?.outpostFaction ?? launch.defenderFaction
}

export function careerVeteranOutpostOpposingFaction(launch: DefenseCampaignLaunchConfig): CampaignFaction {
  return launch.careerVeteranOutpost?.playerFaction ?? launch.defenderFaction
}
