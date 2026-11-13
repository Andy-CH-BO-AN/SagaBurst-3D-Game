import { steerCavalryHeading } from './ContinuousCavalryCharge'

/** Narrow-doorway pace for a mounted body leaving a civic hall (m/s). Never a charge speed. */
export const CIVIC_EXIT_MAX_SPEED = 4
/** Heading error (rad) that must be closed before the body steps toward the waypoint. */
export const CIVIC_EXIT_TURN_TOLERANCE = .25

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle))

/** Formation arrival, shared by the NPC and tests. A committed civic exit still has a route, so the body
 * must clear the ramp before it may count as arrived; a new command near the doorway does not stop it early. */
export function formationArrived(distance: number, arrivalDistance: number, isDifferentLayer: boolean, civicExit: boolean | undefined): boolean {
  return distance <= arrivalDistance && !isDifferentLayer && !civicExit
}

/** Shared by NPC and tests: turn in place first, pace below charge speed without sprinting, and
 * cap the step at the waypoint so the body never overshoots the doorway line.
 * speed 0 means hold this frame while turning.
 */
export function steerCivicExitRider(yaw: number, desiredYaw: number, waypointDistance: number,
  baseSpeed: number, dt: number): { yaw: number; speed: number } {
  const pace = Math.min(baseSpeed, CIVIC_EXIT_MAX_SPEED)
  const nextYaw = steerCavalryHeading(yaw, desiredYaw, pace, dt)
  if (Math.abs(wrapAngle(desiredYaw - nextYaw)) > CIVIC_EXIT_TURN_TOLERANCE) return { yaw: nextYaw, speed: 0 }
  const stepLimit = dt > 0 ? waypointDistance / dt : 0
  return { yaw: nextYaw, speed: Math.max(0, Math.min(pace, stepLimit)) }
}
