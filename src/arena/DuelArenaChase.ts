import { COLOSSEUM, COLOSSEUM_STAIRS, colosseumStairPlan } from './ColosseumLayout'
import type { DuelArenaId } from './DuelArenaCatalog'
import { VALHALLA } from './ValhallaLayout'

/** One walkable link between the fighting floor and a raised level (stands, dais). */
export interface ArenaStairLink {
  /** Floor end, just outside the flight. */
  readonly low: { readonly x: number; readonly z: number }
  /** Raised end, on the landing. */
  readonly high: { readonly x: number; readonly z: number }
  readonly halfWidth: number
}

/** Feet above this height stand on a raised level rather than on the floor. */
export const ARENA_RAISED_FEET_Y = 1.2

function colosseumLinks(): ArenaStairLink[] {
  return COLOSSEUM_STAIRS.map(stair => {
    const plan = colosseumStairPlan(stair)
    const s = stair.side
    return { low: { x: stair.x, z: plan.lowZ - s * 1.2 }, high: { x: stair.x, z: plan.endZ - s * 0.6 }, halfWidth: COLOSSEUM.stairWidth / 2 }
  })
}

function valhallaLinks(): ArenaStairLink[] {
  return [{ low: { x: 0, z: VALHALLA.stair.lowZ - 1.2 }, high: { x: 0, z: VALHALLA.stair.landingZ - 0.4 }, halfWidth: VALHALLA.stair.halfWidth }]
}

const LINKS: Readonly<Record<DuelArenaId, readonly ArenaStairLink[]>> = {
  'roman-colosseum': colosseumLinks(),
  'viking-valhalla': valhallaLinks(),
}

export function arenaStairLinks(id: DuelArenaId): readonly ArenaStairLink[] { return LINKS[id] }

interface Feet { readonly x: number; readonly y: number; readonly z: number }

const distance = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z)

function onFlight(link: ArenaStairLink, point: Feet): boolean {
  const dx = link.high.x - link.low.x, dz = link.high.z - link.low.z
  const length = Math.hypot(dx, dz)
  const along = ((point.x - link.low.x) * dx + (point.z - link.low.z) * dz) / length
  const across = Math.abs((point.x - link.low.x) * -dz + (point.z - link.low.z) * dx) / length
  return along >= -0.5 && along <= length + 0.5 && across <= link.halfWidth + 0.3
}

/**
 * Where a chaser must walk before ordinary pursuit can reach its target. Null when both
 * stand on the same level (direct pursuit works). Otherwise the cheapest stair is used:
 * walk to its near end, then along the flight to its far end, then pursue again.
 */
export function arenaChaseWaypoint(id: DuelArenaId, chaser: Feet, target: Feet): { x: number; z: number } | null {
  const chaserRaised = chaser.y > ARENA_RAISED_FEET_Y, targetRaised = target.y > ARENA_RAISED_FEET_Y
  if (chaserRaised === targetRaised) return null
  let best: { link: ArenaStairLink; cost: number } | null = null
  for (const link of LINKS[id]) {
    const entry = chaserRaised ? link.high : link.low, exit = chaserRaised ? link.low : link.high
    const cost = distance(chaser, entry) + distance(exit, target)
    if (!best || cost < best.cost) best = { link, cost }
  }
  if (!best) return null
  const { link } = best
  const entry = chaserRaised ? link.high : link.low, exit = chaserRaised ? link.low : link.high
  if (onFlight(link, chaser)) return exit
  // Approach on the flight axis, then step into its mouth, so the solid sides never catch the body.
  const axisLength = distance(entry, exit)
  const ux = (exit.x - entry.x) / axisLength, uz = (exit.z - entry.z) / axisLength
  const approach = { x: entry.x - ux * 1.5, z: entry.z - uz * 1.5 }
  const mouth = { x: entry.x + ux * 1.6, z: entry.z + uz * 1.6 }
  return distance(chaser, approach) < 2.2 || distance(chaser, entry) < 2.2 ? mouth : approach
}
