import { TOWN_GATES, townGatePoint } from './TownLayout'

const INNER_DEPTH = 8.5
const OUTER_DEPTH = 7.5
const HALF_DEPTH = 1.15
const HALF_WIDTH = 2.25

// A front rank fits between the works and the western eagle approach.
export const FOUR_GATE_GROUND_FRONT = INNER_DEPTH + HALF_DEPTH + .65

/** Break up the gate opening with independent segments and keep a mounted-width central gap. */
export function townFourGateBarricadeRects() {
  return TOWN_GATES.flatMap(gate => [-1, 1].flatMap(side => [
    // Inner pair clears the 7m leaf swing with a 4m central interval.
    { lateral: 4.25, depth: INNER_DEPTH },
    // Outer pair sits beside the swing, leaving 4.25m between adjacent segments.
    { lateral: 13, depth: OUTER_DEPTH },
  ].map(({ lateral, depth }) => {
    const center = townGatePoint(gate, lateral * side, depth)
    const alongZ = gate.id === 'east' || gate.id === 'west'
    const [halfX, halfZ] = alongZ ? [HALF_DEPTH, HALF_WIDTH] : [HALF_WIDTH, HALF_DEPTH]
    return { minX: center.x - halfX, maxX: center.x + halfX,
      minZ: center.z - halfZ, maxZ: center.z + halfZ, alongZ }
  })))
}
