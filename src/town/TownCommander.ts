import { TOWN_COMMANDER_ID } from './TownCommanderIdentity'
export { TOWN_COMMANDER_ID, townCommanderSpec } from './TownCommanderIdentity'
import * as THREE from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import { officialActorSquadId } from '../career/CareerCommandAuthority'
import { isCareerEnemyTerritoryFieldMission } from '../career/CareerFieldSceneContext'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { ObstacleData } from '../world/Terrain'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { TOWN_CITY, townRoadIntersectsBox, type TownRoad } from './TownLayout'
import { townPatrolRefitPoint, townSitePoint, type TownActorSpec } from './TownRules'

/** Shared by roster construction, asset preload and Defense's actual actor consumer.
 * A current rank alone never upgrades an accepted/legacy defense population.
 */
export function shouldSpawnTownCommander(profile: Pick<CareerProfile, 'rank' | 'faction' | 'activeMission'>): boolean {
  const mission = profile.activeMission, authority = mission?.officialSquad
  if (mission?.kind === 'town-defense') return profile.rank === 'commander'
    && authority?.type === 'mission-official' && authority.commandRank === 'commander'
    && authority.missionId === mission.id && authority.townFaction === profile.faction
    && mission.friendlyActorIds.includes(TOWN_COMMANDER_ID)
    && officialActorSquadId(authority, TOWN_COMMANDER_ID) === 2
  return mission?.kind !== 'enemy-town-assault' && !isCareerEnemyTerritoryFieldMission(mission)
}

export function townCommanderHeroAsset(faction: CharacterFaction): HeroAssetId {
  return faction === 'roman' ? 'roman-hero-t5' : 'viking-hero-t5'
}


/** Keep a separate walkable service spot beside the Captain, using the built world's
 * obstacles and navigation. No fallback into occupied slots or the entrance lane. */
export function resolveTownCommanderPosition(obstacles: readonly ObstacleData[], roads: readonly TownRoad[],
  navigation: Pick<NavigationWorld, 'areConnected'>, roster: readonly TownActorSpec[]) {
  const captain = roster.find(spec => spec.id === 'captain')
  if (!captain) throw new Error('No Captain anchor for Commander service position')
  const yaw = captain.yaw ?? 0
  const captainAnchor = new THREE.Box3(new THREE.Vector3(captain.x, -1000, captain.z),
    new THREE.Vector3(captain.x, 1000, captain.z))
  // This service road already hosts the Captain. Its painted rectangle is not
  // a wall; excluding it would force the Commander across the actual fence.
  const transitRoads = roads.filter(road => !townRoadIntersectsBox(road, captainAnchor))
  const approach = townSitePoint('barracks', 0, 15)
  const refitSlots = roster.filter(spec => spec.duty === 'patrol').map(townPatrolRefitPoint)
  // Captain faces the service forecourt. Search beside that actual resident,
  // never behind it toward the training fence, even when roads reject a slot.
  // The 5m envelope reserves the mounted T5 rider and the mount, not just its
  // 1m collision radius. Lateral separation also leaves room to approach on foot.
  for (const side of [-6, -5, -7, 6, 5, 7]) for (const forward of [0, .5, 1]) {
    if (Math.hypot(side, forward) > 7) continue
    const point = { x: captain.x + Math.cos(yaw) * side + Math.sin(yaw) * forward,
      z: captain.z - Math.sin(yaw) * side + Math.cos(yaw) * forward, yaw }
    const bounds = new THREE.Box3(new THREE.Vector3(point.x - 2.5, -1000, point.z - 2.5),
      new THREE.Vector3(point.x + 2.5, 1000, point.z + 2.5))
    if (bounds.min.x < TOWN_CITY.minX || bounds.max.x > TOWN_CITY.maxX
      || bounds.min.z < TOWN_CITY.minZ || bounds.max.z > TOWN_CITY.maxZ) continue
    if (obstacles.some(obstacle => obstacle.box.intersectsBox(bounds))) continue
    if (transitRoads.some(road => townRoadIntersectsBox(road, bounds, 1))) continue
    if (roster.some(spec => Math.hypot(spec.x - point.x, spec.z - point.z) < (spec.mounted ? 5 : 4))) continue
    if (refitSlots.some(slot => Math.hypot(slot.x - point.x, slot.z - point.z) < 5)) continue
    if (!navigation.areConnected(approach, point)) continue
    return point
  }
  throw new Error('No clear Commander service position beside the training entrance')
}
