import * as THREE from 'three'

export interface PlatformOccupant {
  readonly combatantId: string
  readonly dead: boolean
  readonly position: THREE.Vector3
}

/** Transports world-space roots by the carrier delta, never re-parents or resets local locomotion. */
export class MovingPlatformSupport<T extends PlatformOccupant> {
  private readonly occupants = new Map<string, T>()
  readonly position: THREE.Vector3
  private readonly delta = new THREE.Vector3()
  constructor(position: THREE.Vector3) { this.position = position.clone() }
  attach(actor: T): void {
    if (this.occupants.has(actor.combatantId)) throw new Error(`Duplicate platform occupant: ${actor.combatantId}`)
    this.occupants.set(actor.combatantId, actor)
  }
  detach(id: string): T | undefined {
    const actor = this.occupants.get(id)
    this.occupants.delete(id)
    return actor
  }
  moveTo(position: THREE.Vector3): void {
    this.delta.copy(position).sub(this.position)
    for (const [id, actor] of this.occupants) {
      if (actor.dead) { this.occupants.delete(id); continue }
      actor.position.add(this.delta)
    }
    this.position.copy(position)
  }
  release(callback: (actor: T) => void): void {
    for (const actor of this.occupants.values()) if (!actor.dead) callback(actor)
    this.occupants.clear()
  }
  get size(): number { return this.occupants.size }
}
