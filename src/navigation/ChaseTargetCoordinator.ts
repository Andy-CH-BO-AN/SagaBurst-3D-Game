import * as THREE from 'three'
import type { SpatialGrid } from '../world/SpatialGrid'
import { type NPC } from '../world/NPC'

export const CHASE_GROUP_SIZE = 4
export const CHASE_GROUP_TARGET_TTL_FRAMES = 8

interface ChaseTargetCacheEntry {
  target: NPC | null
  expiresFrame: number
}

export class ChaseTargetCoordinator {
  private readonly cache = new Map<string, ChaseTargetCacheEntry>()
  private readonly _groupCenter = new THREE.Vector3()
  private frame = 0

  beginFrame(): void {
    this.frame++

    // Bound stale keys from units crossing the map over a long battle.
    if (this.frame % 120 === 0) {
      for (const [key, entry] of this.cache) {
        if (entry.expiresFrame < this.frame) this.cache.delete(key)
      }
    }
  }

  findGroupTarget(
    npc: NPC,
    hostileNpcGrid: SpatialGrid<NPC> | null,
  ): NPC | null {
    if (!hostileNpcGrid) return null

    const groupX = Math.floor(npc.combatPosition.x / CHASE_GROUP_SIZE)
    const groupZ = Math.floor(npc.combatPosition.z / CHASE_GROUP_SIZE)
    const key = `${npc.faction}:${groupX}:${groupZ}`

    const cached = this.cache.get(key)
    if (
      cached
      && cached.expiresFrame >= this.frame
      && (
        cached.target === null
        || (!cached.target.dead && cached.target.faction !== npc.faction)
      )
    ) {
      return cached.target
    }

    this._groupCenter.set(
      (groupX + 0.5) * CHASE_GROUP_SIZE,
      npc.combatPosition.y,
      (groupZ + 0.5) * CHASE_GROUP_SIZE,
    )

    const target = hostileNpcGrid.findNearest(
      this._groupCenter,
      candidate => !candidate.dead && candidate.faction !== npc.faction,
    )

    this.cache.set(key, {
      target,
      expiresFrame: this.frame + CHASE_GROUP_TARGET_TTL_FRAMES,
    })
    return target
  }
}
