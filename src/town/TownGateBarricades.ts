import { TOWN_GATES, townGatePoint, type TownGateId } from './TownLayout'

function barricadeInwardDepth(gateId: TownGateId): number {
  // Keep the northern and western works clear of the existing eagle approaches.
  return gateId === 'north' || gateId === 'west' ? 8 : 21
}

export function fourGateGroundFront(gateId: TownGateId): number {
  return barricadeInwardDepth(gateId) + 8
}

/** Break up the gate opening with independent segments and keep a mounted-width central gap. */
export function townFourGateBarricadeRects() {
  return TOWN_GATES.flatMap(gate => [-1, 1].flatMap(side => [4.25, 20].map((lateral, rank) => {
    // The inner pair reaches into the 14m opening, leaving a 4m central gap.
    // Set it beyond the inward gate-leaf swing; keep the outer works in place.
    const center = townGatePoint(gate, lateral * side, barricadeInwardDepth(gate.id) + (rank === 0 ? 3 : 2))
    const alongZ = gate.id === 'east' || gate.id === 'west'
    const [halfX, halfZ] = alongZ ? [1.15, 2.25] : [2.25, 1.15]
    return { minX: center.x - halfX, maxX: center.x + halfX,
      minZ: center.z - halfZ, maxZ: center.z + halfZ, alongZ }
  })))
}
