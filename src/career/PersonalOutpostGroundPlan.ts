/** Only grounded actors consume ground slots; full roster indices stay stable for restoreMission. */
export interface PersonalOutpostPoint { x: number; y?: number; z: number; yaw: number }

export function planPersonalOutpostGround(
  memberIds: readonly string[],
  flyingMemberIds: ReadonlySet<string>,
  playerFlying: boolean,
  anchor: PersonalOutpostPoint,
  allocate: (count: number, playerLeads: boolean) => PersonalOutpostPoint[],
): {
  groundPositions: PersonalOutpostPoint[]
  playerPosition: PersonalOutpostPoint
  regularMuster: PersonalOutpostPoint[]
} {
  const count = memberIds.filter(id => !flyingMemberIds.has(id)).length + Number(!playerFlying)
  const groundPositions = count ? allocate(count, !playerFlying) : []
  if (groundPositions.length !== count) throw new Error('Incomplete personal ground deployment')
  let index = playerFlying ? 0 : 1
  const playerPosition = { ...(playerFlying ? anchor : groundPositions[0]) }
  // Flying placeholders are search origins, not slots. The squad runtime reads
  // their reserved eagle pads, and grounds members by original member index.
  const regularMuster = memberIds.map(id => ({
    ...(flyingMemberIds.has(id) ? anchor : groundPositions[index++]),
  }))
  return { groundPositions, playerPosition, regularMuster }
}
