import type { CombatAction } from '../world/CharacterCombatAnimator'

export interface RangedAimState {
  /** Drawing or holding a fresh projectile. */
  readonly aiming: boolean
  /** Over-the-shoulder ranged camera and HUD. */
  readonly viewActive: boolean
  readonly requiresRmbRelease: boolean
}

const resolved: { aiming: boolean; viewActive: boolean; requiresRmbRelease: boolean } = {
  aiming: false, viewActive: false, requiresRmbRelease: false,
}

/**
 * Bow recovery blocks another draw but keeps the held aim view; releasing RMB
 * leaves it at once. A pilum keeps its view until its projectile event ends it,
 * and its RMB lock clears only once RMB is up outside a ranged release.
 * The per-frame Player path allocates nothing: the result is one shared
 * object, valid until the next call.
 * @param action the animator's current action.
 * @param wantAim RMB is held with a ranged weapon and no shield equipped.
 * @param requiresRmbRelease a throw demands a fresh RMB press before aiming again.
 * @param viewActive the aim view shown before this frame.
 */
export function resolveRangedAim(action: CombatAction, rightMouseDown: boolean, wantAim: boolean,
  requiresRmbRelease: boolean, swinging: boolean, viewActive: boolean): RangedAimState {
  const rangedReleasing = action === 'bowRelease' || action === 'pilumThrow'
  const locked = requiresRmbRelease && (rightMouseDown || rangedReleasing)
  const canAim = wantAim && !locked && !swinging
  resolved.aiming = canAim && !rangedReleasing
  resolved.viewActive = action === 'pilumThrow' ? viewActive : canAim
  resolved.requiresRmbRelease = locked
  return resolved
}
