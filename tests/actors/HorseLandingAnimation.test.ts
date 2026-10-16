import { describe, expect, it } from 'vitest'
import { HorseLandingAnimation } from '../../src/world/HorseLandingAnimation'

describe('horse landing animation contact history', () => {
  it('plays an intentional jump landing even below the natural-fall threshold', () => {
    const landing = new HorseLandingAnimation()
    landing.update(0.016, true, 1, false)
    expect(landing.update(0.016, false, 1.05, true)).toBe(false)
    expect(landing.update(0.016, true, 1, true)).toBe(true)
    expect(landing.update(0.016, true, 1, false)).toBe(false)
  })

  it('plays once after a real uncommanded fall, but not on spawn or reset', () => {
    const landing = new HorseLandingAnimation()
    landing.update(0.3, false, 4, false)
    expect(landing.update(0.016, true, 3, false)).toBe(false)
    landing.update(0.08, false, 2.94, false)
    landing.update(0.08, false, 2.72, false)
    expect(landing.update(0.016, true, 2.6, false)).toBe(true)
    expect(landing.update(0.016, true, 2.6, false)).toBe(false)
    landing.update(0.2, false, 2.1, false)
    landing.reset()
    expect(landing.update(0.016, true, 1, false)).toBe(false)
  })

  it('does not accumulate gentle-slope contact gaps into repeated land events', () => {
    const landing = new HorseLandingAnimation()
    landing.update(0.016, true, 10, false)
    for (let i = 0; i < 20; i++) {
      const height = 10 - i * 0.04
      expect(landing.update(0.04, false, height, false)).toBe(false)
      expect(landing.update(0.016, true, height - 0.04, false)).toBe(false)
    }
    // Duration alone is insufficient when the support surface barely changes.
    landing.update(0.2, false, 9.2, false)
    expect(landing.update(0.016, true, 9.18, false)).toBe(false)
  })
})
