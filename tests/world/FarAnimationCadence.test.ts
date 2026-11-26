import { describe, expect, it } from 'vitest'
import {
  FarAnimationCadence,
  OFF_FRUSTUM_ANIMATION_DISTANCE,
  OFF_FRUSTUM_ANIMATION_INTERVAL,
  OFF_FRUSTUM_VISUAL_SLEEP_DISTANCE,
  humanoidPoseInterval,
  mountAnimationInterval,
} from '../../src/world/CharacterLODPolicy'

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

    // Throttles off-frustum humanoids/mounts in 12m-35m, pauses >35m visual sleep, and flushes on entry.
    expect(humanoidPoseInterval(OFF_FRUSTUM_ANIMATION_DISTANCE, false)).toBe(0)
    expect(mountAnimationInterval(OFF_FRUSTUM_ANIMATION_DISTANCE, false)).toBe(0)
    expect(humanoidPoseInterval(20, false)).toBe(OFF_FRUSTUM_ANIMATION_INTERVAL)
    expect(mountAnimationInterval(20, false)).toBe(OFF_FRUSTUM_ANIMATION_INTERVAL)
    expect(humanoidPoseInterval(OFF_FRUSTUM_VISUAL_SLEEP_DISTANCE + 5, false)).toBe(Infinity)
    expect(mountAnimationInterval(OFF_FRUSTUM_VISUAL_SLEEP_DISTANCE + 5, false)).toBe(Infinity)
    expect(humanoidPoseInterval(40, true)).toBeLessThan(OFF_FRUSTUM_ANIMATION_INTERVAL)
    expect(mountAnimationInterval(40, true)).toBeLessThan(OFF_FRUSTUM_ANIMATION_INTERVAL)

    const offFrustumCadence = new FarAnimationCadence(0.5)
    expect(offFrustumCadence.wouldDefer(Infinity, dt)).toBe(true)
    expect(offFrustumCadence.advance(dt, OFF_FRUSTUM_ANIMATION_INTERVAL)).toBeNull()
    expect(offFrustumCadence.advance(dt, Infinity)).toBeNull()
    expect(offFrustumCadence.advance(dt, 0)).toBeCloseTo(3 * dt, 10)
  })
})
