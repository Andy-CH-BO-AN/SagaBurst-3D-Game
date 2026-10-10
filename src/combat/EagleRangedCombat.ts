import type { WeaponData } from '../rpg/WeaponDatabase'

/** AI maximum fire distance only; ammunition keeps its real weapon speed. */
export const EAGLE_BOW_ENGAGEMENT_RANGE_BY_TIER = { 1: 200, 2: 300, 3: 400, 4: 500 } as const

export function eagleBowEngagementRange(
  mountType: string | undefined,
  weapon: Pick<WeaponData, 'type' | 'combatKind' | 'tier'> | undefined,
): number | undefined {
  if (mountType !== 'xongkoro' || weapon?.type !== 'ranged' || weapon.combatKind !== 'bow') return undefined
  return EAGLE_BOW_ENGAGEMENT_RANGE_BY_TIER[weapon.tier]
}
