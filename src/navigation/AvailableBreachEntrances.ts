import type * as THREE from 'three'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { WalkRampSurface } from '../world/Terrain'
import type { OutpostWalkwaySide } from '../campaign/CampaignOutpostWalkways'

export interface BreachEntrance {
  id: string
  type: 'gate' | 'palisade' | 'siege-ramp-left' | 'siege-ramp-right'
  position: THREE.Vector3
  approach: THREE.Vector3
  exit: THREE.Vector3
  walkable: boolean
  mounted: boolean
  /** null permits both factions (a physical route is not an allegiance shortcut). */
  faction: CharacterFaction | null
  connectionId: string
  surface?: WalkRampSurface
  side?: OutpostWalkwaySide
}

/** Live topology; intentionally independent from CampaignBreachController's one-shot latch. */
export class AvailableBreachEntrances {
  readonly entries = new Map<string, BreachEntrance>()
  revision = 0
  set(entrance: BreachEntrance): boolean {
    const previous = this.entries.get(entrance.id)
    if (previous === entrance) return false
    this.entries.set(entrance.id, entrance)
    this.revision++
    return true
  }
  remove(id: string): boolean {
    if (!this.entries.delete(id)) return false
    this.revision++
    return true
  }
  get hasWalkable(): boolean {
    for (const entry of this.entries.values()) if (entry.walkable) return true
    return false
  }
  get hasMountedRamp(): boolean {
    for (const entry of this.entries.values()) if (entry.walkable && entry.mounted && entry.surface) return true
    return false
  }
  select(position: THREE.Vector3, mounted: boolean, faction: CharacterFaction | null,
    reachable: (point: THREE.Vector3) => boolean, preferred?: string | null): BreachEntrance | null {
    const valid = (e: BreachEntrance): boolean => e.walkable && (!mounted || e.mounted)
      && (e.faction === null || e.faction === faction) && reachable(e.approach)
    const current = preferred ? this.entries.get(preferred) : undefined
    if (current && valid(current)) return current
    let best: BreachEntrance | null = null
    let cost = Infinity
    for (const entry of this.entries.values()) {
      if (!valid(entry)) continue
      const distance = position.distanceTo(entry.approach) + entry.approach.distanceTo(entry.exit)
      if (distance < cost) { best = entry; cost = distance }
    }
    return best
  }
  clear(): void { if (this.entries.size) { this.entries.clear(); this.revision++ } }
}
