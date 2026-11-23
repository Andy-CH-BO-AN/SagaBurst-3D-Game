import type { Vector3 } from 'three'

export const DETECTION_RADIUS = 300.0

export type PursuitOrder = string

/** The lazily evaluated parts of an actor's engagement policy. */
export interface EngagementActor {
  readonly tacticalOrder: PursuitOrder
  readonly combatPosition: Vector3
  readonly holdsRampartPosition: boolean
  readonly alertRange: number
}

/**
 * Whether a target is close enough to engage or keep chasing. A formal-battle
 * Attack actor measures against the whole horizontal map diagonal
 * (`battlefieldRangeSq`), unless an encounter or an eagle mount confines it
 * (`confined`) or it holds a rampart position. Charge is never range-limited.
 */
export function isWithinEngagementRange(
  actor: EngagementActor, battlefieldRangeSq: number | null, confined: boolean, position: Vector3, chasing: boolean,
): boolean {
  if (actor.tacticalOrder === 'charge') return true
  const from = actor.combatPosition
  if (actor.tacticalOrder === 'attack' && battlefieldRangeSq !== null && !confined && !actor.holdsRampartPosition) {
    const dx = position.x - from.x, dz = position.z - from.z
    return dx * dx + dz * dz <= battlefieldRangeSq
  }
  const range = actor.tacticalOrder === 'follow' ? (chasing ? 36 : 24)
    : chasing ? DETECTION_RADIUS * 1.5 : actor.alertRange
  return from.distanceToSquared(position) <= range * range
}

export interface PursuitGateActor {
  readonly missionMovement: boolean
  readonly holdsRampartPosition: boolean
  readonly hasSiegeObstacle: boolean
  readonly tacticalOrder: PursuitOrder
}

/** Only free Attack/Charge pursuit may route to, and breach, a closed gate;
 * mission travel, encounters, rampart duty and an active siege task keep their owners. */
export function pursuitMayBreachGate(actor: PursuitGateActor, hasEncounterOrigin: boolean): boolean {
  return !actor.missionMovement && !hasEncounterOrigin && !actor.holdsRampartPosition
    && !actor.hasSiegeObstacle && (actor.tacticalOrder === 'attack' || actor.tacticalOrder === 'charge')
}

export interface LayeredPursuitTargetContext {
  readonly selfPosition: Vector3
  readonly nextPosition: Vector3
  readonly selfOnRamp: boolean
  readonly selfElevated: boolean
  readonly previousElevated: boolean
  readonly nextElevated: boolean
  readonly directEngageRangeSq: number
}

/** Avoid oscillating up and down ramps when switching between distant vertical layers. */
export function shouldRetainLayeredPursuitTarget(context: LayeredPursuitTargetContext): boolean {
  if (context.selfPosition.distanceToSquared(context.nextPosition) <= context.directEngageRangeSq) {
    return false
  }
  if (context.selfOnRamp) {
    return context.previousElevated !== context.nextElevated
  }
  return context.previousElevated === context.selfElevated
    && context.nextElevated !== context.selfElevated
}
