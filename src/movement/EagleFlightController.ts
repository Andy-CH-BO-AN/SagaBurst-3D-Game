import * as THREE from 'three'
import { getTerrainHeight, resolveObstacleCollision, type ObstacleData } from '../world/Terrain'
import { XONGKORO } from './XongkoroConfig'
import { isEagleLandingClear, type EagleLandingPoint } from '../world/EagleLanding'
import { EAGLE_PAD_YAW_TOLERANCE } from '../world/EaglePadArrival'
import { isEagleColumnClear } from '../world/EagleAirspace'

export type EagleFlightPhase = 'grounded' | 'takeoff' | 'cruise' | 'landing'
export interface EagleFlightIntent { yaw: number; pitch: number; bankInput?: number; sprint?: boolean; brake?: boolean; takeoff?: boolean; landingTarget?: { x: number; z: number; yaw: number }
  /** Opt-in vertical take-off and pad landing. Cruise remains fixed-wing: no sustained hover. */
  vertical?: boolean
  /** Height above ground at which a vertical take-off flies forward and a landing may turn; defaults to the pad clearance. */
  climbHeight?: number }
export interface EagleFlightSnapshot {
  phase: EagleFlightPhase; yaw: number; pitch: number; bank: number; speed: number
  velocity: { x: number; y: number; z: number }
}
export function parseEagleFlightSnapshot(value: unknown): EagleFlightSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const state = value as Partial<EagleFlightSnapshot>
  if (!state.phase || !['grounded', 'takeoff', 'cruise', 'landing'].includes(state.phase) || !state.velocity
    || ![state.yaw, state.pitch, state.bank, state.speed, state.velocity.x, state.velocity.y, state.velocity.z].every(v => typeof v === 'number' && Number.isFinite(v))) return undefined
  return { phase: state.phase, yaw: state.yaw!, pitch: state.pitch!, bank: state.bank!, speed: state.speed!,
    velocity: { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z } }
}
const approach = (value: number, target: number, step: number): number => value + THREE.MathUtils.clamp(target - value, -step, step)
const angleDelta = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b))

/**
 * Fixed-wing movement shared by human steering and AI intent; no actor speed modifiers.
 * `intent.vertical` only replaces the ground roll and the final pad glide with a
 * flapping lift/settle; it reuses the existing takeoff/landing phases and snapshots.
 */
export class EagleFlightController {
  phase: EagleFlightPhase = 'grounded'
  yaw = 0
  pitch = 0
  bank = 0
  speed = 0
  readonly velocity = new THREE.Vector3()
  readonly intent: EagleFlightIntent = { yaw: 0, pitch: 0 }
  private readonly previous = new THREE.Vector3()
  private readonly ahead = new THREE.Vector3()
  private readonly sample = new THREE.Vector3()
  private readonly oldSample = new THREE.Vector3()
  private readonly correction = new THREE.Vector3()
  private readonly oldAhead = new THREE.Vector3()
  private readonly oldSide = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly landingPoint = { x: 0, z: 0, yaw: 0 }
  /** Transient vertical take-off state; a restored snapshot simply starts a fresh climb. */
  private retreating = false
  private blocked = false
  private climbStall = 0
  private climbFrom = -Infinity
  private takeoffCooldown = 0
  private readonly trafficView = { position: this.previous, velocity: this.velocity }

  /** Live view of this eagle for other pilots' airspace checks; no per-frame allocation. */
  traffic(position: THREE.Vector3): { position: THREE.Vector3; velocity: THREE.Vector3 } {
    this.trafficView.position = position
    return this.trafficView
  }

