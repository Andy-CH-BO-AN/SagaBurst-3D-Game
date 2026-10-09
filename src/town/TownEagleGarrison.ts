import type { TownActorSpec } from './TownRules'
import type { TownEagleTrainingGround } from './TownEagleTrainingGround'

export const TOWN_EAGLE_GARRISON_NAME = 'Town Eagle Garrison · 城鎮空軍駐地'
export const TOWN_EAGLE_PAIRS = [1, 2, 3, 4, 5].map((slot, index) => ({
  riderId: `town-eagle-rider:${slot}`, mountId: `town-eagle-mount:${slot}`,
  homePadId: `town-eagle-pad:${slot}`, cruiseAltitude: 20 + index * 5,
}))
export interface TownEaglePad { id: string; x: number; z: number; yaw: number }
export interface TownEagleGarrisonLayout { pads: TownEaglePad[] }

/** Candidate positions are search results, never extra usable/private parking slots. */
export function resolveTownEagleGarrison(training: TownEagleTrainingGround): TownEagleGarrisonLayout {
  const available = training.candidatePads.slice(3, 8)
  if (available.length !== 5) throw new Error('Town Eagle Garrison requires five independent clear landing pads')
  return { pads: available.map((point, index) => ({ ...point, id: TOWN_EAGLE_PAIRS[index].homePadId })) }
}

/** Identity/tier policy is independent of world construction; the built layout supplies positions. */
export function townEagleRoster(layout?: TownEagleGarrisonLayout): TownActorSpec[] {
  return TOWN_EAGLE_PAIRS.map((pair, index) => {
    const pad = layout?.pads.find(p => p.id === pair.homePadId)
      ?? { x: -180, z: -100 + index * 22, yaw: 0 }
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
