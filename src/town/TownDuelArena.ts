import * as THREE from 'three'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { TOWN_DUEL_CENTER, TOWN_DUEL_HALF_SIZE, TOWN_CITY_ROADS, TOWN_LOCAL_ROADS, TOWN_MOUNTED_MISSION_MUSTER, TOWN_MOUNTED_MISSION_MUSTER_HALF_SIZE, townRoadIntersectsBox } from './TownLayout'
import { townStationSpec } from './TownGarrison'
import { townSitePoint, type TownActorSpec } from './TownRules'

export const DUEL_ARENA_HALF_SIZE = TOWN_DUEL_HALF_SIZE
export const DUEL_OPPONENT_OFFSET = new THREE.Vector3(0, 0, 8)
export const DUEL_REFEREE_OFFSET = new THREE.Vector3(8, 0, DUEL_ARENA_HALF_SIZE + 5)
export const DUEL_PLAYER_OFFSET = new THREE.Vector3(0, 0, -8)

/** Reserve the full mounted muster footprint and road shoulders, including diagonal roads. */
export function townDuelAreaClear(bounds: THREE.Box3): boolean {
  if ([...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS].some(road => townRoadIntersectsBox(road, bounds, 2))) return false
  const p = TOWN_MOUNTED_MISSION_MUSTER, r = TOWN_MOUNTED_MISSION_MUSTER_HALF_SIZE
  return !bounds.intersectsBox(new THREE.Box3(new THREE.Vector3(p.x - r, -100, p.z - r), new THREE.Vector3(p.x + r, 100, p.z + r)))
}

/** Reserve the training forecourt without moving, hiding or borrowing unrelated residents. */
export function findTownDuelArena(obstacles: readonly ObstacleData[], navigation: Pick<NavigationWorld, 'areConnected'>,
  roster: readonly TownActorSpec[]): THREE.Vector3 | null {
  const infantry = roster.filter(spec => spec.duty === 'training' && !spec.mounted)
  if (!infantry.length) return null
  const assembly = townSitePoint('hall', 0, 30)
  const stationed = roster.map(spec => townStationSpec(spec, spec.mounted, spec.unitKind === 'ranged' || spec.unitKind === 'archer'))
  for (const dz of [0, 4, -4]) for (const dx of [0, 4, -4]) {
    const x = TOWN_DUEL_CENTER.x + dx, z = TOWN_DUEL_CENTER.z + dz
    const area = new THREE.Vector3(x, getTerrainHeight(x, z), z)
    const bounds = new THREE.Box3().setFromCenterAndSize(area.clone().setY(0), new THREE.Vector3(DUEL_ARENA_HALF_SIZE * 2, 1000, DUEL_ARENA_HALF_SIZE * 2))
    if (!townDuelAreaClear(bounds)) continue
    if (obstacles.some(obstacle => obstacle.box.intersectsBox(bounds))) continue
    if (stationed.some(spec => bounds.clone().expandByScalar(spec.mounted ? 3 : 2)
      .containsPoint(new THREE.Vector3(spec.x, 0, spec.z)))) continue
    const slots = [new THREE.Vector3(), DUEL_OPPONENT_OFFSET, DUEL_REFEREE_OFFSET, DUEL_PLAYER_OFFSET]
      .map(offset => { const slot = area.clone().add(offset); slot.y = getTerrainHeight(slot.x, slot.z); return slot })
    if (slots.every(slot => townDuelAreaClear(new THREE.Box3().setFromCenterAndSize(slot.clone().setY(0), new THREE.Vector3(4, 1000, 4))) && navigation.areConnected(assembly, slot) && !obstacles.some(o =>
      o.box.clone().expandByScalar(2).containsPoint(slot))
      && !stationed.some(s => Math.hypot(s.x - slot.x, s.z - slot.z) < (s.mounted ? 3 : 2)))) return area
  }
  // Never silently deploy into a blocked or unrelated part of town.
  return null
}
