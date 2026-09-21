import * as THREE from 'three'

export const FORMATION_SLOT_SPACING = 2.0
export const FORMATION_ARRIVAL_DISTANCE = 0.4

export interface FormationUnitLike {
  id: string
  position: THREE.Vector3
}

export interface FormationAssignment<T extends FormationUnitLike> {
  unit: T
  slot: THREE.Vector3
}

/** Returns the horizontal direction a formation faces. */
export function horizontalFormationForward(direction: THREE.Vector3): THREE.Vector3 {
  const forward = new THREE.Vector3(direction.x, 0, direction.z)
  if (forward.lengthSq() < 0.0001) return new THREE.Vector3(0, 0, 1)
  return forward.normalize()
}

/** The row's right axis. A +Z-facing formation therefore runs from -X to +X. */
export function formationRowAxis(forward: THREE.Vector3): THREE.Vector3 {
  const horizontal = horizontalFormationForward(forward)
  return new THREE.Vector3(horizontal.z, 0, -horizontal.x).normalize()
}

export function generateLineFormationSlots(
  center: THREE.Vector3,
  forward: THREE.Vector3,
  count: number,
  spacing = FORMATION_SLOT_SPACING,
): THREE.Vector3[] {
  if (count <= 0) return []
  const rowAxis = formationRowAxis(forward)
  const slots: THREE.Vector3[] = []
  for (let index = 0; index < count; index++) {
    const offset = (index - (count - 1) / 2) * spacing
    slots.push(center.clone().addScaledVector(rowAxis, offset))
  }
  return slots
}

/** Assigns the left-to-right slots by current position projection. */
export function assignUnitsToSlots<T extends FormationUnitLike>(
  units: readonly T[],
  slots: readonly THREE.Vector3[],
  rowAxis: THREE.Vector3,
  center: THREE.Vector3,
): FormationAssignment<T>[] {
  const sorted = units.map((unit, originalIndex) => ({ unit, originalIndex }))
  sorted.sort((left, right) => {
    const leftProjection = left.unit.position.clone().sub(center).dot(rowAxis)
    const rightProjection = right.unit.position.clone().sub(center).dot(rowAxis)
    if (leftProjection !== rightProjection) return leftProjection - rightProjection
    if (left.unit.id < right.unit.id) return -1
    if (left.unit.id > right.unit.id) return 1
    return left.originalIndex - right.originalIndex
  })

  return sorted.map((entry, index) => ({
    unit: entry.unit,
    slot: slots[index].clone(),
  }))
}
