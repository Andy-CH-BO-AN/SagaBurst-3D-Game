import * as THREE from 'three'
import { clampToPlayableWorld, getTerrainHeight, resolveObstacleCollision, type ObstacleData } from '../world/Terrain'
import { XONGKORO } from './XongkoroConfig'

export interface FallingRiderSnapshot {
  active: boolean
  highestFeetY: number
  velocity: { x: number; y: number; z: number }
}

export function parseFallingRiderSnapshot(value: unknown): FallingRiderSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const state = value as Partial<FallingRiderSnapshot>
  if (state.active !== true || typeof state.highestFeetY !== 'number' || !Number.isFinite(state.highestFeetY)
    || !state.velocity || ![state.velocity.x, state.velocity.y, state.velocity.z].every(v => typeof v === 'number' && Number.isFinite(v))) return undefined
  return { active: true, highestFeetY: state.highestFeetY, velocity: { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z } }
}

/** Exact environmental damage; never round fractional heights or use current HP. */
export function riderFallDamage(maxHp: number, height: number): number {
  return maxHp * Math.min(1, Math.max(0, height) / XONGKORO.fallLethalHeight)
}

/** Position is always the rider's feet, including after releasing a standing socket. */
export class FallingRider {
  active = false
  highestFeetY = 0
  readonly velocity = new THREE.Vector3()
  private readonly previous = new THREE.Vector3()
  constructor(private readonly body = { radius: .4, height: 1.85 }) {}

  begin(feet: THREE.Vector3, velocity: THREE.Vector3): void {
    // Repeated cleanup/dismount must never erase the first loss of support.
    if (this.active) return
    this.active = true
    this.highestFeetY = feet.y
    this.velocity.copy(velocity)
  }

  snapshot(): FallingRiderSnapshot {
    return { active: this.active, highestFeetY: this.highestFeetY, velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z } }
  }

  restore(snapshot: FallingRiderSnapshot): void {
    if (!snapshot.active || !Number.isFinite(snapshot.highestFeetY)
      || ![snapshot.velocity.x, snapshot.velocity.y, snapshot.velocity.z].every(Number.isFinite)) return
    this.active = true
    this.highestFeetY = snapshot.highestFeetY
    this.velocity.set(snapshot.velocity.x, snapshot.velocity.y, snapshot.velocity.z)
  }

  clear(): void { this.active = false; this.velocity.set(0, 0, 0) }

  /** Returns a height exactly once, and only after a downward support contact. */
  update(feet: THREE.Vector3, dt: number, obstacles: ObstacleData[], bound: number,
    terrainHeight: (x: number, z: number) => number = getTerrainHeight): number | null {
    if (!this.active || dt <= 0) return null
    const steps = Math.max(1, Math.ceil(dt * Math.max(this.velocity.length(), 30) / XONGKORO.collisionStep))
    const step = dt / steps
    for (let i = 0; i < steps; i++) {
      this.previous.copy(feet)
      const oldVelocityY = this.velocity.y
      feet.addScaledVector(this.velocity, step)
      feet.y -= XONGKORO.gravity * step * step / 2
      this.velocity.y -= XONGKORO.gravity * step
      // Capture the actual parabola apex if it falls between substeps.
      this.highestFeetY = Math.max(this.highestFeetY, feet.y,
        oldVelocityY > 0 && this.velocity.y <= 0
          ? this.previous.y + oldVelocityY * oldVelocityY / (2 * XONGKORO.gravity) : -Infinity)
      const ground = terrainHeight(feet.x, feet.z)
      let supported = this.velocity.y <= 0 && feet.y <= ground
      if (supported) feet.y = ground
      const collision = resolveObstacleCollision(feet, this.previous, this.velocity.y, supported, this.body.radius, this.body.height, 0, obstacles)
      this.velocity.y = collision.velocityY
      supported = collision.onGround
      clampToPlayableWorld(feet, bound)
      if (supported) {
        const height = Math.max(0, this.highestFeetY - feet.y)
        this.clear()
        return height
      }
    }
    return null
  }
}
