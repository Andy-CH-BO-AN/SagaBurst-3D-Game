import type { PhysicalCombatTarget } from './ShieldBlocking'
import type { CombatTargetRef } from './CombatAttribution'

/** Non-actor targets share the normal contact queries and damage event route. */
export interface DamageReceiver extends PhysicalCombatTarget {
  readonly damageTarget: CombatTargetRef
  receiveDamage(amount: number): number
}

export function isDamageReceiver(target: PhysicalCombatTarget): target is DamageReceiver {
  return 'damageTarget' in target && 'receiveDamage' in target
}
