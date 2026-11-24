import type { Vector3 } from 'three'
import type { NavigationWorld } from './NavigationWorld'

export type PursuitNavigationWorld = Pick<NavigationWorld, 'revision' | 'townNav' | 'outpostNav'>

interface PursuitBlock {
  target: Vector3
  from: Vector3
  revision: number
  entrances: number
}

function entranceRevision(world: PursuitNavigationWorld): number {
  return world.townNav?.siegeEntrances.revision ?? world.outpostNav?.entrances?.revision ?? -1
}

/** Targets one pursuer found unreachable. A block lapses when the navigation
 * topology or its entrances change, or when either party moves far enough that
 * the earlier verdict no longer describes the situation. */
export class PursuitBlockList<T extends { combatPosition: Vector3 }> {
  private readonly blocks = new Map<T, PursuitBlock>()

  get size(): number { return this.blocks.size }

  defer(target: T, from: Vector3, world: PursuitNavigationWorld): void {
    this.blocks.set(target, { target: target.combatPosition.clone(), from: from.clone(),
      revision: world.revision, entrances: entranceRevision(world) })
  }

  /** Allocation-free on the per-candidate scan; a lapsed block is removed. */
  allows(target: T, from: Vector3, world: PursuitNavigationWorld | null): boolean {
    const blocked = this.blocks.get(target)
    if (!blocked || !world) return true
    if (blocked.revision !== world.revision || blocked.entrances !== entranceRevision(world)
      || blocked.target.distanceToSquared(target.combatPosition) > 16 || blocked.from.distanceToSquared(from) > 64) {
      this.blocks.delete(target)
      return true
    }
    return false
  }

  clear(): void { this.blocks.clear() }
}
