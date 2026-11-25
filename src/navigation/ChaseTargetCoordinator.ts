import * as THREE from 'three'
import type { SpatialGrid } from '../world/SpatialGrid'
import { type NPC } from '../world/NPC'
import { combatAllegiancesHostile, Faction } from '../combat/CombatFaction'

export const CHASE_GROUP_SIZE = 4
export const CHASE_GROUP_TARGET_TTL_FRAMES = 8

const CHASE_KEY_OFFSET = 0x200000 // 2^21
const CHASE_KEY_SPAN = 0x400000   // 2^22
const FACTION_SLOT: Record<Faction, number> = {
  [Faction.PLAYER]: 0,
  [Faction.ENEMY]: 1,
  [Faction.TOWN]: 2,
  [Faction.BANDIT]: 3,
}

function packChaseKey(faction: Faction, groupX: number, groupZ: number, groundOnly: boolean): number {
  return ((groupX + CHASE_KEY_OFFSET) * CHASE_KEY_SPAN + (groupZ + CHASE_KEY_OFFSET)) * 8
    + (FACTION_SLOT[faction] * 2 + (groundOnly ? 1 : 0))
}

interface ChaseTargetCacheEntry {
  target: NPC | null
  expiresFrame: number
}

export class ChaseTargetCoordinator {
  private readonly cache = new Map<number, ChaseTargetCacheEntry>()
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
    groundOnly = false,
  ): NPC | null {
    if (!hostileNpcGrid) return null

    const groupX = Math.floor(npc.combatPosition.x / CHASE_GROUP_SIZE)
    const groupZ = Math.floor(npc.combatPosition.z / CHASE_GROUP_SIZE)
    const key = packChaseKey(npc.faction, groupX, groupZ, groundOnly)

    const cached = this.cache.get(key)
    if (
      cached
      && cached.expiresFrame >= this.frame
      && (
        cached.target === null
        || (!cached.target.dead && combatAllegiancesHostile(npc, cached.target)
          && (!groundOnly || !cached.target.mount?.isFlyingMount))
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
      candidate => !candidate.dead && combatAllegiancesHostile(npc, candidate)
        && (!groundOnly || !candidate.mount?.isFlyingMount),
    )

    if (cached) {
      cached.target = target
      cached.expiresFrame = this.frame + CHASE_GROUP_TARGET_TTL_FRAMES
    } else {
      this.cache.set(key, {
        target,
        expiresFrame: this.frame + CHASE_GROUP_TARGET_TTL_FRAMES,
      })
    }
    return target
  }
}
