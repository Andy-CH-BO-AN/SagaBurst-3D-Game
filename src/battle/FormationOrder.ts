import type { Vector3 } from 'three'
import type { TacticalOrder } from './TacticalOrder'

/** One live formation/escort/follow destination owned by an actor. */
export interface FormationTarget {
  commandId: number
  position: Vector3
  facing: Vector3
  reached: boolean
  speedLimit?: number
  arrivalOrder?: TacticalOrder
}

export interface FormationCheckpoint {
  commandId: number
  position: { x: number; y?: number; z: number; yaw: number }
  reached: boolean
  speedLimit?: number
  arrivalOrder?: TacticalOrder
}

/** Navigation reset a moved endpoint needs: only the stale A* route is dropped. */
export interface FormationPathReset { clear(): void }

/** A new order owns copies of its endpoint and a horizontal facing. */
export function createFormationTarget(commandId: number, position: Vector3, facing: Vector3,
  speedLimit?: number, arrivalOrder?: TacticalOrder, reached = false): FormationTarget {
  return {
    commandId,
    position: position.clone(),
    facing: facing.clone().setY(0).normalize(),
    reached,
    speedLimit,
    arrivalOrder,
  }
}

/**
 * Move a live slot of the same order. A different command, arrival order or an
 * order the actor no longer follows is rejected so the caller assigns a fresh
 * order instead. Local detours and friendly-bypass recovery are not touched.
 */
export function refreshFormationTarget(target: FormationTarget | null, activeOrder: TacticalOrder,
  commandId: number, position: Vector3, facing: Vector3, speedLimit: number | undefined,
  arrivalOrder: TacticalOrder | undefined, path: FormationPathReset): boolean {
  if (!target || target.commandId !== commandId || target.arrivalOrder !== arrivalOrder
    || activeOrder !== (arrivalOrder ?? 'formation')) return false
  target.position.copy(position)
  target.facing.copy(facing).setY(0).normalize()
  target.speedLimit = speedLimit
  target.reached = false
  // The endpoint changed, so validate a fresh A* route.
  path.clear()
  return true
}

export function formationCheckpoint(target: FormationTarget): FormationCheckpoint {
  return { commandId: target.commandId,
    position: { x: target.position.x, y: target.position.y, z: target.position.z, yaw: Math.atan2(target.facing.x, target.facing.z) },
    reached: target.reached, speedLimit: target.speedLimit, arrivalOrder: target.arrivalOrder }
}
