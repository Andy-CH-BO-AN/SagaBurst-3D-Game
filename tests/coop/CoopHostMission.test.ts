import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { CoopHostMission, type CoopGamePort } from '../../src/coop/CoopMission'
import { decodeSnapshot } from '../../src/coop/CoopProtocol'
import { connectedCoopSession } from '../helpers/coopBridgeDouble'

/** An empty battlefield: only the host Player fields the snapshot and avatar read, and the mission result. */
function battlefield(): CoopGamePort {
  const player = {
    position: new Vector3(4, 1, 9), combatAnimationAction: 'idle', facingYaw: 0, isMounted: false, currentMount: null, bowDrawRatio: 0,
    hp: 80, dead: false, isAiming: false, shield: { shieldRaised: false }, characterFaction: 'viking', heroAssetId: null, characterTier: 2,
  }
  return {
    player, npcs: [], mounts: [], camera: { position: new Vector3() },
    equippedWeapons: () => ({ melee: null, ranged: null, shield: null }), weaponsDrawn: () => ({ melee: true, shield: true }),
    missionSettlement: () => ({ missionId: 'host-mission-1', kind: 'captain-outpost-defense', victory: true }),
  } as unknown as CoopGamePort
}

describe('Co-op host mission seats', () => {
  it('gives each admitted guest its own snapshot and one merit record, and nothing to a guest outside the scene', async () => {
    const { session, sent, receive } = await connectedCoopSession('host', [1, 2, 3])
    const host = new CoopHostMission(battlefield(), session, seat => seat !== 3)
    try {
      for (const seat of [1, 2, 3]) receive(seat, { t: 'ready' })
      host.update(1.1)
      host.update(1.1)
      const merits = sent.filter(frame => frame.message?.t === 'missionMerit')
      expect(merits.map(frame => frame.to)).toEqual([1, 2])
      expect(merits[0].message!.record).toMatchObject({ missionId: 'host-mission-1', victory: true, stats: { survived: false } })
      const snapshots = sent.filter(frame => frame.bytes)
      expect([...new Set(snapshots.map(frame => frame.to))]).toEqual([1, 2])
      // No puppet yet: each guest keeps its own HP rather than another seat's.
      expect(decodeSnapshot(snapshots[0].bytes!)?.guestHp).toBe(-1)
      expect(sent.some(frame => frame.to === 3 || frame.to === 'all')).toBe(false)
    } finally { host.dispose(false) }
  })
})
