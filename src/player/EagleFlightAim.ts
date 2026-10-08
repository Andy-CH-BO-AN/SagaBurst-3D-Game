import { MathUtils } from 'three'
import { XONGKORO } from '../movement/XongkoroConfig'

/** Camera/input tuning is independent from flight speed, lift and collision. */
export const EAGLE_AIM = Object.freeze({
  sensitivity: .002,
  yawArc: XONGKORO.rangedYawArc,
  pitchArc: XONGKORO.rangedPitchArc,
  freeZone: .55,
  edgeTurnRate: .9,
  releaseRate: 3,
  minPitch: -Math.PI * .43,
  maxPitch: Math.PI * .36,
  followDistance: XONGKORO.cameraDistance,
  followHeight: XONGKORO.cameraHeight,
  aimDistance: 4,
  aimHeight: .8,
  followDownPitch: .22,
})

export interface EagleAimHeading { yaw: number; pitch: number }
const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from))
const edge = (offset: number, arc: number) => {
  const ratio = Math.abs(offset) / arc
  return Math.sign(offset) * MathUtils.clamp((ratio - EAGLE_AIM.freeZone) / (1 - EAGLE_AIM.freeZone), 0, 1)
}

/** One mouse sample produces both the camera ray and a bounded flight intent. */
export class EagleFlightAim {
  readonly aim: EagleAimHeading = { yaw: 0, pitch: 0 }
  readonly steering: EagleAimHeading = { yaw: 0, pitch: 0 }
  private initialized = false
  private wasAiming = false
  private recovering = false

  reset(): void { this.initialized = false; this.wasAiming = false; this.recovering = false }

  update(dx: number, dy: number, aiming: boolean, flight: EagleAimHeading, dt: number, turnInput = 0): void {
    if (!this.initialized) {
      Object.assign(this.aim, flight)
      Object.assign(this.steering, flight)
      this.initialized = true
    }
    if (aiming && !this.wasAiming) {
      // Preserve current pitch and heading; entering aim never levels the bird.
      Object.assign(this.steering, flight)
    }
    if (!aiming && this.wasAiming) this.recovering = true
    this.aim.yaw += turnInput * XONGKORO.turnRate * dt
    if (aiming) this.steering.yaw += turnInput * XONGKORO.turnRate * dt
    this.aim.yaw -= dx * EAGLE_AIM.sensitivity
    this.aim.pitch = MathUtils.clamp(this.aim.pitch - dy * EAGLE_AIM.sensitivity, EAGLE_AIM.minPitch, EAGLE_AIM.maxPitch)
    if (aiming) {
      const yawOffset = MathUtils.clamp(angleDelta(flight.yaw, this.aim.yaw), -EAGLE_AIM.yawArc, EAGLE_AIM.yawArc)
      const pitchOffset = MathUtils.clamp(this.aim.pitch - flight.pitch, -EAGLE_AIM.pitchArc, EAGLE_AIM.pitchArc)
      this.aim.yaw = flight.yaw + yawOffset
      this.aim.pitch = MathUtils.clamp(flight.pitch + pitchOffset, EAGLE_AIM.minPitch, EAGLE_AIM.maxPitch)
      this.steering.yaw += edge(yawOffset, EAGLE_AIM.yawArc) * EAGLE_AIM.edgeTurnRate * dt
      this.steering.pitch = MathUtils.clamp(this.steering.pitch + edge(pitchOffset, EAGLE_AIM.pitchArc) * EAGLE_AIM.edgeTurnRate * dt, EAGLE_AIM.minPitch, EAGLE_AIM.maxPitch)
    } else if (this.recovering) {
      const alpha = 1 - Math.exp(-EAGLE_AIM.releaseRate * dt)
      this.steering.yaw += angleDelta(this.steering.yaw, this.aim.yaw) * alpha
      this.steering.pitch += (this.aim.pitch - this.steering.pitch) * alpha
      if (Math.abs(angleDelta(this.steering.yaw, this.aim.yaw)) + Math.abs(this.aim.pitch - this.steering.pitch) < .005) this.recovering = false
    } else Object.assign(this.steering, this.aim)
    this.wasAiming = aiming
  }
}
