import * as THREE from 'three'
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

/** Source feline exports key every bone's position/quaternion/scale, including unit scales and
 * unmoved bones that only carry float noise below this bound (measured up to ~1e-6). */
export const NEAR_REST_TRACK_TOLERANCE = 1e-6

/** Bind value of the property a track drives (`bone.position` etc.), or undefined if unknown. */
export type TrackRestLookup = (trackName: string) => ArrayLike<number> | undefined

/** The keyframe data the filter reads; Three's KeyframeTrack satisfies it. */
export interface RestTrackSample {
  readonly name: string
  readonly values: ArrayLike<number>
  getValueSize(): number
  getInterpolation(): number
}

/**
 * Names of properties that every clip holds within `tolerance` of their bind value (q and -q count
 * as the same rotation). Without a track the mixer leaves the property at bind, so dropping these
 * moves the pose by at most `tolerance`; any property that moves further in any clip is kept, as are
 * smooth-interpolated and unknown properties.
 */
export function nearRestTrackNames(clips: readonly { readonly tracks: readonly RestTrackSample[] }[],
  restOf: TrackRestLookup, tolerance = NEAR_REST_TRACK_TOLERANCE): Set<string> {
  const removable = new Map<string, boolean>()
  for (const clip of clips) for (const track of clip.tracks) {
    if (removable.get(track.name) === false) continue
    removable.set(track.name, staysNearRest(track, restOf(track.name), tolerance))
  }
  return new Set([...removable].filter(([, near]) => near).map(([name]) => name))
}

function staysNearRest(track: RestTrackSample, rest: ArrayLike<number> | undefined, tolerance: number): boolean {
  const size = track.getValueSize(), values = track.values
  if (!rest || rest.length !== size || track.getInterpolation() === THREE.InterpolateSmooth) return false
  const quaternion = track.name.endsWith('.quaternion')
  for (let key = 0; key < values.length; key += size) {
    let same = 0, flipped = 0
    for (let i = 0; i < size; i++) {
      same = Math.max(same, Math.abs(values[key + i] - rest[i]))
      if (quaternion) flipped = Math.max(flipped, Math.abs(values[key + i] + rest[i]))
    }
    if (!(same <= tolerance || quaternion && flipped <= tolerance)) return false
  }
  return true
}
