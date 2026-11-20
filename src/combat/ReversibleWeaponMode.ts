/** A ranged-active hybrid keeps shooting until a melee threat is inside this distance. */
export const RANGED_ATTACK_MIN = 6.0
/** A melee-active hybrid re-equips ranged only once every threat is at least this far. */
export const RANGED_REEQUIP_MIN = RANGED_ATTACK_MIN + 3

export type ReversibleWeaponMode = 'ranged' | 'melee'

export interface WeaponModeDecisionGate {
  readonly hasRangedWeapon: boolean
  readonly hasMeleeWeapon: boolean
  /** A committed release or swing is still playing. */
  readonly busy: boolean
  readonly arrows: number
  readonly rangedActive: boolean
}

/**
 * Whether a hybrid should evaluate its weapon mode this frame. Callers check it
 * before any threat scan: committed actions finish first, and a melee fighter
 * with no ammunition has nothing to switch to.
 */
export function needsWeaponModeDecision(gate: WeaponModeDecisionGate): boolean {
  if (!gate.hasRangedWeapon || !gate.hasMeleeWeapon || gate.busy) return false
  return !(gate.arrows <= 0 && !gate.rangedActive)
}

export interface ReversibleWeaponModeInput {
  readonly arrows: number
  readonly rangedActive: boolean
  /** Squared distance to the nearest hostile that can reach melee contact; Infinity when none. */
  readonly threatDistanceSq: number
  /** Squared distance to the live selected target; null when there is none. */
  readonly targetDistanceSq: number | null
  readonly maxRangedAttackDistance: number
}

/**
 * Hysteresis between the two modes: ranged stays active while threats remain
 * beyond RANGED_ATTACK_MIN, and melee re-equips ranged only when every threat
 * is at RANGED_REEQUIP_MIN or more and a live target is within bow range.
 * A ranged re-equip still needs the caller's clear-shot check.
 */
export function chooseReversibleWeaponMode(input: ReversibleWeaponModeInput): ReversibleWeaponMode {
  if (!(input.arrows > 0)) return 'melee'
  if (input.rangedActive) return input.threatDistanceSq > RANGED_ATTACK_MIN ** 2 ? 'ranged' : 'melee'
  return input.threatDistanceSq >= RANGED_REEQUIP_MIN ** 2 && input.targetDistanceSq !== null
    && input.targetDistanceSq <= input.maxRangedAttackDistance ** 2 ? 'ranged' : 'melee'
}

/**
 * Reach and mount gate for one hostile before any navigation-topology check:
 * inside re-equip reach, within melee height, and not ridden by an eagle that
 * cannot currently dive into melee.
 */
export function withinRangedMeleeThreatReach(
  self: { readonly x: number; readonly y: number; readonly z: number },
  other: { readonly x: number; readonly y: number; readonly z: number },
  meleeAttackRadius: number, canReachMelee: boolean,
): boolean {
  const dx = other.x - self.x, dy = other.y - self.y, dz = other.z - self.z
  if (dx * dx + dy * dy + dz * dz > RANGED_REEQUIP_MIN ** 2 || Math.abs(dy) > meleeAttackRadius) return false
  return canReachMelee
}
