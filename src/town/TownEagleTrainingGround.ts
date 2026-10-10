import * as THREE from 'three'
import type { EaglePad } from '../career/EaglePadReservations'
import type { ObstacleData } from '../world/Terrain'
import { TOWN_CITY, TOWN_PRIVATE_EAGLE_SITES, townRoadIntersectsBox, type TownRoad } from './TownLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
import type { TownActorSpec } from './TownRules'
import type { TownHRLayout } from './TownHRLayout'
import { eagleLandingFootprint, isEagleLandingClear } from '../world/EagleLanding'

export const EAGLE_TRAINING_GROUND_NAME = 'xongkoro Eagle Training Ground · 老鷹訓練場'
export interface TownEagleTrainingGround {
  site: { x: number; z: number; yaw: number }
  trainer: { x: number; z: number; yaw: number }
  pads: EaglePad[]
}

/** Private parking is authored independently of the five Town-owned spaces. */
export function resolveTownEagleTrainingGround(obstacles: readonly ObstacleData[], roads: readonly TownRoad[], hr: TownHRLayout): TownEagleTrainingGround {
  const pads = TOWN_PRIVATE_EAGLE_SITES.map((point, index) => ({ ...point, id: `private-eagle-pad:${index + 1}` }))
  const muster = new THREE.Box3().setFromPoints(hr.muster.map(p => new THREE.Vector3(p.x, 0, p.z)))
    .expandByVector(new THREE.Vector3(3, 100, 3))
  for (const pad of pads) {
    const box = eagleLandingFootprint(pad)
    if (box.min.x < TOWN_CITY.minX || box.max.x > TOWN_CITY.maxX || box.min.z < TOWN_CITY.minZ || box.max.z > TOWN_CITY.maxZ
      || box.intersectsBox(muster) || !isEagleLandingClear(pad, obstacles, pads.filter(other => other !== pad), TOWN_PLAYABLE_WORLD_BOUND)
      || roads.some(road => townRoadIntersectsBox(road, box, 2))) {
      throw new Error(`Blocked private eagle landing pad: ${pad.id}`)
    }
  }
  const site = pads[0]
  const trainer = { x: site.x, z: site.z - 20, yaw: 0 }
  return { site, trainer, pads }
}

export function eagleTrainerSpec(layout: TownEagleTrainingGround): TownActorSpec {
  return { id: 'eagle-trainer', role: 'eagle-trainer', duty: 'service', tier: 4, mounted: false,
    training: false, assaultObjective: true, index: 0, ...layout.trainer }
}
