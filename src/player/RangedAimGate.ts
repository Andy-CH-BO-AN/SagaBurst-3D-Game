import type { CombatAction } from '../world/CharacterCombatAnimator'

export interface RangedAimInput {
  /** The animator's current action. */
  readonly action: CombatAction
  readonly rightMouseDown: boolean
  /** RMB is held with a ranged weapon and no shield equipped. */
  readonly wantAim: boolean
  /** A throw demands a fresh RMB press before aiming again. */
  readonly requiresRmbRelease: boolean
  readonly swinging: boolean
  /** The aim view shown before this frame. */
  readonly viewActive: boolean
}

export interface RangedAimState {
  /** Drawing or holding a fresh projectile. */
  readonly aiming: boolean
  /** Over-the-shoulder ranged camera and HUD. */
  readonly viewActive: boolean
  readonly requiresRmbRelease: boolean
}

/**
 * Bow recovery blocks another draw but keeps the held aim view; releasing RMB
 * leaves it at once. A pilum keeps its view until its projectile event ends it,
 * and its RMB lock clears only once RMB is up outside a ranged release.
 */
export function resolveRangedAim(input: RangedAimInput): RangedAimState {
  const rangedReleasing = input.action === 'bowRelease' || input.action === 'pilumThrow'
  const requiresRmbRelease = input.requiresRmbRelease && (input.rightMouseDown || rangedReleasing)
  const canAim = input.wantAim && !requiresRmbRelease && !input.swinging
  return {
    aiming: canAim && !rangedReleasing,
    viewActive: input.action === 'pilumThrow' ? input.viewActive : canAim,
    requiresRmbRelease,
  }
}
