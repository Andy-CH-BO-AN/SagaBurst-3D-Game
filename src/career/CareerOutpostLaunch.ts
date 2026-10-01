import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import type { PlayerLoadoutConfig, UnitTierCounts } from '../battle/BattleConfig'
import { getDefenseCampaignStage, resolveCampaignRolePreset } from '../campaign/CampaignConfig'
import type { DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { canUseCareerEquipment } from '../town/TownEquipment'
import { canUseCareerMount, careerMountAppearanceVariant } from './CareerMountController'
import { resolveCareerHeroAsset } from './CareerPlayerProfile'
import type { CareerProfile } from './CareerProfile'
import { isCareerOutpostUnlocked } from './CareerOutpostMission'

/** Adapt the stage balance to an AI garrison; the player never occupies a deployment slot. */
export function createCareerOutpostLaunch(profile: CareerProfile): DefenseCampaignLaunchConfig {
  const mission = profile.activeOutpostMission
  if (!mission || !isCareerOutpostUnlocked(profile, mission.stageId)) throw new Error('Career Outpost is locked')
  const stage = getDefenseCampaignStage(mission.stageId)
  const upper = stage.defenderDeployment.upperTierPoolCap ?? stage.defenderDeployment.maxUnits
  const t3 = Math.min(stage.defenderDeployment.tierCapacity[3], upper)
  const t2 = upper - t3
  const t1 = stage.defenderDeployment.maxUnits - upper
  const ranged = { 1: Math.floor(t1 / 4), 2: Math.floor(t2 / 4), 3: Math.floor(t3 / 4) }
  // Replace one ordinary defender with the faction's T4 Captain; keep the AI total intact.
  const defenderArmy: Record<string, UnitTierCounts> = {
    [resolveCampaignRolePreset(profile.faction, 'frontline')]: { 1: t1 - ranged[1] - 1, 2: t2 - ranged[2], 3: t3 - ranged[3], 4: 1 },
    [resolveCampaignRolePreset(profile.faction, 'ranged')]: ranged,
  }
  const legal = (id: string | null | undefined, type: 'melee' | 'ranged' | 'shield') => {
    const candidates = [id, profile.starterWeaponId, ...(type === 'shield' ? profile.ownedArmors : profile.ownedWeapons)]
    return candidates.find(candidate => candidate && canUseCareerEquipment(profile, candidate)
      && (type === 'shield' ? Boolean(ARMORS[candidate]) : WEAPONS[candidate]?.type === type))
  }
  // The shared launch schema needs both slots. TownEquipment replaces this transport
  // loadout before input runs and disables any missing, unowned equipment slots.
  const mount = profile.selectedMountId
  return {
    type: 'defense', defenderFaction: profile.faction, stageId: mission.stageId,
    defenderArmy, careerMissionId: mission.id, playerHeroId: resolveCareerHeroAsset(profile),
    playerMountAppearanceVariant: careerMountAppearanceVariant(mount),
    capabilities: { reinforcementsEnabled: false, playerCommandsEnabled: false, gateControlEnabled: false, attackerHeroesEnabled: false },
    playerLoadout: {
      meleeWeaponId: legal(profile.equipment?.melee, 'melee') ?? 'gladius_rusty',
      rangedWeaponId: legal(profile.equipment?.ranged, 'ranged') ?? 'wooden_shortbow',
      shieldId: legal(profile.equipment?.shield, 'shield') ?? null,
      startMounted: Boolean(mount && canUseCareerMount(profile, mount)),
      mountId: mount === 'black-cat' || mount === 'corgi' ? mount : 'horse',
    } as PlayerLoadoutConfig,
  }
}
