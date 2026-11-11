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
  /** Feet height at the raised end; the floor end is at 0. */
  readonly topY: number
}

/** Feet above this height stand on a raised level rather than on the floor. */
export const ARENA_RAISED_FEET_Y = 1.2

function colosseumLinks(): ArenaStairLink[] {
  return COLOSSEUM_STAIRS.map(stair => {
    const plan = colosseumStairPlan(stair)
    const s = stair.side
    return { low: { x: stair.x, z: plan.lowZ - s * 1.2 }, high: { x: stair.x, z: plan.endZ - s * 0.6 }, halfWidth: COLOSSEUM.stairWidth / 2, topY: COLOSSEUM.podiumHeight }
  })
}

function valhallaLinks(): ArenaStairLink[] {
  return [{ low: { x: 0, z: VALHALLA.stair.lowZ - 1.2 }, high: { x: 0, z: VALHALLA.stair.landingZ - 0.4 }, halfWidth: VALHALLA.stair.halfWidth, topY: VALHALLA.dais.topY }]
}

const LINKS: Readonly<Record<DuelArenaId, readonly ArenaStairLink[]>> = {
  'roman-colosseum': colosseumLinks(),
  'viking-valhalla': valhallaLinks(),
}

export function arenaStairLinks(id: DuelArenaId): readonly ArenaStairLink[] { return LINKS[id] }

interface Feet { readonly x: number; readonly y: number; readonly z: number }

/**
 * The height navigation compares with ARENA_RAISED_FEET_Y is where a body is supported, never
 * its model height: a rider's pelvis sits above the mount's seat, so a ground mount's own
 * position (`mountGround`) stands for the pair. On foot, `body` is the pelvis-origin group.
 */
export function arenaStandingFeet(body: Feet, mountGround: Feet | null, bodyHalfHeight: number): Feet {
  return mountGround ?? { x: body.x, y: body.y - bodyHalfHeight, z: body.z }
}

/**
 * A body in the air (jump, fall) keeps the support height it last stood on, so a floor jump is
 * never read as standing on the stands and a jump from the dais is still on the dais; the level
 * updates again on landing. The horizontal position is always the live one.
 */
export class ArenaSupportTracker {
  private supportY = 0

  observe(feet: Feet, grounded: boolean): Feet {
    if (grounded) this.supportY = feet.y
    return { x: feet.x, y: this.supportY, z: feet.z }
  }
}

const distance = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z)

function onFlight(link: ArenaStairLink, point: Feet): boolean {
  const dx = link.high.x - link.low.x, dz = link.high.z - link.low.z
  const length = Math.hypot(dx, dz)
  const along = ((point.x - link.low.x) * dx + (point.z - link.low.z) * dz) / length
  const across = Math.abs((point.x - link.low.x) * -dz + (point.z - link.low.z) * dx) / length
  return along >= -0.5 && along <= length + 0.5 && across <= link.halfWidth + 0.3
}

/** On the sloped part of a flight, clear of both its floor and its landing heights. */
function midFlight(link: ArenaStairLink, point: Feet): boolean {
  return onFlight(link, point) && point.y > 0.25 && point.y < link.topY - 0.25
}

/** A chaser this close to the far end of its flight, on that end's level, has arrived. */
const ARRIVAL_RADIUS = 1.2
/** Knocked this far from the flight before stepping onto it, a chaser approaches it again. */
const RESTAGE_DISTANCE = 6

type ChaseStage = 'approach' | 'mouth' | 'flight'

function cheapestLink(id: DuelArenaId, up: boolean, chaser: Feet, target: Feet): ArenaStairLink | null {
  let best: { link: ArenaStairLink; cost: number } | null = null
  for (const link of LINKS[id]) {
    const entry = up ? link.low : link.high, exit = up ? link.high : link.low
    const cost = distance(chaser, entry) + distance(exit, target)
    if (!best || cost < best.cost) best = { link, cost }
  }
  return best?.link ?? null
}

/**
 * Stair route for one pursuer between the fighting floor and a raised level (stands, dais).
 * Once a flight is chosen the route keeps it — approach on its axis, step into its mouth,
 * climb or descend to the far end — and only hands back to ordinary pursuit after the
 * chaser reaches that end. Its own height mid-flight never ends the route; only the
 * target changing level re-plans it from where the chaser stands.
 */
export class ArenaChaseRoute {
  private route: { link: ArenaStairLink; up: boolean; stage: ChaseStage } | null = null

  constructor(private readonly id: DuelArenaId) {}

  get active(): boolean { return this.route !== null }

  reset(): void { this.route = null }

  /** Next point to walk to, or null when ordinary pursuit can reach the target. */
  next(chaser: Feet, target: Feet): { x: number; z: number } | null {
    const targetRaised = target.y > ARENA_RAISED_FEET_Y
    if (this.route && this.route.up !== targetRaised) this.route = null
    if (!this.route) {
      // Partway up a flight, its height says nothing about the level: finish it toward the target.
      const flight = LINKS[this.id].find(link => midFlight(link, chaser))
      if (flight) this.route = { link: flight, up: targetRaised, stage: 'flight' }
      else {
        const chaserRaised = chaser.y > ARENA_RAISED_FEET_Y
        if (chaserRaised === targetRaised) return null
        const link = cheapestLink(this.id, targetRaised, chaser, target)
        if (!link) return null
        this.route = { link, up: targetRaised, stage: 'approach' }
      }
    }
    const route = this.route
    const { link, up } = route
    const entry = up ? link.low : link.high, exit = up ? link.high : link.low
    const exitLevel = up ? chaser.y > ARENA_RAISED_FEET_Y : chaser.y <= ARENA_RAISED_FEET_Y
    if (exitLevel && distance(chaser, exit) < ARRIVAL_RADIUS) { this.route = null; return null }
    // Stages only advance; a body knocked well clear of the flight approaches it again.
    if (onFlight(link, chaser)) route.stage = 'flight'
    else if (route.stage !== 'approach' && distance(chaser, entry) > RESTAGE_DISTANCE) route.stage = 'approach'
    if (route.stage === 'flight') return exit
    // Approach on the flight axis, then step into its mouth, so the solid sides never catch the body.
    const axisLength = distance(entry, exit)
    const ux = (exit.x - entry.x) / axisLength, uz = (exit.z - entry.z) / axisLength
    const approach = { x: entry.x - ux * 1.5, z: entry.z - uz * 1.5 }
    if (route.stage === 'approach' && (distance(chaser, approach) < 2.2 || distance(chaser, entry) < 2.2)) route.stage = 'mouth'
    return route.stage === 'mouth' ? { x: entry.x + ux * 1.6, z: entry.z + uz * 1.6 } : approach
  }
}
