import { describe, expect, it } from 'vitest'
import { Matrix4 } from 'three'
import { validateXongkoroRenderBounds, xongkoroMeshLocalSphere } from '../../src/world/XongkoroRenderBounds'

const identity = { assetSha256: 'a'.repeat(64), poseSha256: 'b'.repeat(64), threeRevision: '167' }
const metadata = () => ({ schemaVersion: 1, space: 'XongkoroVisual.root', ...identity,
  meshes: [0, 1, 2].map(index => ({ name: `eagle_body_lod${index}`, vertices: 20, triangles: 10, center: [0, 4, .5], radius: 18 })) })

describe('Xongkoro conservative render bounds', () => {
  it('accepts the verified asset contract and falls back when the pose source changes', () => {
    const source = metadata()
    expect(validateXongkoroRenderBounds(source, identity).bounds).toBe(source)
    const stale = validateXongkoroRenderBounds(source, { ...identity, poseSha256: 'c'.repeat(64) })
    expect(stale.bounds).toBeNull()
    expect(stale.reason).toContain('contract changed')
    source.meshes[1].radius = Number.NaN
    expect(validateXongkoroRenderBounds(source, identity).bounds).toBeNull()
  })

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
