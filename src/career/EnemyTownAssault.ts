import type { OfficialCommandSquad } from './CareerCommandAuthority'
import { commandSquadsFromSlots } from './MissionCommandRoster'
import { newTownSiegeState, siegeRoster, type SiegeRosterVersion } from './TownSiege'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { townRoster, townAssaultObjectiveRoster } from '../town/TownRules'
import { createCareerMissionId, type ActiveCareerMission } from './CareerMissionState'
import { resolveCareerTownSceneContext } from './CareerFieldSceneContext'

export const ENEMY_TOWN_ASSAULT_ID = 'career-enemy-town-assault'
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
