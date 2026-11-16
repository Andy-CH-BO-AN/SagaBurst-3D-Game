import type { TownActorSpec } from './TownRules'
import type { TownEagleTrainingGround } from './TownEagleTrainingGround'
import { TOWN_CITY, TOWN_GARRISON_EAGLE_SITES } from './TownLayout'
import { eagleLandingFootprint } from '../world/EagleLanding'

/** Initial defense alert; boarding retains this minimum before mounted bow range is available. */
export const TOWN_EAGLE_ALERT_RADIUS = 120
export const TOWN_EAGLE_GARRISON_NAME = 'Town Eagle Garrison · 城鎮空軍駐地'
export const TOWN_EAGLE_PAIRS = [1, 2, 3, 4, 5].map((slot, index) => ({
  riderId: `town-eagle-rider:${slot}`, mountId: `town-eagle-mount:${slot}`,
  homePadId: `town-eagle-pad:${slot}`, cruiseAltitude: 20 + index * 5,
}))
export interface TownEaglePad { id: string; x: number; z: number; yaw: number }
export interface TownEagleGarrisonLayout { pads: TownEaglePad[] }

/** Town-owned positions have their own authored 3+2 layout and stable identities. */
export function resolveTownEagleGarrison(training: TownEagleTrainingGround): TownEagleGarrisonLayout {
  const available = TOWN_GARRISON_EAGLE_SITES
  if (available.some(pad => training.pads.some(other => eagleLandingFootprint(pad).intersectsBox(eagleLandingFootprint(other))))) {
    throw new Error('Town Eagle Garrison overlaps private landing pads')
  }
  return { pads: available.map((point, index) => ({ ...point, id: TOWN_EAGLE_PAIRS[index].homePadId })) }
}

/** Identity/tier policy is independent of world construction; the built layout supplies positions. */
export function townEagleRoster(layout?: TownEagleGarrisonLayout): TownActorSpec[] {
  return TOWN_EAGLE_PAIRS.map((pair, index) => {
    const pad = layout?.pads.find(p => p.id === pair.homePadId)
      ?? TOWN_GARRISON_EAGLE_SITES[index]
    return { id: pair.riderId, role: 'archer_infantry', unitKind: 'archer', duty: 'eagle_garrison',
      tier: 3, mounted: false, training: false, assaultObjective: true, index,
      x: pad.x + Math.cos(pad.yaw) * 4, z: pad.z - Math.sin(pad.yaw) * 4, yaw: pad.yaw,
      eagle: { ...pair, home: { x: pad.x, z: pad.z, yaw: pad.yaw } },
    }
  })
}

/** Accepted mission lists are authoritative. Newly introduced residents do not change old goals. */
export function townMissionMilitaryIds(roster: readonly TownActorSpec[], savedIds?: readonly string[]): Set<string> {
  const allowed = savedIds ? new Set(savedIds) : undefined
  return new Set(roster.filter(spec => (spec.unitKind || spec.role === 'ranger' || spec.role === 'eagle-trainer')
    && (!allowed || allowed.has(spec.id))).map(spec => spec.id))
}

/** Assault keeps its accepted combat roster, but native Eagle support never gates victory.
 * Use authored pair identity so dismount, mount death and duty changes cannot reclassify a rider.
 * Unknown identities remain required; the runtime registration guard must resolve them first.
 */
export function townAssaultRequiredActorIds(roster: readonly Pick<TownActorSpec, 'id' | 'eagle'>[], acceptedIds: readonly string[]): Set<string> {
  const airSupport = new Set(roster.filter(spec => spec.eagle).map(spec => spec.id))
  return new Set(acceptedIds.filter(id => !airSupport.has(id)))
}

/** Distinct finite circuits, well inside the map's turning envelope. Flight AI owns avoidance. */
export const TOWN_EAGLE_PATROL_SECONDS = 180
export const TOWN_EAGLE_REST_SECONDS = 12
export const TOWN_EAGLE_REPLACEMENT_SECONDS = 60
export const TOWN_EAGLE_WAYPOINT_RADIUS = 32
export function townEaglePatrolRoute(homePadId: string): readonly { x: number; z: number }[] {
  const slot = Math.max(0, Math.min(4, Number(homePadId.split(':').at(-1)) - 1 || 0))
  const cx = (TOWN_CITY.minX + TOWN_CITY.maxX) / 2, cz = (TOWN_CITY.minZ + TOWN_CITY.maxZ) / 2
  const radius = 150 + slot * 10
  return Array.from({ length: 6 }, (_, waypoint) => {
    const angle = slot * Math.PI * 2 / 5 + waypoint * Math.PI / 3 * (slot % 2 ? -1 : 1)
    return { x: cx + Math.sin(angle) * radius, z: cz + Math.cos(angle) * radius }
  })
}
