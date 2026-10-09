import * as THREE from 'three'
import type { EagleFlightController, EagleFlightIntent } from './EagleFlightController'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { segmentBoxTime } from '../combat/ShieldBlocking'
import { XONGKORO } from './XongkoroConfig'

export type EagleTactic = 'RANGED_GROUND' | 'DIVE_GROUND' | 'RANGED_AIR' | 'DIVE_AIR'
export type EagleManeuver = 'climb' | 'setup' | 'align' | 'dive' | 'pass' | 'recover' | 'cruise'
export interface EagleFlightCommand {
  kind: 'hold' | 'cruise' | 'follow' | 'formation' | 'defend' | 'return' | 'combat'
  destination: THREE.Vector3
  target?: object
  targetAirborne?: boolean
  targetVelocity?: THREE.Vector3
  /** Equipment/ammo availability; tactic selection remains committed until recovery. */
  rangedAvailable?: boolean
  rangedDistance?: number
  /** Explicit world altitude for following an airborne leader, never added to AGL. */
  altitude?: number
  landingYaw?: number
}

/** Tactical intentions only. All four attacks and ordered travel use the shared flight physics. */
export class EagleFlightAI {
  tactic: EagleTactic | null = null
  maneuver: EagleManeuver = 'cruise'
  cruiseAltitude = XONGKORO.aiCruiseHeight as number
  private target: object | undefined
  private elapsed = 0
  private pass = 0
  private rangedCommitRemaining = 0
  private landingStage: 'approach' | 'final' = 'approach'
  private landingX = Infinity
  private landingZ = Infinity
  private readonly goal = new THREE.Vector3()
  private readonly staging = new THREE.Vector3()
  private readonly intercept = new THREE.Vector3()
  private readonly direction = new THREE.Vector3()
  private readonly ahead = new THREE.Vector3()
  private readonly expanded = new THREE.Box3()
  private readonly avoidance = new THREE.Vector3()
  private avoidanceRemaining = 0
  private avoidSide = 1
  private progressSeconds = 0
  private readonly progressPosition = new THREE.Vector3()
  private readonly landingTarget = { x: 0, z: 0, yaw: 0 }
  private readonly intent: EagleFlightIntent = { yaw: 0, pitch: 0 }

  get canUseRanged(): boolean { return this.maneuver === 'cruise' && this.tactic?.startsWith('RANGED') === true }
  get canUseMelee(): boolean { return this.maneuver === 'dive' && this.tactic?.startsWith('DIVE') === true }
  setCruiseAltitude(altitude: number): void {
    if (Number.isFinite(altitude)) this.cruiseAltitude = THREE.MathUtils.clamp(altitude, 20, 40)
  }
  reset(): void {
    this.target = undefined; this.tactic = null; this.maneuver = 'cruise'; this.elapsed = 0; this.pass = 0; this.rangedCommitRemaining = 0
    this.landingStage = 'approach'; this.landingX = this.landingZ = Infinity
    this.avoidanceRemaining = 0; this.progressSeconds = 0
  }
  attacked(): void {
    this.maneuver = 'pass'
    this.pass = XONGKORO.attackWindup + XONGKORO.attackWindow + .04
    this.elapsed = 0
  }

