import { describe, expect, it } from 'vitest'
import { FarAnimationCadence } from '../../src/world/CharacterLODPolicy'

describe('FarAnimationCadence', () => {
  it('staggers initial fire frames across phases while passing exact real elapsed dt to mixers', () => {
    const interval = 1 / 6
    const dt = 1 / 60
    const cadences = [0.05, 0.35, 0.70, 0.95].map(phase => new FarAnimationCadence(phase))
    const firstFireFrame: number[] = [-1, -1, -1, -1]
    const totalConsumedDt: number[] = [0, 0, 0, 0]

    for (let frame = 0; frame < 30; frame++) {
      for (let i = 0; i < cadences.length; i++) {
        const step = cadences[i].advance(dt, interval)
        if (step !== null) {
          if (firstFireFrame[i] === -1) firstFireFrame[i] = frame
          totalConsumedDt[i] += step
        }
      }
    }

    // Distinct phases trigger on different initial frames instead of bursting on frame 10.
    expect(new Set(firstFireFrame).size).toBe(4)
    expect(firstFireFrame[0]).toBeGreaterThan(firstFireFrame[3])

    // Transitioning back to full-rate (interval = 0) flushes exact accumulated real dt without phase inflation.
    for (let i = 0; i < cadences.length; i++) {
      const flush = cadences[i].advance(dt, 0)
      expect(flush).not.toBeNull()
      totalConsumedDt[i] += flush!
      expect(totalConsumedDt[i]).toBeCloseTo(31 * dt, 10)
    }

    // reset() restores un-armed state cleanly.
    cadences[0].reset()
    expect(cadences[0].advance(dt, 0)).toBeCloseTo(dt, 10)
  })
})
