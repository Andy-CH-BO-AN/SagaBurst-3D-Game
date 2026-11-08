import { ShieldState, weaponShieldImpact } from './ShieldBlocking'
import type { CombatDamageContext } from './CombatAttribution'

export function mountArmorImpactMax(type: string): number {
  return type === 'ARMORED_HORSE' || type === 'SNOW_LEOPARD' ? 50 : 0
}

/** Mount barding owns durability independently of the rider's equipped shield. */
export class MountArmor {
  private readonly state = new ShieldState()
  constructor(type: string) {
    this.state.shieldImpactMax = mountArmorImpactMax(type)
    this.state.reset()
  }
  get max(): number { return this.state.shieldImpactMax }
  get remaining(): number { return this.state.shieldImpactRemaining }
  restore(value?: number): void {
    this.state.shieldImpactRemaining = value === undefined ? this.max
      : Number.isFinite(value) ? Math.max(0, Math.min(this.max, value)) : 0
  }
  reset(): void { this.state.reset() }
  absorbWeapon(damage: number, context?: CombatDamageContext): { damage: number; blockedImpact: number } {
    if (!context || context.method !== 'melee' && context.method !== 'projectile'
      || (context.attackSource ?? context.contact?.attackSource) === 'xongkoro') return { damage, blockedImpact: 0 }
    return this.state.absorb(damage, weaponShieldImpact(context.weaponId, context.source.isMounted))
  }
}

export function mountImpactMultiplier(type: string): number {
  return type === 'ARMORED_HORSE' || type === 'SNOW_LEOPARD' ? 2.5 : 1
}
