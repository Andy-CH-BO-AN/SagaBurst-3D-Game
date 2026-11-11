import type * as THREE from 'three'
import { XONGKORO } from './XongkoroConfig'

/**
 * Scene-owned rule for ordinary ground falls (walking or riding off a ledge).
 * Scenes without a policy keep their original jump rules: no ground-fall damage.
 */
export interface GroundFallPolicy {
  /** Falls up to this height (m) cost nothing, e.g. stairs, ledges and jump landings. */
  readonly safeHeight: number
  /** Falls at or above this height are lethal; shares the aerial fall threshold. */
  readonly lethalHeight: number
}

export const ARENA_GROUND_FALL_POLICY: GroundFallPolicy = Object.freeze({
  safeHeight: 6,
  lethalHeight: XONGKORO.fallLethalHeight,
})

const sceneGroundFallPolicies = new WeakMap<THREE.Scene, GroundFallPolicy>()

export function setSceneGroundFallPolicy(scene: THREE.Scene, policy: GroundFallPolicy | null): void {
  if (policy) sceneGroundFallPolicies.set(scene, policy)
  else sceneGroundFallPolicies.delete(scene)
}

export function getSceneGroundFallPolicy(scene: THREE.Scene): GroundFallPolicy | null {
  return sceneGroundFallPolicies.get(scene) ?? null
}

/** Exact HP loss for a landed fall; linear from safe to lethal height, never rounded. */
export function groundFallDamage(maxHp: number, height: number, policy: GroundFallPolicy): number {
  if (!(height > policy.safeHeight)) return 0
  const span = Math.max(1e-6, policy.lethalHeight - policy.safeHeight)
  return maxHp * Math.min(1, (height - policy.safeHeight) / span)
}

/**
 * Tracks the highest support-free foot height between losing and regaining
 * ground contact. observe() returns the fall height exactly once per landing.
 */
export class GroundFallTracker {
  private apexY: number | null = null

  observe(feetY: number, grounded: boolean): number | null {
    if (!grounded) {
      this.apexY = this.apexY === null ? feetY : Math.max(this.apexY, feetY)
      return null
    }
    if (this.apexY === null) return null
    const height = Math.max(0, this.apexY - feetY)
    this.apexY = null
    return height
  }

  /** Teleports and scene resets must not turn into a landing. */
  reset(): void { this.apexY = null }

  /**
   * Mounting or dismounting in mid-air keeps the fall that is already under way:
   * the other body's tracker continues from this apex and this one is cleared.
   * With no fall in progress the target is simply reset.
   */
  handOffTo(target: GroundFallTracker, feetY: number): void {
    target.apexY = this.apexY === null ? null : Math.max(this.apexY, feetY)
    this.apexY = null
  }
}
