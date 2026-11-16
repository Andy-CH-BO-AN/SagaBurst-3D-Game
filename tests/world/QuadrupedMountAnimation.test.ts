import { describe, expect, it } from 'vitest'
import { NEAR_REST_TRACK_TOLERANCE, nearRestTrackNames, type RestTrackSample } from '../../src/world/QuadrupedMountAnimation'

const LINEAR = 2301, SMOOTH = 2302
const track = (name: string, values: number[], interpolation = LINEAR): RestTrackSample => ({
  name, values, getValueSize: () => name.endsWith('.quaternion') ? 4 : 3, getInterpolation: () => interpolation,
})

describe('quadruped runtime clip tracks', () => {
  it('drops only properties every clip holds at bind within tolerance, keeping moved, offset, smooth and unknown ones', () => {
    const noise = NEAR_REST_TRACK_TOLERANCE / 2
    const rest: Record<string, number[]> = {
      'paw.scale': [1, 1, 1], 'paw.quaternion': [0, 0, 0, 1], 'spine.quaternion': [0, 0, 0, 1],
      'tail.position': [0, .2, 0], 'ear.position': [0, .1, 0], 'jaw.position': [0, 0, 0],
    }
    const idle = { tracks: [
      track('paw.scale', [1 + noise, 1, 1 - noise, 1, 1, 1]),
      // -q is the same rotation as the bind quaternion.
      track('paw.quaternion', [0, 0, 0, -1, 0, 0, noise, -1]),
      track('spine.quaternion', [0, 0, 0, 1, 0, 0, 0, 1]),
      // Constant, but held away from bind: removing it would move the bone.
      track('tail.position', [0, .3, 0, 0, .3, 0]),
      track('mane.position', [0, 0, 0]),
      track('jaw.position', [0, 0, 0], SMOOTH),
    ] }
    const run = { tracks: [
      track('paw.scale', [1, 1, 1]),
      // Moves beyond tolerance in one clip only: the property stays in every clip.
      track('spine.quaternion', [0, 0, 0, 1, 0, Math.sin(.05), 0, Math.cos(.05)]),
      track('ear.position', [0, .1, 0, 0, .1 + NEAR_REST_TRACK_TOLERANCE * 2, 0]),
    ] }
    expect([...nearRestTrackNames([idle, run], name => rest[name])].sort()).toEqual(['paw.quaternion', 'paw.scale'])
  })
})
