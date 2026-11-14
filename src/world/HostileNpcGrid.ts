import { Faction } from '../combat/CombatFaction'
import type { SpatialEntity, SpatialGrid } from './SpatialGrid'

export interface FactionGridEntry extends SpatialEntity {
  hp: number
  faction: Faction
  hostileToPlayer?: boolean
}

/** Actors the Player fights: enemies, bandits and Town residents turned hostile; allies and peaceful Town stay excluded. */
export function isPlayerHostileNpc(npc: Pick<FactionGridEntry, 'faction' | 'hostileToPlayer'>): boolean {
  return npc.faction === Faction.ENEMY || npc.faction === Faction.BANDIT || (npc.faction === Faction.TOWN && npc.hostileToPlayer === true)
}

/**
 * Populates the shared, per-faction, and player-hostile spatial grids.
 * Keeps `Faction.BANDIT` intact while letting `Faction.PLAYER` allies acquire
 * bandits, enemies, and hostile town units without falling out of spatial queries.
 */
export function populateNpcFactionGrids<T extends FactionGridEntry>(
  npcs: readonly T[],
  npcGrid: SpatialGrid<T>,
  factionGrids: Readonly<Record<Faction, SpatialGrid<T>>>,
  playerHostileGrid: SpatialGrid<T>,
  onLivingNpc?: (npc: T) => void,
): void {
  npcGrid.clear()
  for (const grid of Object.values(factionGrids)) grid.clear()
  playerHostileGrid.clear()

  for (const npc of npcs) {
    if (npc.hp <= 0) continue
    onLivingNpc?.(npc)
    npcGrid.insert(npc)
    factionGrids[npc.faction].insert(npc)
    if (isPlayerHostileNpc(npc)) {
      playerHostileGrid.insert(npc)
    }
  }
}

export function selectHostileNpcGrid<T extends FactionGridEntry>(
  actorFaction: Faction,
  playerHostileGrid: SpatialGrid<T>,
  factionGrids: Readonly<Record<Faction, SpatialGrid<T>>>,
): SpatialGrid<T> {
  return actorFaction === Faction.PLAYER ? playerHostileGrid : factionGrids[Faction.PLAYER]
}
