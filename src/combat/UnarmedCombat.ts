import * as THREE from 'three'
import { applyHeroMeleeDamage, HERO_COMBAT_PROFILE_BY_ASSET } from '../battle/HeroCombatProfile'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { segmentBoxTime, traceCombatSegment, type CombatContact, type PhysicalCombatTarget } from './ShieldBlocking'
import type { ObstacleData } from '../world/Terrain'

export const UNARMED_DAMAGE = 5
export const UNARMED_RANGE = .8
export const UNARMED_DURATION = 1.6
export type PunchHand = 'left' | 'right'
/** Procedural fallback's actual contact peaks; replace together with the imported clip, never independently. */
export const PUNCH_CONTACT_TIMES = [.18, .58, .98, 1.38] as const
export interface PunchEvent { index: number; hand: PunchHand; time: number }
export interface FistStrike { from: THREE.Vector3; to: THREE.Vector3 }

export function punchEventsBetween(previous: number, next: number, shield: boolean): PunchEvent[] {
  return PUNCH_CONTACT_TIMES.flatMap((time, index) => previous < time && next >= time
    ? [{ index, hand: shield || index % 2 === 0 ? 'right' as const : 'left' as const, time }] : [])
}

export function punchExtension(elapsed: number, hand: PunchHand, shield: boolean): number {
  const index = Math.min(3, Math.floor(Math.max(0, elapsed) / .4))
  if (hand !== (shield || index % 2 === 0 ? 'right' : 'left')) return 0
  const phase = elapsed - index * .4
  const t = phase <= .18 ? phase / .18 : 1 - (phase - .18) / .22
  const clamped = Math.max(0, Math.min(1, t))
  return clamped * clamped * (3 - 2 * clamped)
}

export function unarmedDamage(skillMultiplier: number, hero?: HeroAssetId | null): number {
  return applyHeroMeleeDamage(UNARMED_DAMAGE * skillMultiplier, hero ? HERO_COMBAT_PROFILE_BY_ASSET[hero] : null)
}

/** A small fist volume swept along the sampled hand path. No weapon endpoints, charge, or structure damage. */
export function traceFistStrike(strike: FistStrike, origin: THREE.Vector3, targets: readonly PhysicalCombatTarget[],
  obstacles: readonly ObstacleData[]): CombatContact | undefined {
  const from = strike.from.clone(), to = strike.to.clone()
  let best: CombatContact | undefined
  const candidate: CombatContact = { kind: 'body', time: Infinity }
  // Radius samples stay on the physical palm; the shield/body query owns defense and armor.
  for (const [x, y, z] of [[0, 0, 0], [.055, 0, 0], [-.055, 0, 0], [0, .055, 0], [0, -.055, 0], [0, 0, .055]]) {
    const a = from.clone().add(new THREE.Vector3(x, y, z)), b = to.clone().add(new THREE.Vector3(x, y, z))
    let blocked = Infinity
    for (const obstacle of obstacles) blocked = Math.min(blocked, segmentBoxTime(a, b, obstacle.box))
    for (const target of targets) {
      if (target.combatPosition.distanceToSquared(origin) > 16) continue
      if (traceCombatSegment(target, a, b, candidate) && candidate.time < blocked
        && Math.hypot(a.x + (b.x - a.x) * candidate.time - origin.x, a.z + (b.z - a.z) * candidate.time - origin.z) <= UNARMED_RANGE
        && (!best || candidate.time < best.time)) best = { ...candidate }
    }
  }
  return best ? { ...best, attackSource: 'unarmed' } : undefined
}
