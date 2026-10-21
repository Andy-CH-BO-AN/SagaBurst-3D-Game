export interface HeroFrameSummary {
  sampleCount: number
  durationMs: number
  meanFps: number
  onePercentLowFps: number
  meanFrameMs: number
  p95FrameMs: number
}

export function summarizeHeroFrames(frameMs: readonly number[]): HeroFrameSummary {
  if (!frameMs.length || frameMs.some(ms => !Number.isFinite(ms) || ms <= 0)) throw new Error('Frame intervals must be positive finite samples')
  const sorted = [...frameMs].sort((a, b) => a - b)
  const durationMs = frameMs.reduce((sum, ms) => sum + ms, 0)
  const slowest = sorted.slice(-Math.ceil(sorted.length * .01))
  return {
    sampleCount: frameMs.length, durationMs, meanFps: frameMs.length * 1000 / durationMs,
    onePercentLowFps: 1000 / (slowest.reduce((sum, ms) => sum + ms, 0) / slowest.length),
    meanFrameMs: durationMs / frameMs.length, p95FrameMs: sorted[Math.ceil(sorted.length * .95) - 1],
  }
}

export function compareHeroFrameSummaries(baseline: HeroFrameSummary, candidate: HeroFrameSummary) {
  const ratios = { meanFps: candidate.meanFps / baseline.meanFps,
    onePercentLowFps: candidate.onePercentLowFps / baseline.onePercentLowFps,
    p95FrameMs: candidate.p95FrameMs / baseline.p95FrameMs }
  const finite = Object.values(ratios).every(Number.isFinite)
  return { ratios, passed: finite && ratios.meanFps >= .9 && ratios.onePercentLowFps >= .9 && ratios.p95FrameMs <= 1.1,
    nearBoundary: !finite || Math.abs(ratios.meanFps - .9) <= .02 || Math.abs(ratios.onePercentLowFps - .9) <= .02 || Math.abs(ratios.p95FrameMs - 1.1) <= .02 }
}
