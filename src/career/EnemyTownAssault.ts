import { CAPTAIN_SIEGE_COMMAND_ID, getCaptainMissionAvailability } from './CaptainMissionCatalog'
import { emptyPersonalContribution } from '../combat/CommandMerit'
import { newTownSiegeState, siegeRoster } from './TownSiege'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { townRoster, townAssaultObjectiveRoster } from '../town/TownRules'
import { createCareerMissionId, type ActiveCareerMission } from './CareerMissionState'
import { cloneCareerProfile, canonicalCareerMountId, type CareerProfile } from './CareerProfile'
import { availableRecruitMissions } from './CareerMissionCatalog'
import { ARMORS } from '../rpg/ArmorDatabase'
import { canUseCareerEquipment } from '../town/TownEquipment'
import { canUseCareerMount, careerMountTier, ownedCareerMountIds } from './CareerMountController'
import { resolveCareerTownSceneContext } from './CareerFieldSceneContext'
import { snapshotPersonalMission } from './CareerPersonalSquadMission'

export const ENEMY_TOWN_ASSAULT_ID = 'career-enemy-town-assault'
/** Deploy owned, rank-legal shields and mounts at their highest tier. */
export function prepareEnemyTownAssaultEquipment(current: CareerProfile): CareerProfile {
  const profile = cloneCareerProfile(current)
  const shields = [...(profile.equipment?.shield ? [profile.equipment.shield] : []), ...profile.ownedArmors]
    .filter(id => ARMORS[id] && canUseCareerEquipment(profile, id))
    .sort((a, b) => ARMORS[b].tier - ARMORS[a].tier)
  if (shields[0]) {
    profile.equipment = { ...profile.equipment, shield: shields[0] }
    delete profile.equipment.ranged
  }
  const mounts = [...(profile.selectedMountId ? [profile.selectedMountId] : []), ...ownedCareerMountIds(profile)]
    .map(canonicalCareerMountId)
    .filter(id => canUseCareerMount(profile, id))
    .sort((a, b) => careerMountTier(b, profile) - careerMountTier(a, profile))
  if (mounts[0]) profile.selectedMountId = mounts[0]
  return profile
}
/** Recheck progression at the domain entry point, not just the deployment UI. */
export function acceptEnemyTownAssault(current: CareerProfile, id?: string): CareerProfile | null {
  if (current.activeOutpostMission || current.townEvent?.state === 'hostile'
    || !availableRecruitMissions(current).some(template => template.id === ENEMY_TOWN_ASSAULT_ID)) return null
  const profile = prepareEnemyTownAssaultEquipment(current)
  profile.activeMission = createEnemyTownAssaultMission(id)
  profile.activeMission.personalSquad = snapshotPersonalMission(profile)
  return profile
}
export function enemyTownFaction(faction: CharacterFaction): CharacterFaction { return faction === 'roman' ? 'viking' : 'roman' }
export function careerTownFaction(profile: { faction: CharacterFaction; activeMission?: ActiveCareerMission }): CharacterFaction {
  return resolveCareerTownSceneContext(profile).worldFaction
}
export function createEnemyTownAssaultMission(id = createCareerMissionId(ENEMY_TOWN_ASSAULT_ID)): ActiveCareerMission {
  const roster = townRoster()
  return {
    id, templateId: ENEMY_TOWN_ASSAULT_ID, kind: 'enemy-town-assault', targetCampId: -1, phase: 'PREPARING', siege: newTownSiegeState(),
    targetActorIds: townAssaultObjectiveRoster(roster).map(actor => actor.id),
    civilianActorIds: roster.filter(actor => actor.role === 'civilian').map(actor => actor.id),
    friendlyActorIds: Array.from({ length: 119 }, (_, index) => `${id}:assault:${index}`), acceptedAt: Date.now(),
  }
}
/** Player occupies a North lancer slot among 120 combatants; four officers and 115 regular NPCs. */
export function createAssaultRoster(faction: CharacterFaction): NpcSpawnSpec[] {
  return siegeRoster(faction, true).map(slot => slot.spec)
}
export function resolveAssaultOutcome(playerDead: boolean, militaryAlive: number, assaultNpcAlive: number): 'victory' | 'failure' | null {
  if (militaryAlive === 0) return 'victory'
  return playerDead && assaultNpcAlive === 0 ? 'failure' : null
}

/** Captain Siege is independent of the original Soldier Relief prerequisite. */
export function acceptCaptainSiegeCommand(current: CareerProfile, id = createCareerMissionId(CAPTAIN_SIEGE_COMMAND_ID)): CareerProfile | null {
  if (!getCaptainMissionAvailability(current, CAPTAIN_SIEGE_COMMAND_ID).unlocked) return null
  const profile = prepareEnemyTownAssaultEquipment(current)
  const active = createEnemyTownAssaultMission(id)
  active.templateId = CAPTAIN_SIEGE_COMMAND_ID
  active.officialSquad = { type: 'mission-official', missionId: id, townFaction: current.faction, squadId: 1,
    actorIds: active.friendlyActorIds.slice(0, 29), contribution: emptyPersonalContribution() }
  active.personalSquad = snapshotPersonalMission(profile)
  profile.activeMission = active
  return profile
}
