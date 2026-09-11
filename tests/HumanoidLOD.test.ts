import { describe, it, expect } from 'vitest'
import {
  HUMANOID_LOD_DISTANCES,
  HUMANOID_ANIMATION_THROTTLE_DISTANCE,
} from '../src/world/HumanoidAssetRegistry'

describe('Humanoid LOD Distances and Animation Throttle', () => {
  it('defines HUMANOID_LOD_DISTANCES as [0, 28, 60] for 0-28m LOD0, 28-60m LOD1, >60m LOD2', () => {
    expect(HUMANOID_LOD_DISTANCES).toEqual([0, 28, 60])
    expect(HUMANOID_LOD_DISTANCES[0]).toBe(0)
    expect(HUMANOID_LOD_DISTANCES[1]).toBe(28)
    expect(HUMANOID_LOD_DISTANCES[2]).toBe(60)
  })

  it('keeps HUMANOID_ANIMATION_THROTTLE_DISTANCE semantic constant at 28m decoupled from LOD policy', () => {
    expect(HUMANOID_ANIMATION_THROTTLE_DISTANCE).toBe(28)
  })
})
