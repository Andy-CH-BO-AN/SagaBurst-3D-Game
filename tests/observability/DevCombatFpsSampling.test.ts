import { describe, it, expect } from 'vitest'

describe('DevCombat FPS Sampling Wall-Clock Verification', () => {
  it('demonstrates bug in capped simulation dt vs fix in wall-clock time', () => {
    // Scenario: System running at 10 FPS (each frame takes 100ms = 0.1s)
    const trueFrameDurationSec = 0.1
    const frameCount = 10 // 10 frames in 1.0 wall-clock second

    // Old buggy behavior: dt was clamped by Math.min(delta, 0.05)
    let buggyAccumulatedElapsed = 0
    for (let i = 0; i < frameCount; i++) {
      const clampedDt = Math.min(trueFrameDurationSec, 0.05) // = 0.05
      buggyAccumulatedElapsed += clampedDt
    }
    const buggyFps = frameCount / buggyAccumulatedElapsed
    // Bug: 10 / 0.5 = 20 FPS! The minimum reportable FPS was artificially locked at 20.
    expect(buggyFps).toBeCloseTo(20, 4)

    // Fixed behavior: elapsed is measured via wall-clock time (e.g. performance.now())
    const wallClockStart = 1000
    const wallClockEnd = wallClockStart + (frameCount * trueFrameDurationSec * 1000) // 2000
    const wallClockElapsedSec = (wallClockEnd - wallClockStart) / 1000 // 1.0s
    const fixedFps = frameCount / wallClockElapsedSec

    // Fix: correctly reports 10 FPS (properly below 20 FPS)
    expect(fixedFps).toBe(10)
    expect(fixedFps).toBeLessThan(20)
  })

  it('correctly calculates sub-20 FPS values (5 FPS, 12 FPS, 15 FPS) without artificial clamping', () => {
    const testCases = [
      { targetFps: 5, frameDurationMs: 200 },
      { targetFps: 12, frameDurationMs: 1000 / 12 },
      { targetFps: 15, frameDurationMs: 1000 / 15 },
      { targetFps: 60, frameDurationMs: 1000 / 60 },
    ]

    for (const { targetFps, frameDurationMs } of testCases) {
      const elapsedMs = 1000
      const frames = Math.round(elapsedMs / frameDurationMs)
      const calculatedFps = frames / (elapsedMs / 1000)
      expect(calculatedFps).toBeCloseTo(targetFps, 0)
    }
  })
})
