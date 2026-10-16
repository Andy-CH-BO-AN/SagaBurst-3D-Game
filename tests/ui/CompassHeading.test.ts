import { describe, expect, it } from 'vitest'
import { Vector3, type Camera } from 'three'
import { CompassHeading, resolveCompassHeading } from '../../src/ui/CompassHeading'

describe('Compass heading', () => {
  it('maps the eight world directions clockwise from -Z north and normalizes the north boundary', () => {
    const directions = [
      [0, -1, 0], [1, -1, 45], [1, 0, 90], [1, 1, 135],
      [0, 1, 180], [-1, 1, 225], [-1, 0, 270], [-1, -1, 315],
    ]
    for (const [x, z, degrees] of directions) {
      expect(resolveCompassHeading(new Vector3(x, 0, z).normalize(), 0)).toBeCloseTo(degrees * Math.PI / 180)
    }
    expect(resolveCompassHeading(new Vector3(-1e-5, 0, -1), 0)).toBeCloseTo(2 * Math.PI - 1e-5)
    expect(resolveCompassHeading(new Vector3(1e-5, 0, -1), 0)).toBeCloseTo(1e-5)
  })

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
