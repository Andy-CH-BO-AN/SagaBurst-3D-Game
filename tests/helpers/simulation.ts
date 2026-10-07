export interface AdvanceUntilOptions {
  maxFrames?: number
  maxSimulationSeconds?: number
  secondsPerStep?: number
  failureMessage?: string
}

/** Advance deterministic simulation steps until a state is reached or an explicit bound expires. */
export function advanceUntil(
  condition: () => boolean,
  step: () => void,
  options: AdvanceUntilOptions,
): number {
  const { maxFrames, maxSimulationSeconds, secondsPerStep = 1 / 60 } = options
  const secondsLimit = maxSimulationSeconds === undefined
    ? Number.POSITIVE_INFINITY
    : Math.ceil(maxSimulationSeconds / secondsPerStep)
  const frameLimit = maxFrames === undefined ? secondsLimit : Math.min(maxFrames, secondsLimit)
  if (!Number.isFinite(frameLimit) || frameLimit < 0) {
    throw new Error('advanceUntil requires a finite maxFrames or maxSimulationSeconds limit')
  }

  let frames = 0
  while (!condition() && frames < frameLimit) {
    step()
    frames++
  }
  if (!condition()) {
    const label = options.failureMessage ? ` (${options.failureMessage})` : ''
    throw new Error(`Condition was not reached after ${frames} frames${label}`)
  }
  return frames
}
