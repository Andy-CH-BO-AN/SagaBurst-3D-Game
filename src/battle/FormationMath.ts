import * as THREE from 'three'

export const FORMATION_MAX_COLUMNS = 10
export const FORMATION_COLUMN_SPACING = 2.0
export const FORMATION_ROW_SPACING = 2.5
export const FORMATION_SLOT_SPACING = FORMATION_COLUMN_SPACING
export const FORMATION_ARRIVAL_DISTANCE = 0.4

export interface FormationUnitLike {
  id: string
  position: THREE.Vector3
}

export interface FormationAssignment<T extends FormationUnitLike> {
  unit: T
  slot: THREE.Vector3
}

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

/** Generates centered ranks, with no more than ten slots in each row. */
export function generateFormationSlots(
  center: THREE.Vector3,
  forward: THREE.Vector3,
  count: number,
  columnSpacing = FORMATION_COLUMN_SPACING,
  rowSpacing = FORMATION_ROW_SPACING,
): THREE.Vector3[] {
  if (count <= 0) return []
  const rowAxis = formationRowAxis(forward)
  const horizontal = horizontalFormationForward(forward)
  const rowCount = Math.ceil(count / FORMATION_MAX_COLUMNS)
  const slots: THREE.Vector3[] = []

  for (let index = 0; index < count; index++) {
    const rowIndex = Math.floor(index / FORMATION_MAX_COLUMNS)
    const columnIndex = index % FORMATION_MAX_COLUMNS
    const columnsInRow = Math.min(FORMATION_MAX_COLUMNS, count - rowIndex * FORMATION_MAX_COLUMNS)
    const columnOffset = (columnIndex - (columnsInRow - 1) / 2) * columnSpacing
    const rowOffset = (rowIndex - (rowCount - 1) / 2) * rowSpacing
    slots.push(center.clone()
      .addScaledVector(rowAxis, columnOffset)
      .addScaledVector(horizontal, -rowOffset))
  }
  return slots
}

/** Backwards-compatible name for callers that still request a basic formation. */
export function generateLineFormationSlots(
  center: THREE.Vector3,
  forward: THREE.Vector3,
  count: number,
  spacing = FORMATION_COLUMN_SPACING,
): THREE.Vector3[] {
  return generateFormationSlots(center, forward, count, spacing, FORMATION_ROW_SPACING)
}

/** Returns one translation that keeps every slot inside the playable square. */
export function getFormationBoundaryShift(
  slots: readonly THREE.Vector3[],
  playableBound: number,
): THREE.Vector3 {
  if (slots.length === 0) return new THREE.Vector3()
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const slot of slots) {
    minX = Math.min(minX, slot.x)
    maxX = Math.max(maxX, slot.x)
    minZ = Math.min(minZ, slot.z)
    maxZ = Math.max(maxZ, slot.z)
  }
  const dx = minX < -playableBound ? -playableBound - minX : maxX > playableBound ? playableBound - maxX : 0
  const dz = minZ < -playableBound ? -playableBound - minZ : maxZ > playableBound ? playableBound - maxZ : 0
  return new THREE.Vector3(dx, 0, dz)
}

/** Assigns front ranks first, then left-to-right within each rank. */
export function assignUnitsToSlots<T extends FormationUnitLike>(
  units: readonly T[],
  slots: readonly THREE.Vector3[],
  rowAxis: THREE.Vector3,
  center: THREE.Vector3,
  forward = new THREE.Vector3(0, 0, 1),
): FormationAssignment<T>[] {
  const horizontal = horizontalFormationForward(forward)
  const sortedFront = units.map((unit, originalIndex) => ({ unit, originalIndex }))
  sortedFront.sort((left, right) => {
    const leftDepth = left.unit.position.clone().sub(center).dot(horizontal)
    const rightDepth = right.unit.position.clone().sub(center).dot(horizontal)
    if (leftDepth !== rightDepth) return rightDepth - leftDepth
    const leftSide = left.unit.position.clone().sub(center).dot(rowAxis)
    const rightSide = right.unit.position.clone().sub(center).dot(rowAxis)
    if (leftSide !== rightSide) return leftSide - rightSide
    if (left.unit.id < right.unit.id) return -1
    if (left.unit.id > right.unit.id) return 1
    return left.originalIndex - right.originalIndex
  })

  const assignments: FormationAssignment<T>[] = []
  for (let start = 0; start < sortedFront.length; start += FORMATION_MAX_COLUMNS) {
    const row = sortedFront.slice(start, start + FORMATION_MAX_COLUMNS)
    row.sort((left, right) => {
      const leftSide = left.unit.position.clone().sub(center).dot(rowAxis)
      const rightSide = right.unit.position.clone().sub(center).dot(rowAxis)
      if (leftSide !== rightSide) return leftSide - rightSide
      if (left.unit.id < right.unit.id) return -1
      if (left.unit.id > right.unit.id) return 1
      return left.originalIndex - right.originalIndex
    })
    row.forEach((entry, rowIndex) => {
      const slot = slots[start + rowIndex]
      if (slot) assignments.push({ unit: entry.unit, slot: slot.clone() })
    })
  }
  return assignments
}
