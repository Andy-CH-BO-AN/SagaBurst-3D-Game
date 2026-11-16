import type { DuelArenaId } from './DuelArenaCatalog'

export interface DuelArenaSlot { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }

/** The referee watches from the side of the fighting ground, clear of the duel lane. */
export const ARENA_DUEL_REFEREE_SLOTS: Readonly<Record<DuelArenaId, DuelArenaSlot>> = Object.freeze({
  'roman-colosseum': Object.freeze({ x: 16, y: 0, z: 0, yaw: -Math.PI / 2 }),
  'viking-valhalla': Object.freeze({ x: 8, y: 0, z: -4, yaw: -Math.PI / 2 }),
})

