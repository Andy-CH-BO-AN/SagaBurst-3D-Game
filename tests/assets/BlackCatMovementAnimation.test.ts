import * as THREE from 'three'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Mount, MountState, MountType } from '../../src/world/Mount'
import { installBlackCatTestAsset } from '../helpers/blackCatAsset'

describe('black cat animation during terrain movement', () => {
  beforeAll(installBlackCatTestAsset)

  it.each([
    { speed: 13.2, fps: 60 },
    { speed: 26.4, fps: 60 },
    { speed: 13.2, fps: 144 },
    { speed: 26.4, fps: 144 },
  ])('keeps the legs running down the spawn slope at $speed m/s and $fps FPS', ({ speed, fps }) => {
    const mount = new Mount(new THREE.Scene(), MountType.BLACK_CAT, 0, 145)
    mount.state = MountState.CONTROLLED
    const visual = mount.catVisual!
    const land = vi.spyOn(visual, 'playOnce')
    const direction = new THREE.Vector3(0, 0, -1)
    const dt = 1 / fps
    const leg = visual.skeleton.getBoneByName('cat_front_upper_l')!
    const poses = new Set<string>()
    let groundContacts = 0
    mount.beginControlledFrame()
    mount.finishControlledFrame(dt, [])
    for (let frame = 0; frame < fps * 4; frame++) {
      const wasGrounded = mount.onGround
      mount.beginControlledFrame()
      mount.addControlledMovement(direction, speed, dt)
      mount.finishControlledFrame(dt, [])
      if (!wasGrounded && mount.onGround) groundContacts++
      expect(visual.debugState().clip).toBe('run')
      poses.add(leg.quaternion.toArray().map(value => value.toFixed(4)).join(','))
    }
    expect(groundContacts, 'the real terrain path exercises intermittent ground contact').toBeGreaterThan(5)
    expect(poses.size, 'the running leg keeps changing pose during travel').toBeGreaterThan(10)
    const landRequests = land.mock.calls.filter(([clip]) => clip === 'land')
    expect(landRequests, 'ordinary hillside travel must not restart the landing one-shot').toHaveLength(0)
    expect(visual.debugState().clip).toBe('run')
    land.mockRestore()
    mount.dispose()
  })

  it.each([false, true])('lands once after a real moving jump, with midair hit = %s', (hit) => {
    const mount = new Mount(new THREE.Scene(), MountType.BLACK_CAT, 0, 145)
    mount.state = MountState.CONTROLLED
    const visual = mount.catVisual!
    const once = vi.spyOn(visual, 'playOnce')
    const direction = new THREE.Vector3(0, 0, -1)
    const dt = 1 / 60
    const move = () => {
      mount.beginControlledFrame()
      mount.addControlledMovement(direction, mount.baseSpeed, dt)
      mount.finishControlledFrame(dt, [])
    }
    mount.beginControlledFrame()
    mount.finishControlledFrame(dt, [])
    mount.startJump(14.4)
    mount.startJump(20)
    expect(mount.velY).toBe(14.4)
    for (let frame = 0; frame < 180; frame++) {
      if (hit && frame === 10) mount.takeDamage(1)
      move()
      if (mount.onGround) break
      expect(once.mock.calls.filter(([clip]) => clip === 'land')).toHaveLength(0)
      if (!hit) expect(visual.debugState().clip).toBe('jump')
    }
    expect(mount.onGround).toBe(true)
    expect(visual.debugState().clip).toBe('land')
    expect(once.mock.calls.filter(([clip]) => clip === 'jump')).toHaveLength(1)
    for (let frame = 0; frame < 240; frame++) move()
    expect(once.mock.calls.filter(([clip]) => clip === 'land')).toHaveLength(1)
    expect(visual.debugState().clip).toBe('run')
    once.mockRestore()
    mount.dispose()
  })

  it('keeps a pending jump from overriding death or leaking into town restoration', () => {
    const mount = new Mount(new THREE.Scene(), MountType.BLACK_CAT, 0, 145)
    mount.state = MountState.CONTROLLED
    const visual = mount.catVisual!
    const once = vi.spyOn(visual, 'playOnce')
    const direction = new THREE.Vector3(0, 0, -1)
    const dt = 1 / 60
    mount.beginControlledFrame()
    mount.finishControlledFrame(dt, [])
    mount.startJump(14.4)
    mount.takeDamage(999)
    for (let frame = 0; frame < 180; frame++) {
      mount.finishControlledFrame(dt, [])
      mount.update(dt, [])
    }
    expect(visual.debugState().clip).toBe('death')
    expect(once.mock.calls.filter(([clip]) => clip === 'land')).toHaveLength(0)
    mount.restoreForTown(0, 145, 0)
    mount.state = MountState.CONTROLLED
    for (let frame = 0; frame < 240; frame++) {
      mount.beginControlledFrame()
      mount.addControlledMovement(direction, mount.baseSpeed, dt)
      mount.finishControlledFrame(dt, [])
    }
    expect(once.mock.calls.filter(([clip]) => clip === 'land')).toHaveLength(0)
    expect(visual.debugState().clip).toBe('run')
    once.mockRestore()
    mount.dispose()
  })
})
