import { describe, expect, it } from 'vitest'
import { HorseLandingAnimation } from '../../src/world/HorseLandingAnimation'

describe('horse landing animation contact history', () => {

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

})
