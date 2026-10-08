import * as THREE from 'three'
import type { EagleFlightController, EagleFlightIntent } from './EagleFlightController'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { XONGKORO } from './XongkoroConfig'

/** AI supplies a flight intention; the shared flight controller owns actual movement. */
export class EagleFlightAI {
  private recovery = 0
  private pass = 0
  private readonly goal = new THREE.Vector3()
  private readonly direction = new THREE.Vector3()
  private readonly intent: EagleFlightIntent = { yaw: 0, pitch: 0 }
  attacked(): void {
    this.pass = XONGKORO.attackWindup + XONGKORO.attackWindow + .1
    this.recovery = XONGKORO.aiRecoverySeconds
  }
  update(dt: number, flight: EagleFlightController, position: THREE.Vector3,
    destination: THREE.Vector3, ranged: boolean, land: boolean,
    neighbors: readonly THREE.Vector3[], obstacles: ObstacleData[]): EagleFlightIntent {
    if (this.pass > 0) {
      this.pass = Math.max(0, this.pass - dt)
      Object.assign(this.intent, { yaw: flight.yaw, pitch: flight.pitch, bankInput: 0, takeoff: true, sprint: false, brake: false })
      return this.intent
    }
    this.recovery = Math.max(0, this.recovery - dt)
    this.goal.copy(destination)
    const dx = destination.x - position.x, dz = destination.z - position.z
    const distance = Math.hypot(dx, dz)
    if (land) {
      this.goal.y = getTerrainHeight(destination.x, destination.z)
    } else if (ranged || this.recovery > 0) {
      const angle = Math.atan2(position.x - destination.x, position.z - destination.z) + .65
      this.goal.x += Math.sin(angle) * XONGKORO.aiOrbitRadius
      this.goal.z += Math.cos(angle) * XONGKORO.aiOrbitRadius
      this.goal.y = Math.max(destination.y + XONGKORO.aiCruiseHeight, getTerrainHeight(this.goal.x, this.goal.z) + XONGKORO.aiCruiseHeight)
    } else {
      this.goal.y = destination.y + (distance < XONGKORO.aiAttackApproachDistance ? Math.max(.4, (distance - 10) * .2) : XONGKORO.aiCruiseHeight)
    }
    this.direction.copy(this.goal).sub(position)
    for (const other of neighbors) {
      const squared = position.distanceToSquared(other)
      if (squared <= .01 || squared >= XONGKORO.aiSeparationRadius ** 2) continue
      const weight = XONGKORO.aiSeparationRadius / Math.sqrt(squared)
      this.direction.x += (position.x - other.x) * weight
      this.direction.z += (position.z - other.z) * weight
      this.direction.y += (position.y - other.y) * weight
    }
    // Look ahead through world volumes before turning; actual collision still sweeps every step.
    const lookahead = Math.max(14, flight.speed * 1.5)
    const aheadX = position.x + Math.sin(flight.yaw) * lookahead
    const aheadZ = position.z + Math.cos(flight.yaw) * lookahead
    for (const { box } of obstacles) {
      if (aheadX + XONGKORO.wingClearance < box.min.x || aheadX - XONGKORO.wingClearance > box.max.x
        || aheadZ + XONGKORO.bodyHalfLength < box.min.z || aheadZ - XONGKORO.bodyHalfLength > box.max.z
        || position.y > box.max.y + 3 || position.y + XONGKORO.bodyHeight < box.min.y) continue
      this.direction.y = Math.max(this.direction.y, lookahead)
    }
    this.intent.yaw = Math.atan2(this.direction.x, this.direction.z)
    this.intent.pitch = Math.atan2(this.direction.y, Math.max(1, Math.hypot(this.direction.x, this.direction.z)))
    this.intent.takeoff = !land || distance > 15
    this.intent.sprint = !land && distance > 70
    this.intent.brake = land && distance < 24
    this.intent.bankInput = 0
    return this.intent
  }
}
