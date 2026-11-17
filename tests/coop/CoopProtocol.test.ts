import { describe, expect, it } from 'vitest'
import { ACTOR_DEAD, ACTOR_RANGED, COOP_NO_ID, decodeSnapshot, encodeSnapshot, MOUNT_AIRBORNE, type CoopSnapshot } from '../../src/coop/CoopProtocol'

describe('Co-op snapshot wire format', () => {
  it('round-trips actors and mounts within wire precision and rejects partial frames', () => {
    const snapshot: CoopSnapshot = {
      time: 12.5, guestHp: 87.5, guestMaxHp: 120,
      actors: [
        { id: 7, x: -41.25, y: 3.5, z: 220.75, yaw: Math.PI * 1.5, speed: 6.37, action: 'swordSlash', flags: ACTOR_DEAD | ACTOR_RANGED, draw: 0.5, hp: 133.3, mountId: 2 },
        { id: 65534, x: 0, y: 0, z: 0, yaw: 0, speed: 0, action: 'bowAim', flags: 0, draw: 1, hp: 0, mountId: COOP_NO_ID },
      ],
      mounts: [{ id: 2, x: 10, y: 1, z: -5, yaw: -3, pitch: 0.25, speed: 14.2, flags: MOUNT_AIRBORNE, hp: 410 }],
    }
    const bytes = encodeSnapshot(snapshot)
    const decoded = decodeSnapshot(bytes)!
    expect(decoded.guestHp).toBe(87.5)
    expect(decoded.actors.map(a => [a.id, a.action, a.flags, a.mountId])).toEqual([[7, 'swordSlash', ACTOR_DEAD | ACTOR_RANGED, 2], [65534, 'bowAim', 0, COOP_NO_ID]])
    const actor = decoded.actors[0]
    expect([actor.x, actor.y, actor.z]).toEqual([-41.25, 3.5, 220.75])
    // 1.5π wraps to the equivalent -0.5π heading.
    expect(actor.yaw).toBeCloseTo(-Math.PI / 2, 3)
    expect(actor.speed).toBeCloseTo(6.37, 2)
    expect(actor.hp).toBeCloseTo(133.3, 1)
    expect(actor.draw).toBeCloseTo(0.5, 2)
    expect(decoded.mounts[0]).toMatchObject({ id: 2, flags: MOUNT_AIRBORNE })
    expect(decoded.mounts[0].pitch).toBeCloseTo(0.25, 3)
    expect(decodeSnapshot(bytes.subarray(0, bytes.length - 1))).toBeNull()
    expect(decodeSnapshot(new Uint8Array([9, ...bytes.subarray(1)]))).toBeNull()
  })
})
