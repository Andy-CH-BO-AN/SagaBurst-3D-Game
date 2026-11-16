import { describe, expect, it } from 'vitest'
import { Matrix4 } from 'three'
import { xongkoroMeshLocalSphere } from '../../src/world/XongkoroRenderBounds'

describe('Xongkoro conservative render bounds', () => {
  it('conservatively transforms a sphere through a translated, scaled shear without sharing it', () => {
    const bounds = { center: [1, 2, 3] as [number, number, number], radius: 2 }
    const transform = new Matrix4().set(2, 1, 0, 4, 0, 3, 0, -2, 0, 0, .5, 1, 0, 0, 0, 1)
    const local = xongkoroMeshLocalSphere(bounds, transform)
    expect(local.center.toArray()).toEqual([8, 4, 2.5])
    // Largest singular value of this 2x2 shear is sqrt(7 + sqrt(13)).
    expect(local.radius).toBeGreaterThanOrEqual(2 * Math.sqrt(7 + Math.sqrt(13)))
    const other = xongkoroMeshLocalSphere(bounds, transform)
    local.center.set(0, 0, 0)
    expect(other.center.toArray()).toEqual([8, 4, 2.5])
    expect(bounds.center).toEqual([1, 2, 3])
  })
})
