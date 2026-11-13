import { CAPTAIN_SIEGE_COMMAND_ID } from './CaptainMissionCatalog'
import type { OfficialCommandSquad } from './CareerCommandAuthority'
import { commandSquadsFromSlots } from './MissionCommandRoster'
import { newTownSiegeState, siegeRoster, type SiegeRosterVersion } from './TownSiege'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { townRoster, townAssaultObjectiveRoster } from '../town/TownRules'
import { createCareerMissionId, type ActiveCareerMission } from './CareerMissionState'
import { cloneCareerProfile, canonicalCareerMountId, type CareerProfile } from './CareerProfile'
import { ARMORS } from '../rpg/ArmorDatabase'
import { canUseCareerEquipment } from '../town/TownEquipment'
import { canUseCareerMount, careerMountTier, ownedCareerMountIds } from './CareerMountController'
import { resolveCareerTownSceneContext } from './CareerFieldSceneContext'

export const ENEMY_TOWN_ASSAULT_ID = 'career-enemy-town-assault'
/** Deploy owned, usable shields and mounts at their highest tier. */
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
/** Retired mission; new acceptance is permanently rejected. */
export function acceptEnemyTownAssault(_current: CareerProfile, _id?: string): CareerProfile | null {
  return null
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
/** Resolved saved identities, including borrowed riders, follow the actual siege slot order. */
export function siegeCommandSquads(faction: CharacterFaction, attackerIds: readonly string[], rosterVersion: SiegeRosterVersion = 2): OfficialCommandSquad[] {
  return commandSquadsFromSlots(attackerIds, siegeRoster(faction, true, rosterVersion).map(slot => slot.spec))
}
export function resolveAssaultOutcome(playerDead: boolean, militaryAlive: number, assaultNpcAlive: number): 'victory' | 'failure' | null {
  if (militaryAlive === 0) return 'victory'
  return playerDead && assaultNpcAlive === 0 ? 'failure' : null
}

/** Retired mission; new acceptance is permanently rejected. */
export function acceptCaptainSiegeCommand(_current: CareerProfile, _id = createCareerMissionId(CAPTAIN_SIEGE_COMMAND_ID)): CareerProfile | null {
  return null
}
