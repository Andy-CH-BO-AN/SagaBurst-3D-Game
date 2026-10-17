import { describe, expect, it } from 'vitest'
import { Vector3, type Camera } from 'three'
import { CompassHeading } from '../../src/ui/CompassHeading'

describe('Compass heading', () => {

  it('reads the current camera forward despite pitch and an unrelated body/controller yaw', () => {
    const heading = new CompassHeading()
    // Only a numerical camera boundary: no Camera, actor, mount or scene.
    const forward = new Vector3(.6, -.8, 0)
    const camera = { getWorldDirection: (target: Vector3) => target.copy(forward), cameraYaw: 0 } satisfies Pick<Camera, 'getWorldDirection'> & { cameraYaw: number }
    expect(heading.update(camera)).toBeCloseTo(Math.PI / 2)
    forward.set(-.6, -.8, 0)
    expect(heading.update(camera)).toBeCloseTo(3 * Math.PI / 2)
  })

  it('keeps the last valid heading through vertical, nearly vertical and nonfinite forward data', () => {
    const heading = new CompassHeading()
    const forward = new Vector3(0, -1, 0)
    const camera = { getWorldDirection: (target: Vector3) => target.copy(forward) }
    expect(heading.update(camera)).toBe(0)
    forward.set(1, 0, 0)
    const east = heading.update(camera)
    expect(east).toBeCloseTo(Math.PI / 2)
    for (const invalid of [[0, -1, 0], [-1e-6, -1, 1e-6], [NaN, 0, 0], [0, Infinity, -1]]) {
      forward.set(...invalid as [number, number, number])
      expect(heading.update(camera)).toBe(east)
    }
    forward.set(0, 0, 1)
    expect(heading.update(camera)).toBeCloseTo(Math.PI)
  })
})
