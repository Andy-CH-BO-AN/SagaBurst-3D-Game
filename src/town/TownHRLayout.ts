import { townEagleRoster, type TownEagleGarrisonLayout } from './TownEagleGarrison'
import { eagleTrainerSpec, type TownEagleTrainingGround } from './TownEagleTrainingGround'
import * as THREE from 'three'
import { TOWN_CITY, TOWN_CAVALRY_FIELD, TOWN_HR_REGION, townRoadIntersectsBox, type TownRoad } from './TownLayout'
import { townRoster, type TownActorSpec } from './TownRules'
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
/** Search the authored western district using actual built obstacles and road segments.
 * The full mounted courtyard is reserved even when buying only infantry. No fallback to blocked slots.
 */
export function resolveTownHRLayout(faction: CharacterFaction, obstacles: readonly ObstacleData[], roads: readonly TownRoad[]): TownHRLayout {
  const width = faction === 'roman' ? 16 : 13, depth = faction === 'roman' ? 13 : 22
  const cavalry = new THREE.Box3(new THREE.Vector3(TOWN_CAVALRY_FIELD.minX, -100, TOWN_CAVALRY_FIELD.minZ),
    new THREE.Vector3(TOWN_CAVALRY_FIELD.maxX, 100, TOWN_CAVALRY_FIELD.maxZ))
  const residents = townRoster()
  const clear = (box: THREE.Box3) => {
    if (box.min.x < TOWN_CITY.minX + 5 || box.max.x > TOWN_CITY.maxX - 5
      || box.min.z < TOWN_CITY.minZ + 5 || box.max.z > TOWN_CITY.maxZ - 5 || cavalry.intersectsBox(box)) return false
    if (obstacles.some(obstacle => obstacle.box.intersectsBox(box))) return false
    if (residents.some(actor => box.intersectsBox(new THREE.Box3(
      new THREE.Vector3(actor.x - .6, -100, actor.z - .6), new THREE.Vector3(actor.x + .6, 100, actor.z + .6))))) return false
    return !roads.some(road => townRoadIntersectsBox(road, box, 1))
  }
  const sites = [{ x: -85, z: 25, yaw: TOWN_HR_REGION.yaw }]
  for (let z = TOWN_HR_REGION.minZ; z <= TOWN_HR_REGION.maxZ; z += 3)
    for (let x = TOWN_HR_REGION.minX; x <= TOWN_HR_REGION.maxX; x += 3) sites.push({ x, z, yaw: TOWN_HR_REGION.yaw })
  for (const site of sites) {
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
  throw new Error('No walkable HR Center and mounted courtyard in the western district')
}
export function hrOfficerSpec(layout: TownHRLayout): TownActorSpec {
  return { id: 'hr-officer', role: 'hr-officer', duty: 'service', tier: 4, mounted: true, training: false,
    assaultObjective: false, index: 0, ...layout.officer }
}

/** The actual Town population is also the free-hostility conquest roster. The cat
 * is a resident identity even though TownScene materializes it as a separate Mount.
 * HR's position comes from the built world's layout, regardless of recruitment unlocks.
 */
export function townConquestRoster(layout: TownHRLayout, residents: readonly TownActorSpec[] = townRoster(), eagleTraining?: TownEagleTrainingGround, eagleGarrison?: TownEagleGarrisonLayout): TownActorSpec[] {
  const positioned = new Map(townEagleRoster(eagleGarrison).map(spec => [spec.id, spec]))
  const roster = [...residents.map(spec => eagleGarrison && spec.eagle ? positioned.get(spec.id) ?? spec : spec), hrOfficerSpec(layout), ...(eagleTraining ? [eagleTrainerSpec(eagleTraining)] : [])]
  if (new Set(roster.map(actor => actor.id)).size !== roster.length) throw new Error('Duplicate town conquest actor ID')
  return roster
}
