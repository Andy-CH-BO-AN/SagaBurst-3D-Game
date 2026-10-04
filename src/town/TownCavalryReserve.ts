import type { Mount } from '../world/Mount'
import type { NPC } from '../world/NPC'
import type { TownActorSpec } from './TownRules'

export interface TownCavalryMissionSlot {
  unitType: 'sword_cavalry' | 'lancer' | 'horse_archer'
  officer?: 'captain' | 'ranger'
  /** The mission's existing named officer identity (Town Captain or Maki). */
  preferredActorId?: string
}

export interface TownCavalryReserveResident {
  spec: TownActorSpec
  npc: NPC
  homeMount?: Mount
}

export type TownCavalryReserveSource = 'training' | 'patrol-a' | 'patrol-b'

/** Ordinary cavalry and T4 officers are separate pools, independent of runtime leadership. */
export function townCavalryReserveSource(spec: TownActorSpec): TownCavalryReserveSource | undefined {
  if (!spec.mounted || spec.tier === 4 || spec.patrolLeader || !isCavalryUnit(spec.unitKind)) return undefined
  if (spec.duty === 'training') return 'training'
  if (spec.duty !== 'patrol') return undefined
  return spec.patrolId === 'A' ? 'patrol-a' : spec.patrolId === 'B' ? 'patrol-b' : undefined
}

function isCavalryUnit(unitType: TownActorSpec['unitKind']): unitType is TownCavalryMissionSlot['unitType'] {
  return unitType === 'sword_cavalry' || unitType === 'lancer' || unitType === 'horse_archer'
}

function readyMount(mount: Mount | null | undefined, npc: NPC): boolean {
  return Boolean(mount && !mount.dead && !mount.disposed && !mount.riderPlayer
    && (!mount.riderNpc || mount.riderNpc === npc))
}

function officerCompatible(spec: TownActorSpec, slot: TownCavalryMissionSlot): boolean {
  if (spec.tier !== 4) return false
  if (slot.officer === 'ranger') return spec.role === 'ranger'
  return slot.officer === 'captain'
    && (spec.role === 'captain' || spec.duty === 'patrol' && spec.patrolLeader === true)
}

/**
 * Fill only the slots supplied by the authoritative mission roster. Undefined slots
 * need temporary reinforcement; this function neither spawns nor claims actors.
 * Each ordinary source exhausts matching candidates, then other cavalry, before
 * considering the next source. Named officers are selected before the separate
 * Patrol officer pool, so neither a deputy nor a T4 Captain becomes ordinary cavalry.
 */
export function selectTownCavalryReserve(
  residents: readonly TownCavalryReserveResident[],
  slots: readonly TownCavalryMissionSlot[],
  unavailableActorIds: ReadonlySet<string> = new Set(),
): (string | undefined)[] {
  const result: (string | undefined)[] = Array.from({ length: slots.length }, () => undefined)
  const claimed = new Set<string>()
  const candidates = residents.filter(({ spec, npc, homeMount }) => !npc.dead
    && !unavailableActorIds.has(spec.id) && !unavailableActorIds.has(npc.combatantId)
    && (readyMount(npc.mount, npc) || readyMount(homeMount, npc)))
    .sort((a, b) => a.spec.index - b.spec.index || a.spec.id.localeCompare(b.spec.id))
  const claim = (index: number, resident: TownCavalryReserveResident | undefined): void => {
    if (!resident || claimed.has(resident.npc.combatantId)) return
    result[index] = resident.npc.combatantId
    claimed.add(resident.npc.combatantId)
  }
  const available = (resident: TownCavalryReserveResident): boolean => !claimed.has(resident.npc.combatantId)

  // Reserve explicitly named officers first, even when an earlier generic officer slot exists.
  slots.forEach((slot, index) => {
    if (!slot.officer || !slot.preferredActorId) return
    claim(index, candidates.find(resident => available(resident)
      && (resident.spec.id === slot.preferredActorId || resident.npc.combatantId === slot.preferredActorId)
      && officerCompatible(resident.spec, slot)))
  })
  for (const patrolId of ['A', 'B'] as const) {
    slots.forEach((slot, index) => {
      if (!slot.officer || result[index] !== undefined) return
      claim(index, candidates.find(resident => available(resident)
        && resident.spec.duty === 'patrol' && resident.spec.patrolId === patrolId
        && resident.spec.patrolLeader === true && officerCompatible(resident.spec, slot)))
    })
  }

  for (const source of ['training', 'patrol-a', 'patrol-b'] as const) {
    const sourceCandidates = candidates.filter(resident => townCavalryReserveSource(resident.spec) === source)
    // Match the entire current source before consuming mismatched actors for any slot.
    slots.forEach((slot, index) => {
      if (slot.officer || result[index] !== undefined) return
      claim(index, sourceCandidates.find(resident => available(resident) && resident.spec.unitKind === slot.unitType))
    })
    slots.forEach((slot, index) => {
      if (slot.officer || result[index] !== undefined) return
      claim(index, sourceCandidates.find(available))
    })
  }
  return result
}