  setIntent(intent: EagleFlightIntent): void { Object.assign(this.intent, { bankInput: 0, sprint: false, brake: false, takeoff: false, landingTarget: undefined, vertical: false, climbHeight: undefined }, intent) }
  snapshot(): EagleFlightSnapshot {
    return { phase: this.phase, yaw: this.yaw, pitch: this.pitch, bank: this.bank, speed: this.speed,
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z } }
  }
  restore(value: EagleFlightSnapshot): void {
    if (!['grounded', 'takeoff', 'cruise', 'landing'].includes(value.phase)
      || ![value.yaw, value.pitch, value.bank, value.speed, value.velocity.x, value.velocity.y, value.velocity.z].every(Number.isFinite)) return
    this.phase = value.phase; this.yaw = value.yaw
    this.pitch = THREE.MathUtils.clamp(value.pitch, -XONGKORO.maxPitch, XONGKORO.maxPitch)
    this.bank = THREE.MathUtils.clamp(value.bank, -XONGKORO.maxBank, XONGKORO.maxBank)
    this.speed = THREE.MathUtils.clamp(value.speed, 0, XONGKORO.sprintSpeed)
    this.velocity.set(value.velocity.x, value.velocity.y, value.velocity.z).clampLength(0, XONGKORO.sprintSpeed)
    this.setIntent({ yaw: this.yaw, pitch: this.pitch })
  }

  canLand(position: THREE.Vector3, obstacles: ObstacleData[],
    terrainHeight: (x: number, z: number) => number = getTerrainHeight, bound = 300): boolean {
    this.landingPoint.x = position.x; this.landingPoint.z = position.z; this.landingPoint.yaw = this.yaw
    return isEagleLandingClear(this.landingPoint, obstacles, [], bound, terrainHeight)
  }

  update(position: THREE.Vector3, rotation: THREE.Euler, dt: number, obstacles: ObstacleData[], bound: number,
    terrainHeight: (x: number, z: number) => number = getTerrainHeight): void {
    if (dt <= 0) return
    if (this.phase === 'grounded') {
      this.yaw = rotation.y
      this.velocity.set(0, 0, 0)
      this.speed = 0
      this.retreating = this.blocked = false; this.climbStall = 0; this.climbFrom = -Infinity
      this.takeoffCooldown = Math.max(0, this.takeoffCooldown - dt)
      if (!this.intent.takeoff || !this.canLand(position, obstacles, terrainHeight, bound)) return
      // A vertical lift needs its whole climb, body and wings, before leaving the ground.
      if (this.intent.vertical && (this.takeoffCooldown > 0 || !this.climbClear(position, obstacles, terrainHeight))) return
      this.phase = 'takeoff'
      this.speed = this.intent.vertical ? 0 : XONGKORO.minimumSpeed
      this.pitch = this.intent.vertical ? 0 : Math.max(XONGKORO.takeoffPitch, this.intent.pitch)
    }
    const steps = Math.max(1, Math.ceil(dt * XONGKORO.sprintSpeed / XONGKORO.collisionStep))
    const step = dt / steps
    for (let i = 0; i < steps; i++) {
      if (this.intent.vertical && this.verticalStep(position, step, obstacles, bound, terrainHeight)) {
        if ((this.phase as EagleFlightPhase) === 'grounded') break
        this.contain(position, obstacles, bound, terrainHeight(position.x, position.z), terrainHeight)
        continue
      }
      let desiredYaw = this.intent.yaw
      let desiredPitch = THREE.MathUtils.clamp(this.intent.pitch, -XONGKORO.maxPitch, XONGKORO.maxPitch)
      if (this.phase === 'landing') {
        desiredPitch = 0
        const target = this.intent.landingTarget
        if (target) desiredYaw = target.yaw + Math.atan2(
          (target.x - position.x) * Math.cos(target.yaw) - (target.z - position.z) * Math.sin(target.yaw), 12)
      }
      const edge = bound - XONGKORO.boundaryMargin
      const assignedLanding = this.intent.landingTarget
      const approachInsideBounds = assignedLanding && Math.abs(assignedLanding.x) <= bound - XONGKORO.wingClearance
        && Math.abs(assignedLanding.z) <= bound - XONGKORO.wingClearance
      if (!approachInsideBounds && (Math.abs(position.x) > edge || Math.abs(position.z) > edge)) desiredYaw = Math.atan2(-position.x, -position.z)
      const ground = terrainHeight(position.x, position.z)
      if (position.y > ground + XONGKORO.maxAltitude - 5) desiredPitch = Math.min(desiredPitch, -.2)
      if (this.phase === 'takeoff') {
        desiredPitch = Math.max(desiredPitch, XONGKORO.takeoffPitch)
        if (position.y - ground > 4) this.phase = 'cruise'
      }
      this.oldAhead.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
      this.oldSide.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
      const turn = THREE.MathUtils.clamp(angleDelta(desiredYaw, this.yaw), -XONGKORO.turnRate * step, XONGKORO.turnRate * step)
      this.yaw += turn
      this.pitch = approach(this.pitch, desiredPitch, XONGKORO.pitchRate * step)
      this.bank = approach(this.bank, THREE.MathUtils.clamp(-turn / step * .65, -XONGKORO.maxBank, XONGKORO.maxBank), XONGKORO.bankResponse * step)
      const landingTarget = this.intent.landingTarget
      const targetDistance = landingTarget ? Math.hypot(landingTarget.x - position.x, landingTarget.z - position.z) : Infinity
      // Only an assigned final approach may fly below the ordinary minimum speed.
      // Slow continuously towards a point just short of the centre, leaving
      // enough time to settle vertically without travelling through the pad.
      const targetSpeed = landingTarget && this.intent.brake
        ? Math.min(XONGKORO.minimumSpeed, this.phase === 'landing'
          ? Math.max(0, targetDistance - 1.1) * 1.5 : Math.max(.6, targetDistance * 1.5))
        : this.intent.brake ? XONGKORO.minimumSpeed : this.intent.sprint ? XONGKORO.sprintSpeed : XONGKORO.cruiseSpeed
      this.speed = approach(this.speed, targetSpeed, XONGKORO.acceleration * step)
      this.velocity.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.speed)
      this.previous.copy(position)
      position.addScaledVector(this.velocity, step)
      const surface = terrainHeight(position.x, position.z)
      const assignedFinal = !!landingTarget && this.intent.brake
      // Begin the pad flare before a steep nose-down torso contacts terrain.
      // This remains a continuous descent; ground contact still gates touchdown.
      const captureHeight = assignedFinal ? Math.max(XONGKORO.landingHeight,
        XONGKORO.bodyHalfLength * Math.sin(Math.abs(this.pitch)) + .3) : XONGKORO.landingHeight
      const landing = (this.phase === 'landing' && (!landingTarget || assignedFinal)
        || this.intent.brake && this.speed <= XONGKORO.landingSpeed && this.pitch <= .2)
        && position.y - surface <= captureHeight && this.canLand(position, obstacles, terrainHeight, bound)
        && (!landingTarget || assignedFinal && targetDistance < 5.5
          && Math.abs(angleDelta(landingTarget.yaw, this.yaw)) <= EAGLE_PAD_YAW_TOLERANCE)
      if (this.phase === 'landing' && !landing) this.phase = 'cruise'
      if (landing) {
        this.phase = 'landing'
        // An assigned pad controls the final glide: reach it by displacement,
        // rather than touching down several metres early or snapping X/Z.
        position.y = approach(position.y, surface, 3 * step)
        const parked = !landingTarget || targetDistance < 2 && this.speed <= 1.5
        if (position.y <= surface + .05 && parked) {
          position.y = surface; this.phase = 'grounded'; this.speed = 0; this.pitch = 0; this.bank = 0
          this.velocity.set(0, 0, 0)
          break
        }
      }
      this.contain(position, obstacles, bound, surface, terrainHeight)
    }
    rotation.set(-this.pitch, this.yaw, this.bank, 'YXZ')
  }

  /**
   * One vertical take-off or pad-landing step. Returns false whenever ordinary
   * fixed-wing flight must handle the step (cruise, a refused capture, or an abort).
   */
  private verticalStep(position: THREE.Vector3, step: number, obstacles: ObstacleData[], bound: number,
    terrainHeight: (x: number, z: number) => number): boolean {
    const surface = terrainHeight(position.x, position.z)
    const target = this.intent.landingTarget
    if (this.phase === 'takeoff') {
      const agl = position.y - surface
      // Lift on the spot; forward speed is only gained once the climb is behind.
      if (!this.retreating && agl >= this.climbHeight()) { this.phase = 'cruise'; return false }
      // A withdrawn take-off (traffic overhead) or a climb that stops gaining height
      // settles back onto the same spot instead of pressing against the blockage.
      const expected = XONGKORO.verticalClimbRate * step
      this.climbStall = !this.retreating && position.y - this.climbFrom < expected * .25 ? this.climbStall + step : 0
      // A stalled climb always goes back down; a withdrawn one resumes as soon as it may.
      if (this.climbStall > .5) this.retreating = this.blocked = true
      else if (!this.blocked) this.retreating = !this.intent.takeoff
      this.beginStep(position)
      this.speed = approach(this.speed, 0, XONGKORO.acceleration * step)
      this.pitch = approach(this.pitch, 0, XONGKORO.pitchRate * step)
      this.bank = approach(this.bank, 0, XONGKORO.bankResponse * step)
      const sink = Math.min(XONGKORO.verticalDescentRate, Math.max(1, agl * 1.2))
      this.velocity.set(Math.sin(this.yaw) * this.speed,
        this.retreating ? Math.max(-sink, -agl / step) : XONGKORO.verticalClimbRate, Math.cos(this.yaw) * this.speed)
      position.addScaledVector(this.velocity, step)
      this.climbFrom = this.retreating ? -Infinity : position.y - expected
      if (this.retreating && position.y <= terrainHeight(position.x, position.z) + .05) {
        position.y = terrainHeight(position.x, position.z); this.phase = 'grounded'; this.speed = 0; this.pitch = 0; this.bank = 0
        this.velocity.set(0, 0, 0); this.takeoffCooldown = this.blocked ? XONGKORO.verticalRetrySeconds : 0
        this.retreating = this.blocked = false
      }
      return true
    }
    if (!target || !this.intent.brake) return false
    const dx = target.x - position.x, dz = target.z - position.z, distance = Math.hypot(dx, dz)
    if (this.phase !== 'landing' && (this.phase !== 'cruise' || distance > XONGKORO.verticalCaptureRadius
      || this.speed > XONGKORO.minimumSpeed + .5)) return false
    // The descent column is the pad's own footprint, from the eagle's height to the ground.
    const padGround = terrainHeight(target.x, target.z)
    if (!isEagleLandingClear(target as EagleLandingPoint, obstacles, [], bound, terrainHeight)
      || !isEagleColumnClear(target, padGround, position.y + XONGKORO.bodyHeight, obstacles)) {
      if (this.phase === 'landing') this.phase = 'cruise'
      return false
    }
    this.phase = 'landing'
    this.beginStep(position)
    const yawError = angleDelta(target.yaw, this.yaw)
    this.yaw += THREE.MathUtils.clamp(yawError, -XONGKORO.turnRate * step, XONGKORO.turnRate * step)
    this.bank = approach(this.bank, 0, XONGKORO.bankResponse * step)
    // Hold above the pad while trimming position/heading; only an aligned eagle settles.
    // Wings off the pad heading sweep outside its validated footprint: turn above the
    // surroundings, then trim the last metre just over the pad.
    const headed = Math.abs(yawError) <= EAGLE_PAD_YAW_TOLERANCE / 2, aligned = headed && distance < 1
    const height = position.y - surface - (aligned ? 0 : headed ? XONGKORO.verticalHoldHeight : this.climbHeight())
    this.pitch = approach(this.pitch, position.y - surface > 3 ? XONGKORO.verticalFlarePitch : 0, XONGKORO.pitchRate * step)
    this.sample.set(dx, 0, dz)
    if (distance > .0001) this.sample.multiplyScalar(Math.min(XONGKORO.minimumSpeed, distance * 1.2) / distance)
    this.correction.set(this.velocity.x, 0, this.velocity.z)
    this.sample.sub(this.correction).clampLength(0, XONGKORO.acceleration * step)
    this.correction.add(this.sample)
    const sink = Math.min(XONGKORO.verticalDescentRate, Math.max(1, height * 1.2))
    this.velocity.set(this.correction.x, height > 0 ? Math.max(-sink, -height / step)
      : Math.min(XONGKORO.verticalClimbRate, -height / step), this.correction.z)
    this.speed = Math.hypot(this.velocity.x, this.velocity.z)
    position.addScaledVector(this.velocity, step)
    const ground = terrainHeight(position.x, position.z)
    if (aligned && position.y <= ground + .05) {
      position.y = ground; this.phase = 'grounded'; this.speed = 0; this.pitch = 0; this.bank = 0
      this.velocity.set(0, 0, 0)
    }
    return true
  }

  private climbHeight(): number {
    return Math.max(XONGKORO.verticalTakeoffHeight, this.intent.climbHeight ?? 0)
  }
  private climbClear(position: THREE.Vector3, obstacles: ObstacleData[], terrainHeight: (x: number, z: number) => number): boolean {
    this.landingPoint.x = position.x; this.landingPoint.z = position.z; this.landingPoint.yaw = this.yaw
    const ground = terrainHeight(position.x, position.z)
    return isEagleColumnClear(this.landingPoint, ground, ground + this.climbHeight() + XONGKORO.bodyHeight + 1, obstacles)
  }

  private beginStep(position: THREE.Vector3): void {
    this.oldAhead.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
    this.oldSide.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    this.previous.copy(position)
  }

  private contain(position: THREE.Vector3, obstacles: ObstacleData[], bound: number, surface: number,
    terrainHeight: (x: number, z: number) => number): void {
    // Three overlapping torso volumes follow pitch/yaw. Wing span is clearance, never flesh.
    this.ahead.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
    this.side.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    for (const along of [-3.2, 0, 3.2]) {
      this.sample.copy(position).addScaledVector(this.ahead, along)
      this.oldSample.copy(this.previous).addScaledVector(this.oldAhead, along)
      this.correction.copy(this.sample)
      const sampleGround = terrainHeight(this.sample.x, this.sample.z)
      if (this.sample.y < sampleGround && this.phase !== 'landing' && !this.retreating) this.sample.y = sampleGround
      resolveObstacleCollision(this.sample, this.oldSample, this.velocity.y, false,
        XONGKORO.bodyRadius, XONGKORO.bodyHeight, 0, obstacles)
      this.correction.sub(this.sample)
      position.sub(this.correction)
    }
    for (const across of [-9, -6, -3, 3, 6, 9]) {
      this.sample.copy(position).addScaledVector(this.side, across); this.sample.y += 1.8
      this.oldSample.copy(this.previous).addScaledVector(this.oldSide, across); this.oldSample.y += 1.8
      this.correction.copy(this.sample)
      resolveObstacleCollision(this.sample, this.oldSample, this.velocity.y, false, .9, 1.2, 0, obstacles)
      this.correction.sub(this.sample)
      position.sub(this.correction)
    }
    // Continuous hard boundary contact. Intent steering above turns the eagle back before contact.
    position.x = THREE.MathUtils.clamp(position.x, -bound + XONGKORO.wingClearance, bound - XONGKORO.wingClearance)
    position.z = THREE.MathUtils.clamp(position.z, -bound + XONGKORO.wingClearance, bound - XONGKORO.wingClearance)
    position.y = Math.min(position.y, surface + XONGKORO.maxAltitude)
  }
}
