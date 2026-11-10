import { WEAPONS } from '../rpg/WeaponDatabase'

/** Pure shield-break rules, kept free of scene dependencies so UI can reuse exactly what combat applies. */
export const SHIELD_CONFIG = {
  axeImpactByTier: { 1: 2, 2: 4, 3: 8 },
  mountedLanceImpactByTier: { 1: 10, 2: 20, 3: 40, 4: 60, 5: 80 },
  xpPerBlockedImpact: 20,
} as const
export function weaponShieldImpact(id?: string, isMounted = false): number {
  const weapon = WEAPONS[id ?? '']
  if (weapon?.shieldImpact !== undefined) return weapon.shieldImpact
  if (!weapon) return 1
  if (weapon.animationKind === 'axe') return (SHIELD_CONFIG.axeImpactByTier as Readonly<Partial<Record<number, number>>>)[weapon.tier] ?? 1
  if (isMounted && weapon.combatKind === 'lance') return (SHIELD_CONFIG.mountedLanceImpactByTier as Readonly<Partial<Record<number, number>>>)[weapon.tier] ?? 1
  return 1
}
