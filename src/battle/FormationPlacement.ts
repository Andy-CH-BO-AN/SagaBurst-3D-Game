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

type FormationFactory = (center: THREE.Vector3) => FormationPlacement
type FormationValidator = (formation: FormationPlacement) => boolean

const FORMATION_SEARCH_OFFSETS: readonly FormationSearchOffset[] = buildSearchOffsets()

/** Finds the nearest usable formation while keeping offsets in formation-local axes. */
export function findNearestValidFormation(
  requestedCenter: THREE.Vector3,
  forward: THREE.Vector3,
  makeFormation: FormationFactory,
  isFormationUsable: FormationValidator,
): FormationPlacement | null {
  const rowAxis = formationRowAxis(forward)
  const formationForward = horizontalFormationForward(forward)

  for (const offset of FORMATION_SEARCH_OFFSETS) {
    const candidateCenter = requestedCenter.clone()
      .addScaledVector(rowAxis, offset.lateral)
      .addScaledVector(formationForward, offset.forward)
    const formation = makeFormation(candidateCenter)
    if (isFormationUsable(formation)) return formation
  }
  return null
}

function buildSearchOffsets(): readonly FormationSearchOffset[] {
  const offsets: FormationSearchOffset[] = [{ lateral: 0, forward: 0 }]
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
