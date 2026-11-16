import type { CharacterFaction } from '../world/CharacterVisuals'

/** Saved, stable IDs of the duel arenas. Never rename: Career saves reference them. */
export type DuelArenaId = 'roman-colosseum' | 'viking-valhalla'

export const DUEL_ARENA_IDS: readonly DuelArenaId[] = Object.freeze(['roman-colosseum', 'viking-valhalla'])

export const DUEL_ARENA_LABELS: Readonly<Record<DuelArenaId, string>> = Object.freeze({
  'roman-colosseum': '羅馬競技場',
  'viking-valhalla': '維京英靈殿',
})

export function parseDuelArenaId(value: unknown): DuelArenaId | null {
  return typeof value === 'string' && (DUEL_ARENA_IDS as readonly string[]).includes(value) ? value as DuelArenaId : null
}

/** DEV preview aliases (`?duelarena=roman|valhalla`) plus the canonical IDs. */
export function parseDuelArenaPreviewQuery(value: string | null): DuelArenaId | null {
  if (value === 'roman' || value === 'colosseum') return 'roman-colosseum'
  if (value === 'valhalla' || value === 'viking' || value === 'valholl') return 'viking-valhalla'
  return parseDuelArenaId(value)
}

/** The selector's initial arena follows the player's culture; any arena may still be chosen. */
export function defaultDuelArenaForFaction(faction: CharacterFaction): DuelArenaId {
  return faction === 'roman' ? 'roman-colosseum' : 'viking-valhalla'
}
