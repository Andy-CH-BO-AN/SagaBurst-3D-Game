/**
 * Which guest seats follow the host into its current scene. Battlefields take every guest in the
 * room; the other scenes (Town, arenas, prison break) still support one partner, so the rest wait
 * for the host's next battlefield.
 */
import { COOP_MAX_GUESTS } from './CoopLink'

/** The host scene the guest mirrors: a Game battlefield, the Career Town, a duel arena, an Arena Squad Trial or a prison break. */
export type CoopSceneKind = 'game' | 'town' | 'arena' | 'trial' | 'prison'

export const COOP_SCENE_GUESTS: Readonly<Record<CoopSceneKind, number>> = {
  game: COOP_MAX_GUESTS, town: 1, arena: 1, trial: 1, prison: 1,
}

export class CoopAudience {
  private readonly members: number[]

  constructor(readonly scene: CoopSceneKind, seats: readonly number[] = []) {
    this.members = [...new Set(seats)].slice(0, this.capacity)
  }

  get capacity(): number { return COOP_SCENE_GUESTS[this.scene] }
  get seats(): readonly number[] { return this.members }
  has(seat: number): boolean { return this.members.includes(seat) }

  /**
   * A guest asks to follow (it joined or reloaded). Members stay members; a free place is taken; a full
   * scene gives the place of a member that is no longer connected. False: this guest waits.
   */
  admit(seat: number, connected: readonly number[]): boolean {
    if (this.has(seat)) return true
    if (this.members.length < this.capacity) { this.members.push(seat); return true }
    const gone = this.members.findIndex(member => !connected.includes(member))
    if (gone < 0) return false
    this.members[gone] = seat
    return true
  }
}

/**
 * A newly announced scene's members: every connected guest up to the scene's capacity, the
 * previous partner first so a one-guest scene keeps the same partner.
 */
export function initialCoopAudience(scene: CoopSceneKind, connected: readonly number[], partner: number | null): CoopAudience {
  const ordered = [...connected].sort((a, b) => a - b)
  if (partner !== null && ordered.includes(partner)) {
    ordered.splice(ordered.indexOf(partner), 1)
    ordered.unshift(partner)
  }
  return new CoopAudience(scene, ordered)
}
