import { describe, expect, it } from 'vitest'
import {
  getSiegeFallbackDelay,
  SIEGE_STRUCTURE_STUCK_SECONDS,
  SIEGE_TREE_STUCK_SECONDS,
} from './SiegePolicy'

describe('SiegePolicy', () => {
  it('keeps structures as a delayed fallback instead of immediate targets', () => {
    expect(getSiegeFallbackDelay('gate')).toBe(SIEGE_STRUCTURE_STUCK_SECONDS)
    expect(getSiegeFallbackDelay('palisade')).toBe(SIEGE_STRUCTURE_STUCK_SECONDS)
    expect(getSiegeFallbackDelay('tent')).toBe(SIEGE_STRUCTURE_STUCK_SECONDS)
    expect(getSiegeFallbackDelay('campfire')).toBe(SIEGE_STRUCTURE_STUCK_SECONDS)
  })

  it('makes trees a lower-priority destruction fallback', () => {
    expect(getSiegeFallbackDelay('tree')).toBe(SIEGE_TREE_STUCK_SECONDS)
    expect(SIEGE_TREE_STUCK_SECONDS).toBeGreaterThan(SIEGE_STRUCTURE_STUCK_SECONDS)
  })
})
