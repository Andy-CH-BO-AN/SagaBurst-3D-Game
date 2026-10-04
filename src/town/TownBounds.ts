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
