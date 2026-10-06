import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import type { PlayerLoadoutConfig, UnitTierCounts } from '../battle/BattleConfig'
import { getDefenseCampaignStage, resolveCampaignRolePreset } from '../campaign/CampaignConfig'
import type { DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { canUseCareerEquipment } from '../town/TownEquipment'
import { canUseCareerMount, careerMountAppearanceVariant } from './CareerMountController'
import { resolveCareerHeroAsset } from './CareerPlayerProfile'
import type { CareerProfile } from './CareerProfile'
import { isCareerOutpostUnlocked, isCareerOutpostReliefUnlocked, resolveCareerReliefMount } from './CareerOutpostMission'
import { clonePersonalMission } from './CareerPersonalSquadMission'

/** Build a trusted Career launch; relief counts Player inside its separate rescue roster. */
export function createCareerOutpostLaunch(profile: CareerProfile): DefenseCampaignLaunchConfig {
  const mission = profile.activeOutpostMission
  if (!mission || !isCareerOutpostUnlocked(profile, mission.stageId)) throw new Error('Career Outpost is locked')
  const relief = mission.kind === 'outpost-relief'
  if (relief && (!isCareerOutpostReliefUnlocked(profile) || !resolveCareerReliefMount(profile))) throw new Error('Career relief requires completed Outposts and an owned legal mount')
  const stage = getDefenseCampaignStage(mission.stageId)
  const upper = stage.defenderDeployment.upperTierPoolCap ?? stage.defenderDeployment.maxUnits
  const t3 = Math.min(stage.defenderDeployment.tierCapacity[3], upper)
  const t2 = upper - t3
  const t1 = stage.defenderDeployment.maxUnits - upper
  const cavalry = stage.defenderDeployment.cavalryCap ?? t3
  const infantryT3 = Math.max(0, t3 - cavalry)
  const cavalryT2 = Math.max(0, cavalry - t3)
  const infantryT2 = t2 - cavalryT2
  // The Captain occupies one melee slot; every T1 is a bow archer and cavalry
  // uses the strongest available tiers before splitting the remaining infantry.
  const defenderArmy: Record<string, UnitTierCounts> = {
    [resolveCampaignRolePreset(profile.faction, 'frontline')]: { 1: 0, 2: Math.floor(infantryT2 / 2) - 1, 3: Math.floor(infantryT3 / 2), 4: 1 },
    [`${profile.faction}_spearman`]: { 1: 0, 2: Math.ceil(infantryT2 / 2), 3: Math.ceil(infantryT3 / 2) },
    [`${profile.faction}_archer`]: { 1: t1, 2: 0, 3: 0 },
    [resolveCampaignRolePreset(profile.faction, 'lancer')]: { 1: 0, 2: cavalryT2, 3: Math.min(cavalry, t3) },
  }
  const legal = (id: string | null | undefined, type: 'melee' | 'ranged' | 'shield') => {
    const candidates = [id, profile.starterWeaponId, ...(type === 'shield' ? profile.ownedArmors : profile.ownedWeapons)]
    return candidates.find(candidate => candidate && canUseCareerEquipment(profile, candidate)
      && (type === 'shield' ? Boolean(ARMORS[candidate]) : WEAPONS[candidate]?.type === type))
  }
  // The shared launch schema needs both slots. TownEquipment replaces this transport
  // loadout before input runs and disables any missing, unowned equipment slots.
  const mount = relief ? resolveCareerReliefMount(profile) : profile.selectedMountId
  return {
    type: 'defense', defenderFaction: profile.faction, stageId: mission.stageId,
    deploymentSeconds: profile.rank === 'captain' || profile.rank === 'commander' ? 60 : 10,
    defenderArmy: relief ? {
      [resolveCampaignRolePreset(profile.faction, 'frontline')]: { 1: 0, 2: 16, 3: 0 },
      [resolveCampaignRolePreset(profile.faction, 'ranged')]: { 1: 0, 2: 4, 3: 0 },
    } : defenderArmy, careerMissionKind: mission.kind, careerMissionId: mission.id, playerHeroId: resolveCareerHeroAsset(profile),
    ...(relief ? { careerReliefPhase: mission.reliefPhase ?? 'march' } : {}),
    ...(mission.personalSquad ? { careerPersonalSquad: clonePersonalMission(mission.personalSquad) } : {}),
    playerMountAppearanceVariant: careerMountAppearanceVariant(mount),
    capabilities: { reinforcementsEnabled: !relief, playerCommandsEnabled: false, gateControlEnabled: false, attackerHeroesEnabled: false },
    playerLoadout: {
      meleeWeaponId: legal(profile.equipment?.melee, 'melee') ?? 'gladius_rusty',
      rangedWeaponId: legal(profile.equipment?.ranged, 'ranged') ?? 'wooden_shortbow',
      shieldId: legal(profile.equipment?.shield, 'shield') ?? null,
      startMounted: Boolean(mount && canUseCareerMount(profile, mount)),
      mountId: mount === 'black-cat' || mount === 'corgi' ? mount : 'horse',
    } as PlayerLoadoutConfig,
  }
}
