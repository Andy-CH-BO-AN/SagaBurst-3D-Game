import { describe, expect, it } from 'vitest'
import { resolveMeleeHitThreshold, MOUNTED_MELEE_HIT_TOLERANCE } from '../src/Game'
import { WEAPONS } from '../src/rpg/WeaponDatabase'

describe('Mounted Melee Hit Tolerance', () => {
  it('keeps base hit threshold for unmounted targets', () => {
    const swordRange = WEAPONS['steel_sword'].range!
    expect(resolveMeleeHitThreshold(swordRange, false)).toBe(1.8)
  })

  it('adds mounted melee tolerance for mounted targets within 2.2–2.4m', () => {
    const swordRange = WEAPONS['steel_sword'].range!
    const mountedThreshold = resolveMeleeHitThreshold(swordRange, true)
    expect(mountedThreshold).toBe(1.8 + MOUNTED_MELEE_HIT_TOLERANCE)
    expect(mountedThreshold).toBeCloseTo(2.3, 2)
    expect(mountedThreshold).toBeGreaterThanOrEqual(2.2)
    expect(mountedThreshold).toBeLessThanOrEqual(2.4)
  })

  it('reverts back to unmounted threshold once target is dismounted', () => {
    const defaultRange = 1.85
    expect(resolveMeleeHitThreshold(defaultRange, true)).toBe(2.35)
    expect(resolveMeleeHitThreshold(defaultRange, false)).toBe(1.85)
  })
})
