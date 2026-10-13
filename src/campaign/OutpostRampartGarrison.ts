import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { getWalkRampHeight } from '../world/Terrain'
import { AIType } from '../world/NPC'
import type { CampaignFaction } from './CampaignConfig'
import { getCampaignOutpostPlacement } from './CampaignOutpost'
import { getOutpostWalkwayLayout, OUTPOST_WALKWAY } from './CampaignOutpostWalkways'

export type OutpostRampartSection = 'left' | 'gate' | 'right'

export interface OutpostRampartArcherSlot {
  section: OutpostRampartSection
  x: number
  y: number
  z: number
}

export interface OutpostRampartArcherSlots {
  left: OutpostRampartArcherSlot[]
  gate: OutpostRampartArcherSlot[]
  right: OutpostRampartArcherSlot[]
}

export interface OutpostRampartDeployment {
  assignments: Array<{ spec: NpcSpawnSpec; slot: OutpostRampartArcherSlot }>
  eligibleCount: number
  overflowCount: number
}

export const OUTPOST_RAMPART_GARRISON = {
  leftCapacity: 16,
  gateCapacity: 4,
  rightCapacity: 16,
  /** Keeps the body behind the front breastwork while leaving room behind it. */
  frontInset: 0.9,
  /** Existing battlement period is also the minimum slot-to-slot separation. */
  spacing: OUTPOST_WALKWAY.crenelPeriod,
} as const

function surfaceSlot(
  section: OutpostRampartSection,
  surface: ReturnType<typeof getOutpostWalkwayLayout>['bridge']['walkSurface'],
  x: number,
  z: number,
): OutpostRampartArcherSlot {
  const y = getWalkRampHeight(surface, x, z)
  if (y === null) throw new Error(`Outpost rampart ${section} slot is outside its walk surface`)
  return { section, x, y, z }
}

/**
 * Deterministic slots derived from the live Outpost walkway geometry.
 * Deck centres stay 1.2m away from both longitudinal ends; bridge centres stay
 * 1.6m away from the deck portals. Every neighbour is one crenel period apart.
 */
export function getOutpostRampartArcherSlots(defenderFaction: CampaignFaction): OutpostRampartArcherSlots {
  const placement = getCampaignOutpostPlacement(defenderFaction)
  const layout = getOutpostWalkwayLayout(placement)
  const z = placement.frontZ + layout.zSign * OUTPOST_RAMPART_GARRISON.frontInset
  const xNear = placement.gateWidth / 2 + OUTPOST_WALKWAY.gateMargin
  const firstDeckOffset = OUTPOST_RAMPART_GARRISON.spacing / 2
  const leftDeck = layout.decks.find(deck => deck.side === -1)
  const rightDeck = layout.decks.find(deck => deck.side === 1)
  if (!leftDeck || !rightDeck) throw new Error('Outpost rampart requires both walkway decks')

  const deckSlots = (section: 'left' | 'right', side: -1 | 1, surface: typeof leftDeck.walkSurface) =>
    Array.from({ length: OUTPOST_RAMPART_GARRISON.leftCapacity }, (_, index) => {
      const outwardX = xNear + firstDeckOffset + index * OUTPOST_RAMPART_GARRISON.spacing
      return surfaceSlot(section, surface, side * outwardX, z)
    })

  const gateFirstX = -(OUTPOST_RAMPART_GARRISON.gateCapacity - 1)
    * OUTPOST_RAMPART_GARRISON.spacing / 2
  const gate = Array.from({ length: OUTPOST_RAMPART_GARRISON.gateCapacity }, (_, index) =>
    surfaceSlot('gate', layout.bridge.walkSurface,
      gateFirstX + index * OUTPOST_RAMPART_GARRISON.spacing, z))

  return {
    left: deckSlots('left', -1, leftDeck.walkSurface),
    gate,
    right: deckSlots('right', 1, rightDeck.walkSurface),
  }
}

export function isOutpostRampartArcherCandidate(
  spec: NpcSpawnSpec,
  defenderFaction: CampaignFaction,
): boolean {
  const rangedWeaponId = spec.loadout?.rangedWeaponId
  return spec.characterFaction === defenderFaction
    && spec.aiType === AIType.RANGED
    && !spec.cavalry
    && !spec.loadout?.mountId
    && Boolean(rangedWeaponId && WEAPONS[rangedWeaponId]?.combatKind === 'bow')
}

function evenlyDistributed<T>(slots: readonly T[], count: number): T[] {
  if (count <= 0) return []
  if (count >= slots.length) return [...slots]
  if (count === 1) return [slots[Math.floor(slots.length / 2)]]
  return Array.from({ length: count }, (_, index) =>
    slots[Math.round(index * (slots.length - 1) / (count - 1))])
}

/**
 * Uses existing archers only. Short rosters alternate left/right until both
 * wings are full, then fill the gate bridge; overflow keeps its ground slots.
 */
export function deployOutpostRampartArchers(
  specs: NpcSpawnSpec[],
  defenderFaction: CampaignFaction,
): OutpostRampartDeployment {
  const eligible = specs.filter(spec => isOutpostRampartArcherCandidate(spec, defenderFaction))
  const slots = getOutpostRampartArcherSlots(defenderFaction)
  const sideCount = Math.min(eligible.length,
    OUTPOST_RAMPART_GARRISON.leftCapacity + OUTPOST_RAMPART_GARRISON.rightCapacity)
  const leftCount = Math.min(OUTPOST_RAMPART_GARRISON.leftCapacity, Math.ceil(sideCount / 2))
  const rightCount = Math.min(OUTPOST_RAMPART_GARRISON.rightCapacity, Math.floor(sideCount / 2))
  const gateCount = Math.min(OUTPOST_RAMPART_GARRISON.gateCapacity, eligible.length - sideCount)
  const left = evenlyDistributed(slots.left, leftCount)
  const right = evenlyDistributed(slots.right, rightCount)
  const gateOrder = [slots.gate[1], slots.gate[2], slots.gate[0], slots.gate[3]]
  const selected: OutpostRampartArcherSlot[] = []
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if (left[index]) selected.push(left[index])
    if (right[index]) selected.push(right[index])
  }
  selected.push(...gateOrder.slice(0, gateCount))

  const assignments = selected.map((slot, index) => {
    const spec = eligible[index]
    spec.x = slot.x
    spec.z = slot.z
    spec.spawnY = slot.y
    spec.outpostRampartGarrison = true
    return { spec, slot }
  })
  return {
    assignments,
    eligibleCount: eligible.length,
    overflowCount: Math.max(0, eligible.length - assignments.length),
  }
}
