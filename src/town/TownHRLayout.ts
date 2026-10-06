import * as THREE from 'three'
import { TOWN_CITY, TOWN_CAVALRY_FIELD, type TownRoad } from './TownLayout'
import { TOWN_SITES, type TownActorSpec } from './TownRules'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { ObstacleData } from '../world/Terrain'

export interface TownHRLayout {
  site: { x: number; z: number; yaw: number }
  width: number
  depth: number
  officer: { x: number; z: number; yaw: number }
  muster: { x: number; z: number; yaw: number }[]
}
function point(site: TownHRLayout['site'], side: number, forward: number) {
  return { x: site.x + Math.cos(site.yaw) * side + Math.sin(site.yaw) * forward,
    z: site.z - Math.sin(site.yaw) * side + Math.cos(site.yaw) * forward, yaw: site.yaw }
}
function footprint(site: TownHRLayout['site'], width: number, depth: number): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(-width / 2, -100, -depth / 2), new THREE.Vector3(width / 2, 100, depth / 2))
    .applyMatrix4(new THREE.Matrix4().makeRotationY(site.yaw)).translate(new THREE.Vector3(site.x, 0, site.z))
}
/** Search the rear of the stable using actual built obstacles and all rendered road segments.
 * The full mounted courtyard is reserved even when buying only infantry. No fallback to blocked slots.
 */
export function resolveTownHRLayout(faction: CharacterFaction, obstacles: readonly ObstacleData[], roads: readonly TownRoad[]): TownHRLayout {
  const stable = TOWN_SITES.stable
  const width = faction === 'roman' ? 16 : 13, depth = faction === 'roman' ? 13 : 22
  const cavalry = new THREE.Box3(new THREE.Vector3(TOWN_CAVALRY_FIELD.minX, -100, TOWN_CAVALRY_FIELD.minZ),
    new THREE.Vector3(TOWN_CAVALRY_FIELD.maxX, 100, TOWN_CAVALRY_FIELD.maxZ))
  const clear = (box: THREE.Box3) => {
    if (box.min.x < TOWN_CITY.minX + 5 || box.max.x > TOWN_CITY.maxX - 5
      || box.min.z < TOWN_CITY.minZ + 5 || box.max.z > TOWN_CITY.maxZ - 5 || cavalry.intersectsBox(box)) return false
    if (obstacles.some(obstacle => obstacle.box.intersectsBox(box))) return false
    return !roads.some(road => {
      const roadBox = new THREE.Box3(new THREE.Vector3(Math.min(road.ax, road.bx) - road.width / 2 - 1, -100, Math.min(road.az, road.bz) - road.width / 2 - 1),
        new THREE.Vector3(Math.max(road.ax, road.bx) + road.width / 2 + 1, 100, Math.max(road.az, road.bz) + road.width / 2 + 1))
      return box.intersectsBox(roadBox)
    })
  }
  // Rear distance is measured in the Horse Shop's local forward frame, not world-axis guesses.
  for (let rear = depth / 2 + 12; rear < TOWN_CITY.maxX - TOWN_CITY.minX; rear += 3) {
    for (let offset = 0; offset <= TOWN_CITY.maxZ - TOWN_CITY.minZ; offset += 3) for (const side of offset ? [offset, -offset] : [0]) {
      const site = point(stable, side, -rear)
      if (!clear(footprint(site, width + 4, depth + 6))) continue
      const officer = point(site, 0, depth / 2 + 4)
      if (!clear(footprint(officer, 4, 4))) continue
      for (const courtyardSide of [1, -1]) {
        const muster = Array.from({ length: 30 }, (_, i) => point(site,
          courtyardSide * (width / 2 + 5 + Math.floor(i / 5) * 4.5), (i % 5 - 2) * 4.5))
        const area = new THREE.Box3().setFromPoints(muster.map(p => new THREE.Vector3(p.x, 0, p.z))).expandByVector(new THREE.Vector3(2.2, 100, 2.2))
        if (clear(area)) return { site, width, depth, officer, muster }
      }
    }
  }
  throw new Error('No walkable HR Center and mounted courtyard behind Horse Shop')
}
export function hrOfficerSpec(layout: TownHRLayout): TownActorSpec {
  return { id: 'hr-officer', role: 'hr-officer', duty: 'service', tier: 4, mounted: true, training: false,
    settlementObjective: false, assaultObjective: false, index: 0, ...layout.officer }
}
