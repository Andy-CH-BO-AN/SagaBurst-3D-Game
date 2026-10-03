import type { HorseAnimationState } from './HorseAssetRegistry'

export const QUADRUPED_REQUIRED_CLIPS = ['idle', 'walk', 'run', 'death'] as const
export const QUADRUPED_STUDIO_CLIPS = [...QUADRUPED_REQUIRED_CLIPS, 'jump', 'land', 'hit'] as const

export type QuadrupedAnimationState = typeof QUADRUPED_STUDIO_CLIPS[number]
export type QuadrupedLocomotionState = Extract<QuadrupedAnimationState, 'idle' | 'walk' | 'run'>
export type QuadrupedOneShotState = Exclude<QuadrupedAnimationState, QuadrupedLocomotionState>
export type MountAnimationState = HorseAnimationState | QuadrupedAnimationState

export function isQuadrupedAnimationState(state: string): state is QuadrupedAnimationState {
  return state === 'idle' || state === 'walk' || state === 'run' || state === 'death'
    || state === 'jump' || state === 'land' || state === 'hit'
}

/** Separate entry/exit speeds prevent collision and deceleration jitter changing gait every frame. */
export function quadrupedLocomotionClipForSpeed(speed: number, previous: QuadrupedLocomotionState): QuadrupedLocomotionState {
  if (!Number.isFinite(speed) || speed < (previous === 'idle' ? .2 : .1)) return 'idle'
  if (speed >= (previous === 'run' ? 5 : 6)) return 'run'
  return 'walk'
}
