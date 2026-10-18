import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import type { PlayerLoadoutConfig } from '../battle/BattleConfig'
import type { DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { canUseCareerEquipment } from '../town/TownEquipment'
import { canUseCareerMount, careerMountAppearanceVariant } from './CareerMountController'
import { resolveCareerHeroAsset } from './CareerPlayerProfile'
import type { CareerProfile } from './CareerProfile'
import { isCareerOutpostUnlocked, isCareerOutpostReliefUnlocked, resolveCareerReliefMount } from './CareerOutpostMission'
import { clonePersonalMission } from './CareerPersonalSquadMission'
import { createCareerOutpostDefenderArmy } from './CareerOutpostRoster'

/** Build a trusted Career launch; relief counts Player inside its separate rescue roster. */
export function createCareerOutpostLaunch(profile: CareerProfile): DefenseCampaignLaunchConfig {
  const mission = profile.activeOutpostMission
  if (!mission || !isCareerOutpostUnlocked(profile, mission.stageId)) throw new Error('Career Outpost is locked')
  const relief = mission.kind === 'outpost-relief'
  if (relief && (!isCareerOutpostReliefUnlocked(profile) || !resolveCareerReliefMount(profile))) throw new Error('Career relief requires completed Outposts and an owned legal mount')
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
    defenderArmy: createCareerOutpostDefenderArmy(profile.faction, mission), careerMissionKind: mission.kind, careerMissionId: mission.id, playerHeroId: resolveCareerHeroAsset(profile),
    ...(relief ? { careerReliefPhase: mission.reliefPhase ?? 'march' } : {}),
    ...(mission.personalSquad ? { careerPersonalSquad: clonePersonalMission(mission.personalSquad) } : {}),
    playerMountAppearanceVariant: careerMountAppearanceVariant(profile),
    capabilities: { reinforcementsEnabled: !relief, playerCommandsEnabled: mission.officialSquad?.commandRank === 'commander'
      && mission.officialSquad.missionId === mission.id && mission.officialSquad.townFaction === profile.faction && profile.rank === 'commander', gateControlEnabled: false, attackerHeroesEnabled: false },
    playerLoadout: {
      meleeWeaponId: legal(profile.equipment?.melee, 'melee') ?? 'gladius_rusty',
      rangedWeaponId: legal(profile.equipment?.ranged, 'ranged') ?? 'wooden_shortbow',
      shieldId: legal(profile.equipment?.shield, 'shield') ?? null,
      startMounted: Boolean(mount && canUseCareerMount(profile, mount)),
      mountId: mount === 'black-cat' || mount === 'corgi' || mount === 'xongkoro' ? mount : 'horse',
    } as PlayerLoadoutConfig,
  }
}
