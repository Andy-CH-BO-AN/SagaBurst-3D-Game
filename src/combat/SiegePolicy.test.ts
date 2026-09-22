import { describe, expect, it } from 'vitest'
import {
  getSiegeFallbackDelay,
  isFortificationKind,
  SIEGE_STRUCTURE_STUCK_SECONDS,
  SIEGE_TREE_STUCK_SECONDS,
} from './SiegePolicy'

describe('SiegePolicy', () => {
  it('classifies defensive works as immediate direct blockers', () => {
    expect(isFortificationKind('gate')).toBe(true)
    expect(isFortificationKind('palisade')).toBe(true)
    expect(isFortificationKind('chevaux_de_frise')).toBe(true)
  })

  it('keeps camp and natural obstacles out of immediate fortification targeting', () => {
    expect(isFortificationKind('tree')).toBe(false)
    expect(isFortificationKind('tent')).toBe(false)
    expect(isFortificationKind('campfire')).toBe(false)
  })

  it('keeps ordinary camp obstacles as delayed navigation fallbacks', () => {
    expect(getSiegeFallbackDelay('tent')).toBe(SIEGE_STRUCTURE_STUCK_SECONDS)
    expect(getSiegeFallbackDelay('campfire')).toBe(SIEGE_STRUCTURE_STUCK_SECONDS)
  })

  it('makes trees the lowest-priority destruction fallback', () => {
    expect(getSiegeFallbackDelay('tree')).toBe(SIEGE_TREE_STUCK_SECONDS)
    expect(SIEGE_TREE_STUCK_SECONDS).toBeGreaterThan(SIEGE_STRUCTURE_STUCK_SECONDS)
  })
})
