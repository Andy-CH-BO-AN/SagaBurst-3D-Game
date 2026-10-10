import type { EagleFlightSnapshot } from '../movement/EagleFlightController'

export const EAGLE_PAD_ARRIVAL_RADIUS = 3
export const EAGLE_PAD_YAW_TOLERANCE = .3
export interface EaglePadArrivalState {
  position: { x: number; y: number; z: number }
  flight: Pick<EagleFlightSnapshot, 'phase' | 'speed' | 'yaw' | 'velocity'>
  pad: { x: number; z: number; yaw: number }
  groundHeight: number
  /** The caller checks the actual resting footprint against obstacles/occupants. */
  clear: boolean
}

/** A capture radius is not an arrival: only a stopped, aligned, clear touchdown completes return. */
export function isEaglePadArrived({ position, flight, pad, groundHeight, clear }: EaglePadArrivalState): boolean {
  const yawError = Math.abs(Math.atan2(Math.sin(flight.yaw - pad.yaw), Math.cos(flight.yaw - pad.yaw)))
  return clear && flight.phase === 'grounded'
    && Math.hypot(position.x - pad.x, position.z - pad.z) < EAGLE_PAD_ARRIVAL_RADIUS
    && Math.abs(position.y - groundHeight) <= .05
    && Math.abs(flight.speed) <= .01 && Math.hypot(flight.velocity.x, flight.velocity.y, flight.velocity.z) <= .01
    && yawError <= EAGLE_PAD_YAW_TOLERANCE
}