  update(dt: number, flight: EagleFlightController, position: THREE.Vector3, command: EagleFlightCommand,
    neighbors: readonly THREE.Vector3[], obstacles: readonly ObstacleData[], bound = 300,
    terrainHeight: (x: number, z: number) => number = getTerrainHeight): EagleFlightIntent {
    const ground = terrainHeight(position.x, position.z)
    const agl = position.y - ground
    const destination = command.destination
    this.elapsed += dt
    this.goal.copy(destination)
    this.intent.landingTarget = undefined
    this.intent.bankInput = 0
    this.intent.sprint = false
    this.intent.brake = false
    this.intent.takeoff = command.kind !== 'hold'
    if (command.kind !== 'combat') {
      this.target = undefined; this.tactic = null; this.maneuver = 'cruise'; this.rangedCommitRemaining = 0
      if (command.kind === 'return') this.planLanding(position, destination, command.landingYaw ?? flight.yaw, flight, terrainHeight, bound)
      else {
        this.goal.y = command.altitude ?? terrainHeight(destination.x, destination.z) + this.cruiseAltitude
        const distance = Math.hypot(destination.x - position.x, destination.z - position.z)
        if (command.kind === 'cruise' || command.kind === 'hold' || command.kind === 'defend' || distance < 24) this.orbit(position, destination, XONGKORO.aiOrbitRadius)
        this.goal.y = command.altitude ?? terrainHeight(this.goal.x, this.goal.z) + this.cruiseAltitude
        this.intent.sprint = distance > 90 && command.kind === 'follow'
      }
    } else {
      if (this.target !== command.target || !this.tactic) {
        const committedDive = this.tactic?.startsWith('DIVE') && this.maneuver !== 'cruise'
        this.target = command.target
        if (committedDive) {
          // A new target cannot cancel the physical pullout of the previous pass.
          if (this.maneuver !== 'recover' && this.maneuver !== 'pass') this.recover(position, flight, ground)
        } else {
          this.selectTactic(command, command.rangedAvailable === true)
          this.maneuver = agl < this.cruiseAltitude - 2 ? 'climb' : this.tactic!.startsWith('RANGED') ? 'cruise' : 'setup'
          this.elapsed = 0
          this.stage(position, destination, terrainHeight, bound)
        }
      }
      this.intercept.copy(destination)
      const leadTime = Math.min(2, position.distanceTo(destination) / Math.max(7, flight.speed))
      if (command.targetVelocity) this.intercept.addScaledVector(command.targetVelocity, leadTime)
      this.intercept.x = THREE.MathUtils.clamp(this.intercept.x, -bound + 20, bound - 20)
      this.intercept.z = THREE.MathUtils.clamp(this.intercept.z, -bound + 20, bound - 20)
      const distance = Math.hypot(this.intercept.x - position.x, this.intercept.z - position.z)
      const attackAltitude = Math.max(terrainHeight(this.intercept.x, this.intercept.z) + this.cruiseAltitude,
        command.targetAirborne ? this.intercept.y + 12 : -Infinity)
      const heading = Math.atan2(this.intercept.x - position.x, this.intercept.z - position.z)
      const headingError = Math.abs(Math.atan2(Math.sin(heading - flight.yaw), Math.cos(heading - flight.yaw)))
      const unsafeAirIntercept = command.targetAirborne && (this.intercept.y < terrainHeight(this.intercept.x, this.intercept.z) + 4
        || attackAltitude > terrainHeight(this.intercept.x, this.intercept.z) + XONGKORO.maxAltitude - 5)
      if (unsafeAirIntercept && this.tactic === 'DIVE_AIR' && this.maneuver !== 'recover') this.recover(position, flight, ground)
      if (this.maneuver === 'climb' || this.maneuver === 'recover') {
        this.goal.set(position.x + Math.sin(flight.yaw) * 45, ground + this.cruiseAltitude, position.z + Math.cos(flight.yaw) * 45)
        if (agl >= this.cruiseAltitude - 1 && Math.abs(flight.pitch) < .2 && (this.maneuver === 'climb' || this.elapsed >= XONGKORO.aiRecoverySeconds)) {
          if (this.maneuver === 'recover') this.selectTactic(command, command.rangedAvailable === true)
          this.maneuver = this.tactic!.startsWith('RANGED') ? 'cruise' : 'setup'
          this.elapsed = 0; this.stage(position, this.intercept, terrainHeight, bound)
        }
      } else if (this.maneuver === 'cruise') {
        this.goal.copy(this.intercept)
        const radius = Math.max(12, Math.min(XONGKORO.aiOrbitRadius, (command.rangedDistance ?? 80) * .6))
        if (distance < radius * 1.8) this.orbit(position, this.intercept, radius)
        this.goal.y = terrainHeight(this.goal.x, this.goal.z) + this.cruiseAltitude
        this.rangedCommitRemaining = Math.max(0, this.rangedCommitRemaining - dt)
        const opportunity = this.rangedCommitRemaining === 0 && flight.phase === 'cruise'
          && agl >= this.cruiseAltitude - 2 && !unsafeAirIntercept && distance > 12 && distance < 110
          && this.avoidanceRemaining === 0 && this.clearDiveCorridor(position, obstacles)
        if (!command.rangedAvailable || opportunity) {
          this.selectTactic(command, false)
          this.maneuver = 'setup'; this.elapsed = 0
          this.stage(position, this.intercept, terrainHeight, bound)
        }
      } else if (this.maneuver === 'setup' || this.maneuver === 'align') {
        this.goal.copy(this.maneuver === 'setup' ? this.staging : this.intercept)
        this.goal.y = attackAltitude
        if (this.maneuver === 'setup' && Math.hypot(position.x - this.staging.x, position.z - this.staging.z) < 15) {
          this.maneuver = 'align'; this.elapsed = 0
        }
        if (this.maneuver === 'align' && headingError < .4 && distance > 32 && distance < 110 && position.y >= attackAltitude - 3) {
          this.maneuver = 'dive'; this.elapsed = 0
        } else if (this.elapsed > 15) { this.stage(position, this.intercept, terrainHeight, bound); this.maneuver = 'setup'; this.elapsed = 0 }
      } else if (this.maneuver === 'dive') {
        this.goal.copy(this.intercept)
        this.goal.y += command.targetAirborne ? -.8 : .45
        // Ground runs level out before the target; they do not aim through the floor.
        if (!command.targetAirborne && distance > 13) {
          this.direction.copy(this.intercept).sub(position).setY(0).normalize()
          this.goal.addScaledVector(this.direction, -12)
        }
        if (this.elapsed > 9 || unsafeAirIntercept || headingError > 1.25 && distance < 24
          || !command.targetAirborne && agl < .3) this.recover(position, flight, ground)
      } else if (this.maneuver === 'pass') {
        this.pass -= dt
        this.goal.set(position.x + Math.sin(flight.yaw) * 25, position.y, position.z + Math.cos(flight.yaw) * 25)
        if (this.pass <= 0) this.recover(position, flight, ground)
      }
    }

    const margin = XONGKORO.wingClearance + 5
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -bound + margin, bound - margin)
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, -bound + margin, bound - margin)
    const lookahead = Math.max(24, flight.speed * 2)
    this.direction.copy(this.goal).sub(position).normalize().multiplyScalar(lookahead)
    // Independent 3D separation, with a terminal melee exemption supplied by the caller.
    for (const other of neighbors) {
      const squared = position.distanceToSquared(other)
      if (squared >= XONGKORO.aiSeparationRadius ** 2 || squared < .0001) continue
      const distance = Math.sqrt(squared)
      const weight = (1 - distance / XONGKORO.aiSeparationRadius) * lookahead * 4 / distance
      this.direction.x += (position.x - other.x) * weight
      this.direction.y += (position.y - other.y) * weight
      this.direction.z += (position.z - other.z) * weight
    }
    this.avoidanceRemaining = Math.max(0, this.avoidanceRemaining - dt)
    this.ahead.copy(this.direction).normalize().multiplyScalar(lookahead).add(position)
    for (const obstacle of obstacles) {
      this.expanded.copy(obstacle.box)
      this.expanded.min.x -= XONGKORO.wingClearance; this.expanded.max.x += XONGKORO.wingClearance
      this.expanded.min.z -= XONGKORO.wingClearance; this.expanded.max.z += XONGKORO.wingClearance
      this.expanded.min.y -= XONGKORO.bodyHeight + 1
      if (!Number.isFinite(segmentBoxTime(position, this.ahead, this.expanded))) continue
      if (this.avoidanceRemaining === 0) {
        this.avoidance.copy(this.goal)
        if (obstacle.box.max.y + 5 < ground + this.cruiseAltitude + 8) this.avoidance.y = obstacle.box.max.y + 5
        else {
          const side = this.avoidSide * (position.x <= (obstacle.box.min.x + obstacle.box.max.x) / 2 ? -1 : 1)
          this.avoidance.x = THREE.MathUtils.clamp(side < 0 ? this.expanded.min.x - 5 : this.expanded.max.x + 5, -bound + margin, bound - margin)
          this.avoidance.z = position.z + Math.cos(flight.yaw) * lookahead
          this.avoidance.y = ground + this.cruiseAltitude
        }
        this.avoidanceRemaining = 2
      }
      if (this.maneuver === 'dive') { this.maneuver = 'recover'; this.elapsed = 0 }
      break
    }
    if (this.avoidanceRemaining > 0) this.direction.copy(this.avoidance).sub(position)
    this.progressSeconds += dt
    if (this.progressSeconds >= 2) {
      if (flight.phase !== 'grounded' && position.distanceToSquared(this.progressPosition) < 4) {
        this.avoidSide *= -1; this.avoidanceRemaining = 0
        this.landingStage = 'approach'
        if (command.kind === 'combat') this.recover(position, flight, ground)
      }
      this.progressPosition.copy(position); this.progressSeconds = 0
    }
    this.intent.yaw = Math.atan2(this.direction.x, this.direction.z)
    this.intent.pitch = Math.atan2(this.direction.y, Math.max(1, Math.hypot(this.direction.x, this.direction.z)))
    // Predict the terrain below the next flight segment, rather than a single endpoint.
    if (command.kind !== 'return' && this.maneuver !== 'dive' && this.maneuver !== 'pass') {
      let floor = ground
      for (let i = 1; i <= 4; i++) floor = Math.max(floor, terrainHeight(position.x + Math.sin(flight.yaw) * lookahead * i / 4,
        position.z + Math.cos(flight.yaw) * lookahead * i / 4))
      if (position.y < floor + 6) this.intent.pitch = Math.max(this.intent.pitch, .4)
    } else if (this.maneuver === 'dive' && !command.targetAirborne) {
      // Integrate the height lost while the shared controller rotates out of the
      // current descent. Start levelling before that loss consumes body clearance.
      const descent = Math.max(0, -flight.pitch)
      const pulloutLoss = flight.speed * (1 - Math.cos(descent)) / XONGKORO.pitchRate
      const pulloutDistance = flight.speed * Math.sin(descent) / XONGKORO.pitchRate
      let approachFloor = ground
      for (let i = 1; i <= 4; i++) approachFloor = Math.max(approachFloor,
        terrainHeight(position.x + Math.sin(flight.yaw) * pulloutDistance * i / 4,
          position.z + Math.cos(flight.yaw) * pulloutDistance * i / 4))
      if (position.y <= approachFloor + .65 + pulloutLoss) this.intent.pitch = Math.max(this.intent.pitch, 0)
      if (approachFloor > ground + 1 && position.y < approachFloor + 2 + pulloutLoss) {
        this.maneuver = 'recover'; this.elapsed = 0
        this.intent.pitch = Math.max(this.intent.pitch, .5)
      }
    }
    return this.intent
  }

  private selectTactic(command: EagleFlightCommand, ranged: boolean): void {
    const wasRanged = this.tactic?.startsWith('RANGED') === true
    this.tactic = ranged ? command.targetAirborne ? 'RANGED_AIR' : 'RANGED_GROUND'
      : command.targetAirborne ? 'DIVE_AIR' : 'DIVE_GROUND'
    // Give the bow a real firing interval both initially and after every pullout.
    // Heading/range changes during this interval cannot cause frame-by-frame thrash.
    // Swapping nearby targets must not restart that interval and starve dives.
    if (ranged && !wasRanged) this.rangedCommitRemaining = XONGKORO.aiRangedCommitSeconds
  }
  private clearDiveCorridor(position: THREE.Vector3, obstacles: readonly ObstacleData[]): boolean {
    for (const obstacle of obstacles) {
      this.expanded.copy(obstacle.box)
      this.expanded.min.x -= XONGKORO.wingClearance; this.expanded.max.x += XONGKORO.wingClearance
      this.expanded.min.z -= XONGKORO.wingClearance; this.expanded.max.z += XONGKORO.wingClearance
      this.expanded.min.y -= XONGKORO.bodyHeight + 1
      if (Number.isFinite(segmentBoxTime(position, this.intercept, this.expanded))) return false
    }
    return true
  }
  private orbit(position: THREE.Vector3, center: THREE.Vector3, radius: number): void {
    const angle = Math.atan2(position.x - center.x, position.z - center.z) + .75
    this.goal.x = center.x + Math.sin(angle) * radius
    this.goal.z = center.z + Math.cos(angle) * radius
  }
  private stage(position: THREE.Vector3, target: THREE.Vector3, terrain: (x: number, z: number) => number, bound: number): void {
    this.direction.copy(target).sub(position).setY(0)
    if (this.direction.lengthSq() < 1) this.direction.set(0, 0, 1)
    this.direction.normalize()
    this.staging.copy(target).addScaledVector(this.direction, -80)
    this.staging.x += this.direction.z * 28
    this.staging.z -= this.direction.x * 28
    this.staging.x = THREE.MathUtils.clamp(this.staging.x, -bound + 20, bound - 20)
    this.staging.z = THREE.MathUtils.clamp(this.staging.z, -bound + 20, bound - 20)
    if (Math.hypot(this.staging.x - target.x, this.staging.z - target.z) < 45) {
      // Clipping an outward approach can erase the run-up. Rebuild it on the
      // in-bounds side of an edge target, instead of chasing an unreachable point.
      this.direction.set(-target.x, 0, -target.z).normalize()
      this.staging.copy(target).addScaledVector(this.direction, 80)
      this.staging.x = THREE.MathUtils.clamp(this.staging.x, -bound + 20, bound - 20)
      this.staging.z = THREE.MathUtils.clamp(this.staging.z, -bound + 20, bound - 20)
    }
    this.staging.y = terrain(this.staging.x, this.staging.z) + this.cruiseAltitude
  }
  private recover(position: THREE.Vector3, flight: EagleFlightController, ground: number): void {
    this.maneuver = 'recover'; this.elapsed = 0
    this.goal.set(position.x + Math.sin(flight.yaw) * 35, ground + this.cruiseAltitude, position.z + Math.cos(flight.yaw) * 35)
  }
  private planLanding(position: THREE.Vector3, destination: THREE.Vector3, yaw: number, flight: EagleFlightController,
    terrain: (x: number, z: number) => number, bound: number): void {
    if (destination.x !== this.landingX || destination.z !== this.landingZ) {
      this.landingX = destination.x; this.landingZ = destination.z; this.landingStage = 'approach'
    }
    const ground = terrain(destination.x, destination.z)
    const approachDistance = Math.max(65, this.cruiseAltitude * 2.7)
    // A reciprocal runway heading has the same footprint; use it when the
    // authored direction would require a staging point outside the scene.
    if (Math.abs(destination.x - Math.sin(yaw) * approachDistance) > bound - 20
      || Math.abs(destination.z - Math.cos(yaw) * approachDistance) > bound - 20) yaw += Math.PI
    const sin = Math.sin(yaw), cos = Math.cos(yaw)
    const along = (destination.x - position.x) * sin + (destination.z - position.z) * cos
    const across = Math.abs((destination.x - position.x) * cos - (destination.z - position.z) * sin)
    if (flight.phase === 'grounded' && position.distanceToSquared(destination) < 9) {
      this.goal.copy(position); this.intent.takeoff = false; this.intent.brake = true; return
    }
    this.goal.set(destination.x - sin * approachDistance, ground + this.cruiseAltitude, destination.z - cos * approachDistance)
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -bound + 20, bound - 20)
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, -bound + 20, bound - 20)
    if (this.landingStage === 'approach' && position.distanceTo(this.goal) < 15) this.landingStage = 'final'
    if (this.landingStage === 'final') {
      const headingError = Math.abs(Math.atan2(Math.sin(yaw - flight.yaw), Math.cos(yaw - flight.yaw)))
      this.goal.copy(destination).setY(ground - .3)
      this.intent.brake = true
      if (along < -5 || across > 25 || position.y < ground + 4 && (across > 4 || headingError > .3)) {
        this.landingStage = 'approach'; this.intent.brake = false
        this.goal.set(destination.x - sin * approachDistance, ground + this.cruiseAltitude, destination.z - cos * approachDistance)
      } else {
        this.landingTarget.x = destination.x; this.landingTarget.z = destination.z; this.landingTarget.yaw = yaw
        this.intent.landingTarget = this.landingTarget
      }
    }
    this.intent.takeoff = true
  }
}
