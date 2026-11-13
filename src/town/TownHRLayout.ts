import { expandedHrCenter, SERVICE_ANCHOR_CLEARANCE, type BuildingSpec } from './architecture/ArchitectureSpecs'
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
  officer: { x: number; y?: number; z: number; yaw: number }
  muster: { x: number; y?: number; z: number; yaw: number }[]
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
 * Callers with an existing population can reuse its resident positions.
 */
export function resolveTownHRLayout(faction: CharacterFaction, obstacles: readonly ObstacleData[], roads: readonly TownRoad[],
  residents: readonly Pick<TownActorSpec, 'x' | 'z'>[] = townRoster()): TownHRLayout {
  const width = faction === 'roman' ? 16 : 13, depth = faction === 'roman' ? 13 : 22
  const cavalry = new THREE.Box3(new THREE.Vector3(TOWN_CAVALRY_FIELD.minX, -100, TOWN_CAVALRY_FIELD.minZ),
    new THREE.Vector3(TOWN_CAVALRY_FIELD.maxX, 100, TOWN_CAVALRY_FIELD.maxZ))
  // The roster is immutable during this search. Build its envelopes once per
  // invocation, not once for every site/officer/courtyard candidate.
  const residentBoxes = residents.map(actor => new THREE.Box3(
    new THREE.Vector3(actor.x - .6, -100, actor.z - .6), new THREE.Vector3(actor.x + .6, 100, actor.z + .6)))
  const clear = (box: THREE.Box3) => {
    if (box.min.x < TOWN_CITY.minX + 5 || box.max.x > TOWN_CITY.maxX - 5
      || box.min.z < TOWN_CITY.minZ + 5 || box.max.z > TOWN_CITY.maxZ - 5 || cavalry.intersectsBox(box)) return false
    if (obstacles.some(obstacle => obstacle.box.intersectsBox(box))) return false
    if (residentBoxes.some(resident => box.intersectsBox(resident))) return false
    return !roads.some(road => townRoadIntersectsBox(road, box, 1))
  }
  const sites = [{ x: -85, z: 25, yaw: TOWN_HR_REGION.yaw }]
  for (let z = TOWN_HR_REGION.minZ; z <= TOWN_HR_REGION.maxZ; z += 3)
    for (let x = TOWN_HR_REGION.minX; x <= TOWN_HR_REGION.maxX; x += 3) sites.push({ x, z, yaw: TOWN_HR_REGION.yaw })
  for (const site of sites) {
    // Reserve the eaves plus margin, without rejecting a hall beside the overhead deck.
    if (!clear(footprint(site, width + 2.4, depth + 6))) continue
    const officer = point(site, 0, 0)
    for (const courtyardSide of [1, -1]) {
      const muster = Array.from({ length: 30 }, (_, i) => point(site,
        courtyardSide * (width / 2 + 5 + Math.floor(i / 5) * 4.5), (i % 5 - 2) * 4.5))
      const area = new THREE.Box3().setFromPoints(muster.map(p => new THREE.Vector3(p.x, 0, p.z))).expandByVector(new THREE.Vector3(2.2, 100, 2.2))
      if (!clear(area)) continue
      const layout = { site, width, depth, officer, muster }
      const { hall: plan, spec } = expandedHrCenter(faction, townHrLocalMuster(layout))
      const local = hrOfficerLocalPost(plan, spec)
      if (!local) continue
      Object.assign(officer, point(site, local.x, local.z))
      const hall = new THREE.Box3(new THREE.Vector3(plan.body.minX, -100, plan.body.minZ), new THREE.Vector3(plan.body.maxX, 100, plan.body.maxZ))
        .applyMatrix4(new THREE.Matrix4().makeRotationY(site.yaw)).translate(new THREE.Vector3(site.x, 0, site.z))
      if (clear(hall) && clear(footprint(officer, 2.5, 2.5))) return layout
    }
  }
  throw new Error('No walkable HR Center and mounted courtyard in the western district')
}
/** Mounted officer footprint and the open central approach from the main doors (local, metres). */
const HR_OFFICER_HALF = 1.25, HR_CENTRAL_APPROACH_HALF = 3

/**
 * The HR Officer serves indoors at one end of the recruitment desk, outside the
 * central approach from the doors. Prefer the end away from the muster rows;
 * step slightly toward the doors, then use the other end, when the hall wall,
 * racks or furniture leave no room for the mounted officer (the narrower Viking hall).
 */
export function hrOfficerLocalPost(plan: ReturnType<typeof expandedHrCenter>['hall'], spec: BuildingSpec): { x: number; z: number } | undefined {
  const preferred = plan.portals[1].x > 0 ? -1 : 1, centre = (plan.desk.minZ + plan.desk.maxZ) / 2
  const inner = spec.interior
  for (const side of [preferred, -preferred]) for (const z of [centre, centre + .9, centre + 1.8]) {
    const end = side > 0 ? plan.desk.maxX : plan.desk.minX
    for (const gap of [SERVICE_ANCHOR_CLEARANCE + .7, SERVICE_ANCHOR_CLEARANCE + 1.5, SERVICE_ANCHOR_CLEARANCE + 2.5]) {
      const x = end + side * gap
      if (Math.abs(x) - HR_OFFICER_HALF < HR_CENTRAL_APPROACH_HALF) continue
      const min = { x: x - HR_OFFICER_HALF, z: z - HR_OFFICER_HALF }, max = { x: x + HR_OFFICER_HALF, z: z + HR_OFFICER_HALF }
      if (inner && (min.x < inner.minX || max.x > inner.maxX || min.z < inner.minZ || max.z > inner.maxZ)) continue
      if (spec.colliders.some(c => c.role !== 'roof' && c.role !== 'overhead'
        && max.x > c.box[0] && min.x < c.box[3] && max.z > c.box[2] && min.z < c.box[5])) continue
      return { x, z }
    }
  }
  return undefined
}

export const TOWN_HR_OFFICER_ID = 'hr-officer'

export function hrOfficerSpec(layout: Pick<TownHRLayout, 'officer'>): TownActorSpec {
  return { id: TOWN_HR_OFFICER_ID, role: 'hr-officer', duty: 'service', tier: 4, mounted: true, training: false,
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

/** Preserve saved XZ positions and order when deriving the enclosed hall. */
export function townHrLocalMuster(layout: Pick<TownHRLayout, 'site' | 'muster'>): { x: number; z: number }[] {
  const { site } = layout, c = Math.cos(site.yaw), s = Math.sin(site.yaw)
  return layout.muster.map(p => ({ x: c * (p.x - site.x) - s * (p.z - site.z), z: s * (p.x - site.x) + c * (p.z - site.z) }))
}
