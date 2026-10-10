import * as THREE from 'three'
import { getTerrainHeight, resolveObstacleCollision, type ObstacleData } from '../world/Terrain'
import { XONGKORO } from './XongkoroConfig'
import { isEagleLandingClear } from '../world/EagleLanding'
import { EAGLE_PAD_YAW_TOLERANCE } from '../world/EaglePadArrival'

export type EagleFlightPhase = 'grounded' | 'takeoff' | 'cruise' | 'landing'
export interface EagleFlightIntent { yaw: number; pitch: number; bankInput?: number; sprint?: boolean; brake?: boolean; takeoff?: boolean; landingTarget?: { x: number; z: number; yaw: number } }
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

/** Fixed-wing movement shared by human steering and AI intent; no actor speed modifiers. */
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

  setIntent(intent: EagleFlightIntent): void { Object.assign(this.intent, { bankInput: 0, sprint: false, brake: false, takeoff: false, landingTarget: undefined }, intent) }
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
      if (!this.intent.takeoff || !this.canLand(position, obstacles, terrainHeight, bound)) return
      this.phase = 'takeoff'
      this.speed = XONGKORO.minimumSpeed
      this.pitch = Math.max(XONGKORO.takeoffPitch, this.intent.pitch)
    }
    const steps = Math.max(1, Math.ceil(dt * XONGKORO.sprintSpeed / XONGKORO.collisionStep))
    const step = dt / steps
    for (let i = 0; i < steps; i++) {
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
      // Three overlapping torso volumes follow pitch/yaw. Wing span is clearance, never flesh.
      this.ahead.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
      this.side.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
      for (const along of [-3.2, 0, 3.2]) {
        this.sample.copy(position).addScaledVector(this.ahead, along)
        this.oldSample.copy(this.previous).addScaledVector(this.oldAhead, along)
        this.correction.copy(this.sample)
        const sampleGround = terrainHeight(this.sample.x, this.sample.z)
        if (this.sample.y < sampleGround && this.phase !== 'landing') this.sample.y = sampleGround
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
    rotation.set(-this.pitch, this.yaw, this.bank, 'YXZ')
  }
}
