import * as THREE from 'three'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { TOWN_CAVALRY_FIELD } from './TownLayout'
import { townSitePoint, type TownActorSpec } from './TownRules'

export const DUEL_ARENA_HALF_SIZE = 17
export const DUEL_OPPONENT_OFFSET = new THREE.Vector3(0, 0, 8)
export const DUEL_REFEREE_OFFSET = new THREE.Vector3(12, 0, 0)
export const DUEL_PLAYER_OFFSET = new THREE.Vector3(0, 0, -8)

/** Both towns share training sites; search their connecting forecourt using live topology. */
export function findTownDuelArena(obstacles: readonly ObstacleData[], navigation: NavigationWorld,
  roster: readonly TownActorSpec[]): THREE.Vector3 | null {
  const infantry = roster.filter(spec => spec.duty === 'training' && !spec.mounted)
  if (!infantry.length) return null
  const field = TOWN_CAVALRY_FIELD
  const eastEdge = Math.max(...infantry.map(spec => spec.x))
  const northEdge = Math.min(...infantry.map(spec => spec.z))
  const centerX = (eastEdge + field.maxX) / 2
  const centerZ = (northEdge + field.maxZ) / 2
  const assembly = townSitePoint('barracks', 0, 15)
  for (const dz of [0, 4, 8, 12, 16, 20, 24]) for (const dx of [0, 4, -4, 8, -8]) {
    const x = centerX + dx, z = centerZ + dz
    if (x + DUEL_ARENA_HALF_SIZE > field.maxX || z - DUEL_ARENA_HALF_SIZE < field.maxZ + 2) continue
    const area = new THREE.Vector3(x, getTerrainHeight(x, z), z)
    const bounds = new THREE.Box3().setFromCenterAndSize(area.clone().setY(0), new THREE.Vector3(34, 1000, 34))
    if (obstacles.some(obstacle => obstacle.box.intersectsBox(bounds))) continue
    if (roster.some(spec => spec.duty === 'training' && bounds.clone().expandByScalar(spec.mounted ? 3 : 2)
      .containsPoint(new THREE.Vector3(spec.x, 0, spec.z)))) continue
    const slots = [new THREE.Vector3(), DUEL_OPPONENT_OFFSET, DUEL_REFEREE_OFFSET, DUEL_PLAYER_OFFSET]
      .map(offset => area.clone().add(offset))
    if (slots.every(slot => navigation.areConnected(assembly, slot))) return area
  }
  // Never silently deploy into a blocked or unrelated part of town.
  return null
}
