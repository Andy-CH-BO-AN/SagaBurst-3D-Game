import * as THREE from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { AIType, Faction } from '../world/NPC'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { resolveUnitLoadout, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { isEagleLandingClear, type EagleLandingPoint } from '../world/EagleLanding'
import { isEagleApproachClear } from '../world/EagleApproach'
import type { ObstacleData } from '../world/Terrain'
import { TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
import { TOWN_GARRISON_EAGLE_SITES, TOWN_PRIVATE_EAGLE_SITES } from './TownLayout'
export const ENEMY_EAGLE_SLOTS = [1, 2, 3] as const
export const ENEMY_EAGLE_RESPAWN_SECONDS = 60
export const ENEMY_EAGLE_SENSOR_SECONDS = 0.35
export function enemyEaglePatrolEnabled(profile: Pick<CareerProfile, 'rank'>): boolean {
  return profile.rank === 'captain' || profile.rank === 'commander'
}
export function enemyEagleActorId(slot: number, generation: number, kind: 'rider' | 'mount'): string {
  return `enemy-eagle-patrol:${slot}:generation:${generation}:${kind}`
}
export function enemyEagleSpawnSpec(
  slot: number,
  generation: number,
  townFaction: CharacterFaction,
  playerFaction: CharacterFaction,
  home: EagleLandingPoint,
): NpcSpawnSpec {
  const characterFaction = townFaction === 'roman' ? 'viking' : 'roman'
  const presetId: UnitPresetId = `${characterFaction}_archer`
  return {
    actorId: enemyEagleActorId(slot, generation, 'rider'),
    x: home.x,
    z: home.z,
    faction: characterFaction === playerFaction ? Faction.TOWN : Faction.ENEMY,
    characterFaction,
    aiType: AIType.RANGED,
    name: 'Eagle Patrol Archer',
    tier: 3,
    cavalry: false,
    respawnEnabled: false,
    presetId,
    loadout: { ...resolveUnitLoadout(presetId, 3), mountId: 'xongkoro', shieldId: null },
  }
}
/** Distinct perimeter sectors, with an inward leg in the town's air-defense radius. */
export function enemyEagleRoute(slot: number): THREE.Vector3[] {
  const routes = [
    [
      [-205, -195],
      [-150, -140],
      [-100, -210],
      [-200, -250],
    ],
    [
      [220, -170],
      [185, -80],
      [245, 20],
      [280, -100],
    ],
    [
      [190, 185],
      [110, 145],
      [-10, 205],
      [140, 255],
    ],
  ]
  return routes[slot - 1].map(([x, z]) => new THREE.Vector3(x, 0, z))
}
/** Search only external ground; both reciprocal takeoff and actual landing corridors must be clear.
 * Failure is explicit rather than deploying into an obstacle or silently moving to a Town pad. */
export function resolveEnemyEagleHomes(obstacles: readonly ObstacleData[]): Array<{
  x: number
  z: number
  yaw: number
}> {
  const protectedPads = [...TOWN_GARRISON_EAGLE_SITES, ...TOWN_PRIVATE_EAGLE_SITES]
  const homes: Array<{
    x: number
    z: number
    yaw: number
  }> = []
  const centers = [
    { x: -180, z: -265 },
    { x: 255, z: -110 },
    { x: 170, z: 245 },
  ]
  for (const center of centers) {
    let found:
      | {
          x: number
          z: number
          yaw: number
        }
      | undefined
    search: for (let radius = 0; radius <= 65; radius += 5)
      for (let step = 0; step < (radius ? 16 : 1); step++) {
        const x = center.x + Math.sin((step * Math.PI) / 8) * radius,
          z = center.z + Math.cos((step * Math.PI) / 8) * radius
        if (Math.hypot(x, z) < 195) continue
        for (let heading = 0; heading < 8; heading++) {
          const point = { x, z, yaw: (heading * Math.PI) / 4 },
            occupied = [...protectedPads, ...homes]
          if (
            isEagleLandingClear(point, obstacles, occupied, TOWN_PLAYABLE_WORLD_BOUND) &&
            isEagleApproachClear(point, obstacles, occupied, TOWN_PLAYABLE_WORLD_BOUND, 35) &&
            isEagleApproachClear(
              { ...point, yaw: point.yaw + Math.PI },
              obstacles,
              occupied,
              TOWN_PLAYABLE_WORLD_BOUND,
              35,
            )
          ) {
            found = point
            break search
          }
        }
      }
    if (!found) throw new Error('No safe external eagle deployment and approach corridor')
    homes.push(found)
  }
  return homes
}
