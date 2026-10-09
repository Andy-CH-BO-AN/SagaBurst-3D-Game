import type { CareerProfile } from './CareerProfile'

export interface EaglePad { id: string; x: number; z: number; yaw: number }
export const PLAYER_EAGLE_PAD_OWNER = 'player'

/** Identities are allocations, never the member's position in the full HR roster. */
export function careerEaglePadOwners(profile: CareerProfile): string[] {
  return [
    ...(profile.selectedMountId === 'xongkoro' ? [PLAYER_EAGLE_PAD_OWNER] : []),
    ...(profile.personalSquad?.members ?? []).filter(member => member.equipment?.mount === 'xongkoro')
      .map(member => member.id).sort(),
  ]
}

/** Shared by Player and Personal Squad. Town-owned pads use a separate layout/owner. */
export class EaglePadReservations {
  private readonly reservations = new Map<string, EaglePad>()
  private layout: readonly EaglePad[]
  constructor(pads: readonly EaglePad[]) { this.layout = []; this.setPads(pads) }
  get pads(): readonly EaglePad[] { return this.layout }
  /** Rebase a shared field deployment after the mission establishes its actual muster. */
  setPads(pads: readonly EaglePad[]): void {
    if (new Set(pads.map(pad => pad.id)).size !== pads.length) throw new Error('Duplicate eagle pad identity')
    const byId = new Map(pads.map(pad => [pad.id, pad]))
    for (const [owner, previous] of this.reservations) {
      const pad = byId.get(previous.id)
      if (pad) this.reservations.set(owner, pad)
      else this.reservations.delete(owner)
    }
    this.layout = pads
  }
  get(ownerId: string): EaglePad | undefined { return this.reservations.get(ownerId) }
  reserve(ownerId: string, preferredPadId?: string): EaglePad | undefined {
    const existing = this.get(ownerId)
    if (existing) return existing
    const occupied = new Set([...this.reservations.values()].map(pad => pad.id))
    const pad = (preferredPadId ? this.pads.find(pad => pad.id === preferredPadId && !occupied.has(pad.id)) : undefined)
      ?? this.pads.find(pad => !occupied.has(pad.id))
    if (pad) this.reservations.set(ownerId, pad)
    return pad
  }
  release(ownerId: string): void { this.reservations.delete(ownerId) }
  /** Preserve surviving identities and free sold/unassigned owners before admitting new ones. */
  syncOwners(ownerIds: readonly string[], preferredPads: Readonly<Record<string, string>> = {}): void {
    const owners = new Set(ownerIds)
    for (const id of this.reservations.keys()) if (!owners.has(id)) this.release(id)
    for (const id of ownerIds) if (preferredPads[id]) this.reserve(id, preferredPads[id])
    for (const id of ownerIds) this.reserve(id)
  }
}

/** Reload the home identity before ordinary Player/squad registration fills unclaimed pads. */
export function syncCareerEaglePads(pads: EaglePadReservations | undefined, profile: CareerProfile, sceneKey: string): void {
  if (!pads) return
  const saved = profile.activeMission?.personalSquad ?? profile.activeOutpostMission?.personalSquad ?? profile.personalSquadRuntime
  const preferences = saved?.sceneKey === sceneKey
    ? Object.fromEntries(Object.entries(saved.members).flatMap(([id, member]) => member.eaglePadId ? [[id, member.eaglePadId]] : [])) : {}
  pads.syncOwners(careerEaglePadOwners(profile), preferences)
}
