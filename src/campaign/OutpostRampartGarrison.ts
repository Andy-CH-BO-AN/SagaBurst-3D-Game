import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { getTerrainHeight, getWalkRampHeight } from '../world/Terrain'
import { AIType } from '../world/NPC'
import type { CampaignFaction } from './CampaignConfig'
import { getCampaignOutpostPlacement } from './CampaignOutpost'
import {
  getOutpostWalkwayLayout,
  type OutpostWalkwayCrenelSpan,
  type OutpostWalkwayDeck,
} from './CampaignOutpostWalkways'

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
  /** Minimum centre-to-centre clearance between any two deployed bodies. */
  minBodySeparation: 1,
  /** Prevents floating-point contact exactly at the deck/bridge clearance limit. */
  junctionClearanceBuffer: 0.05,
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

function crenelCenter(span: OutpostWalkwayCrenelSpan): number {
  return (span.minX + span.maxX) / 2
}

function requireInsideCrenel(x: number, span: OutpostWalkwayCrenelSpan): number {
  if (x <= span.minX || x >= span.maxX) {
    throw new Error(`Outpost rampart slot ${x} is outside crenel ${span.minX}..${span.maxX}`)
  }
  return x
}

/**
 * Deterministic slots derived from the live Outpost walkway geometry.
 * Every muzzle is placed inside a real front-parapet opening. Deck slots start at
 * the open gate junction and omit the constrained outer end gap. The four gate
 * slots use the two openings on each side of the central merlon group.
 */
export function getOutpostRampartArcherSlots(defenderFaction: CampaignFaction): OutpostRampartArcherSlots {
  const placement = getCampaignOutpostPlacement(defenderFaction)
  const layout = getOutpostWalkwayLayout(placement)
  const z = placement.frontZ + layout.zSign * OUTPOST_RAMPART_GARRISON.frontInset
  const leftDeck = layout.decks.find(deck => deck.side === -1)
  const rightDeck = layout.decks.find(deck => deck.side === 1)
  if (!leftDeck || !rightDeck) throw new Error('Outpost rampart requires both walkway decks')

  const deckSlots = (
    section: 'left' | 'right',
    deck: OutpostWalkwayDeck,
    capacity: number,
  ): OutpostRampartArcherSlot[] => {
    const spans = deck.frontCrenelSpans.slice(0, capacity)
    if (spans.length !== capacity) {
      throw new Error(`Outpost rampart ${section} has ${spans.length}/${capacity} crenel openings`)
    }
    return spans.map(span => surfaceSlot(section, deck.walkSurface, crenelCenter(span), z))
  }

  const left = deckSlots('left', leftDeck, OUTPOST_RAMPART_GARRISON.leftCapacity)
  const right = deckSlots('right', rightDeck, OUTPOST_RAMPART_GARRISON.rightCapacity)
  const bridgeSpans = layout.bridge.frontCrenelSpans
  if (bridgeSpans.length < OUTPOST_RAMPART_GARRISON.gateCapacity + 1) {
    throw new Error(`Outpost rampart gate has ${bridgeSpans.length} crenel openings`)
  }
  const gateSpans = [
    bridgeSpans[0],
    bridgeSpans[1],
    bridgeSpans[bridgeSpans.length - 2],
    bridgeSpans[bridgeSpans.length - 1],
  ]
  const gateXs = gateSpans.map(crenelCenter)
  const junctionSeparation = OUTPOST_RAMPART_GARRISON.minBodySeparation
    + OUTPOST_RAMPART_GARRISON.junctionClearanceBuffer
  gateXs[0] = Math.max(gateXs[0], left[0].x + junctionSeparation)
  gateXs[gateXs.length - 1] = Math.min(
    gateXs[gateXs.length - 1],
    right[0].x - junctionSeparation,
  )
  const gate = gateXs.map((x, index) => surfaceSlot(
    'gate',
    layout.bridge.walkSurface,
    requireInsideCrenel(x, gateSpans[index]),
    z,
  ))

  return {
    left,
    gate,
    right,
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

/** Career fallback uses the rear of the same decks, leaving firing gaps and the gate guard intact. */
export function deployOutpostRampartGarrison(specs: NpcSpawnSpec[], defenderFaction: CampaignFaction): OutpostRampartDeployment {
  const archers = deployOutpostRampartArchers(specs, defenderFaction)
  if (archers.eligibleCount > 0) return archers
  const onFoot = specs.filter(spec => spec.characterFaction === defenderFaction && spec.tier !== 4
    && !spec.cavalry && !spec.loadout?.mountId)
  const ranged = onFoot.filter(spec => spec.aiType === AIType.RANGED && spec.loadout?.rangedWeaponId)
  // Other legal ranged defenders still use the authored firing slots.
  if (ranged.length) {
    const slots = getOutpostRampartArcherSlots(defenderFaction)
    const ordered = slots.left.flatMap((slot, i) => [slot, slots.right[i]]).concat(slots.gate)
    const assignments = ranged.slice(0, 36).map((spec, i) => {
      const slot = ordered[i]
      spec.x = slot.x; spec.z = slot.z; spec.spawnY = slot.y; spec.outpostRampartGarrison = true
      return { spec, slot }
    })
    return { assignments, eligibleCount: ranged.length, overflowCount: ranged.length - assignments.length }
  }
  const melee = onFoot.filter(spec => spec.aiType === AIType.MELEE).sort((a, b) => {
    const spear = (spec: NpcSpawnSpec) => spec.presetId?.endsWith('_spearman') ? 0 : 1
    return spear(a) - spear(b)
  })
  // At most half of a small infantry force leaves the ground; twelve is the hard cap.
  const count = Math.min(12, Math.floor(melee.length / 2))
  const layout = getOutpostWalkwayLayout(getCampaignOutpostPlacement(defenderFaction))
  const assignments = melee.slice(0, count).map((spec, i) => {
    const deck = layout.decks.find(d => d.side === (i % 2 === 0 ? -1 : 1))!
    const x = deck.side * (10 + Math.floor(i / 2) * 4.8)
    const z = (deck.slab.min.z + deck.slab.max.z) / 2 + layout.zSign * 1.2
    const slot = surfaceSlot(deck.side < 0 ? 'left' : 'right', deck.walkSurface, x, z)
    spec.x = slot.x; spec.z = slot.z; spec.spawnY = slot.y; spec.outpostRampartGarrison = true
    return { spec, slot }
  })
  return { assignments, eligibleCount: melee.length, overflowCount: melee.length - count }
}

/** Old garrison saves without Y resolve the same deck surface, never the terrain below it. */
export function outpostCheckpointHeight(x: number, z: number, y: number | undefined,
  garrison: boolean | undefined, faction: CampaignFaction): number {
  if (y !== undefined) return y
  if (garrison) {
    const layout = getOutpostWalkwayLayout(getCampaignOutpostPlacement(faction))
    for (const surface of [...layout.decks.map(deck => deck.walkSurface), layout.bridge.walkSurface]) {
      const height = getWalkRampHeight(surface, x, z)
      if (height !== null) return height
    }
  }
  return getTerrainHeight(x, z)
}
