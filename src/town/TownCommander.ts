import * as THREE from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import { isCareerEnemyTerritoryFieldMission } from '../career/CareerFieldSceneContext'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { ObstacleData } from '../world/Terrain'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { TOWN_CITY, townRoadIntersectsBox, type TownRoad } from './TownLayout'
import { townPatrolRefitPoint, townSitePoint, type TownActorSpec } from './TownRules'

/** Shared by roster construction and asset preload; formal battle populations stay unchanged. */
export function shouldSpawnTownCommander(profile: Pick<CareerProfile, 'faction' | 'activeMission'>): boolean {
  return profile.activeMission?.kind !== 'town-defense'
    && profile.activeMission?.kind !== 'enemy-town-assault'
    && !isCareerEnemyTerritoryFieldMission(profile.activeMission)
}

export const TOWN_COMMANDER_ID = 'commander'
export function townCommanderHeroAsset(faction: CharacterFaction): HeroAssetId {
  return faction === 'roman' ? 'roman-hero-t5' : 'viking-hero-t5'
}

/** Opt-in service resident: never added to shared enemy/defense or borrow rosters. */
export function townCommanderSpec(point: { x: number; z: number; yaw: number }): TownActorSpec {
  return { id: TOWN_COMMANDER_ID, role: 'commander', duty: 'service', mounted: false,
    training: false, assaultObjective: false, tier: 4, index: 0, ...point }
}

/** Keep a separate walkable service spot beside the Captain, using the built world's
 * obstacles and navigation. No fallback into occupied slots or the entrance lane. */
export function resolveTownCommanderPosition(obstacles: readonly ObstacleData[], roads: readonly TownRoad[],
  navigation: Pick<NavigationWorld, 'areConnected'>, roster: readonly TownActorSpec[]) {
  const approach = townSitePoint('barracks', 0, 15)
  const refitSlots = roster.filter(spec => spec.duty === 'patrol').map(townPatrolRefitPoint)
  for (const side of [-10, -14, -18]) for (const forward of [0, 2, 5, 8]) {
    const point = townSitePoint('barracks', side, forward)
    const bounds = new THREE.Box3(new THREE.Vector3(point.x - 1.5, -1000, point.z - 1.5),
      new THREE.Vector3(point.x + 1.5, 1000, point.z + 1.5))
    if (bounds.min.x < TOWN_CITY.minX || bounds.max.x > TOWN_CITY.maxX
      || bounds.min.z < TOWN_CITY.minZ || bounds.max.z > TOWN_CITY.maxZ) continue
    if (obstacles.some(obstacle => obstacle.box.intersectsBox(bounds))) continue
    if (roads.some(road => townRoadIntersectsBox(road, bounds, 1))) continue
    if (roster.some(spec => Math.hypot(spec.x - point.x, spec.z - point.z) < (spec.mounted ? 5 : 3))) continue
    if (refitSlots.some(slot => Math.hypot(slot.x - point.x, slot.z - point.z) < 5)) continue
    if (!navigation.areConnected(approach, point)) continue
    return point
  }
  throw new Error('No clear Commander service position beside the training entrance')
}
