export const TOWN_PLAYABLE_WORLD_BOUND = 350
export const TOWN_GROUND_SIZE = TOWN_PLAYABLE_WORLD_BOUND * 2
export const TOWN_NAVIGATION_BOUNDS = {
  minX: -TOWN_PLAYABLE_WORLD_BOUND, maxX: TOWN_PLAYABLE_WORLD_BOUND,
  minZ: -TOWN_PLAYABLE_WORLD_BOUND, maxZ: TOWN_PLAYABLE_WORLD_BOUND,
} as const

/** Index is the persisted campId; keep ordering independent of scenery exclusions. */
export const TOWN_BANDIT_CAMP_CENTERS: readonly (readonly [number, number])[] = [
  [-260, -230], [260, -240], [-270, 230], [275, 240], [20, 295],
]

/** Spread the existing budget across a square wilderness, including its corners. */
export function townSceneryPoint(index: number, innerRadius: number, bands: number) {
  const angle = index * 2.399, sx = Math.sin(angle), sz = Math.cos(angle)
  const outerRadius = (TOWN_PLAYABLE_WORLD_BOUND - 14) / Math.max(Math.abs(sx), Math.abs(sz))
  const radius = innerRadius + (index % bands) / (bands - 1) * (outerRadius - innerRadius)
  return { x: sx * radius, z: sz * radius, angle }
}

export function nearTownBanditCamp(x: number, z: number, margin: number): boolean {
  return TOWN_BANDIT_CAMP_CENTERS.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < margin)
}

/** Inside native flight turn bounds, far from the central Town entrances. */
export const TOWN_RETIREMENT_EXTRACTION = { x: 0, z: -318 } as const
/** Far-north Cavalry Sweep clearing through the playable edge; not the gate approach. */
export const TOWN_RETIREMENT_RALLY_REGION = {
  minX: -145, maxX: 145, minZ: -TOWN_PLAYABLE_WORLD_BOUND, maxZ: -250,
} as const

/** Guide and admission share one horizontal area, independent of mount or altitude. */
export function townRetirementRallyTarget(position: { x: number; z: number }): { x: number; z: number } {
  const area = TOWN_RETIREMENT_RALLY_REGION
  return { x: Math.max(area.minX, Math.min(area.maxX, position.x)),
    z: Math.max(area.minZ, Math.min(area.maxZ, position.z)) }
}

export const TOWN_RETIREMENT_EXIT_LINE = TOWN_PLAYABLE_WORLD_BOUND - 4

/** Nearest legal edge, with stable tie-breaking. Each native owner retains its movement/cleanup. */
export function townRetirementExitPoint(position: { x: number; z: number }): { x: number; z: number } {
  const edge = TOWN_RETIREMENT_EXIT_LINE
  const clamp = (value: number) => Math.max(-edge, Math.min(edge, value))
  return Math.abs(position.x) > Math.abs(position.z)
    ? { x: position.x < 0 ? -edge : edge, z: clamp(position.z) }
    : { x: clamp(position.x), z: position.z < 0 ? -edge : edge }
}
