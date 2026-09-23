import * as THREE from 'three'
import { formationRowAxis, horizontalFormationForward } from './FormationMath'

export const FORMATION_SEARCH_STEP = 2.0
export const FORMATION_SEARCH_MAX_RADIUS = 20.0

interface FormationSearchOffset {
  lateral: number
  forward: number
}

export interface FormationPlacement {
  center: THREE.Vector3
  slots: THREE.Vector3[]
}

const FORMATION_SEARCH_OFFSETS: readonly FormationSearchOffset[] = buildSearchOffsets()

/** Preserve clear slots; find a nearby free position only for each blocked unit. */
export function resolveFormationSlots<T>(
  idealSlots: readonly THREE.Vector3[],
  forward: THREE.Vector3,
  unitsBySlot: readonly T[],
  radiusOf: (unit: T) => number,
  isSlotUsable: (slot: THREE.Vector3, unit: T) => boolean,
  terrainHeight: (x: number, z: number) => number,
  playableBound: number,
): THREE.Vector3[] | null {
  if (idealSlots.length !== unitsBySlot.length) return null
  const resolved = idealSlots.map(slot => slot.clone())
  const occupied: number[] = []
  const blocked: number[] = []
  for (let index = 0; index < idealSlots.length; index++) {
    if (isSlotUsable(idealSlots[index], unitsBySlot[index])) occupied.push(index)
    else blocked.push(index)
  }
  if (blocked.length === 0) return resolved

  const rowAxis = formationRowAxis(forward)
  const formationForward = horizontalFormationForward(forward)
  for (const index of blocked) {
    const radius = radiusOf(unitsBySlot[index])
    let placed = false
    for (const offset of FORMATION_SEARCH_OFFSETS) {
      const candidate = idealSlots[index].clone()
        .addScaledVector(rowAxis, offset.lateral)
        .addScaledVector(formationForward, offset.forward)
      if (Math.abs(candidate.x) > playableBound || Math.abs(candidate.z) > playableBound) continue
      candidate.y = terrainHeight(candidate.x, candidate.z)
      if (!isSlotUsable(candidate, unitsBySlot[index])) continue
      if (occupied.some(other => {
        const minDistance = radius + radiusOf(unitsBySlot[other])
        const dx = candidate.x - resolved[other].x
        const dz = candidate.z - resolved[other].z
        return dx * dx + dz * dz < minDistance * minDistance - 0.0001
      })) continue
      resolved[index] = candidate
      occupied.push(index)
      placed = true
      break
    }
    if (!placed) return null
  }
  return resolved
}

function buildSearchOffsets(): readonly FormationSearchOffset[] {
  const offsets: FormationSearchOffset[] = []
  for (let lateral = -FORMATION_SEARCH_MAX_RADIUS; lateral <= FORMATION_SEARCH_MAX_RADIUS; lateral += FORMATION_SEARCH_STEP) {
    for (let forward = -FORMATION_SEARCH_MAX_RADIUS; forward <= FORMATION_SEARCH_MAX_RADIUS; forward += FORMATION_SEARCH_STEP) {
      if (lateral === 0 && forward === 0) continue
      if (lateral * lateral + forward * forward > FORMATION_SEARCH_MAX_RADIUS ** 2) continue
      offsets.push({ lateral, forward })
    }
  }
  offsets.sort((left, right) => {
    const leftDistance = left.lateral * left.lateral + left.forward * left.forward
    const rightDistance = right.lateral * right.lateral + right.forward * right.forward
    if (leftDistance !== rightDistance) return leftDistance - rightDistance
    if (left.lateral !== right.lateral) return left.lateral - right.lateral
    return left.forward - right.forward
  })
  return offsets
}
