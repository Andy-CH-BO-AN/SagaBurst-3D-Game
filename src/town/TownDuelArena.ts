import * as THREE from 'three'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { TOWN_DUEL_CENTER, TOWN_DUEL_HALF_SIZE } from './TownLayout'
import { townStationSpec } from './TownGarrison'
import { townSitePoint, type TownActorSpec } from './TownRules'

export const DUEL_ARENA_HALF_SIZE = TOWN_DUEL_HALF_SIZE
export const DUEL_OPPONENT_OFFSET = new THREE.Vector3(0, 0, 8)
export const DUEL_REFEREE_OFFSET = new THREE.Vector3(DUEL_ARENA_HALF_SIZE + 3, 0, 0)
export const DUEL_PLAYER_OFFSET = new THREE.Vector3(0, 0, -8)

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
    const bounds = new THREE.Box3().setFromCenterAndSize(area.clone().setY(0), new THREE.Vector3(34, 1000, 34))
    if (obstacles.some(obstacle => obstacle.box.intersectsBox(bounds))) continue
    if (stationed.some(spec => bounds.clone().expandByScalar(spec.mounted ? 3 : 2)
      .containsPoint(new THREE.Vector3(spec.x, 0, spec.z)))) continue
    const slots = [new THREE.Vector3(), DUEL_OPPONENT_OFFSET, DUEL_REFEREE_OFFSET, DUEL_PLAYER_OFFSET]
      .map(offset => area.clone().add(offset))
    if (slots.every(slot => navigation.areConnected(assembly, slot) && !obstacles.some(o =>
      o.box.clone().expandByScalar(2).containsPoint(slot))
      && !stationed.some(s => Math.hypot(s.x - slot.x, s.z - slot.z) < (s.mounted ? 3 : 2)))) return area
  }
  // Never silently deploy into a blocked or unrelated part of town.
  return null
}
