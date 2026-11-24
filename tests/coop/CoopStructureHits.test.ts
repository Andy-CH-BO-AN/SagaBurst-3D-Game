import { describe, expect, it } from 'vitest'
import { Vector3, type Object3D } from 'three'
import { CoopSession, DEFAULT_COOP_PORT, type CoopBridge, type CoopLinkState } from '../../src/coop/CoopLink'
import { CoopGuestMission, type CoopGamePort } from '../../src/coop/CoopMission'
import { damageObstacle } from '../../src/combat/DamageRouter'
import { Faction } from '../../src/combat/CombatFaction'
import type { CombatActorRef } from '../../src/combat/CombatAttribution'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'

/** A connected guest link whose host messages the test delivers and whose sends it records. */
async function guestLink() {
  const sent: Array<Record<string, unknown>> = []
  let deliver: (data: string) => void = () => {}
  let publish: (state: CoopLinkState) => void = () => {}
  const connected: CoopLinkState = { role: 'guest', status: 'connected', address: '10.0.0.2', port: DEFAULT_COOP_PORT, error: null }
  const bridge: CoopBridge = {
    status: async () => ({ ...connected, status: 'idle', role: null }), host: async () => connected,
    join: async () => { publish(connected); return connected }, leave: async () => {},
    send: data => { sent.push(JSON.parse(String(data))) },
    onMessage: listener => { deliver = data => listener(data); return () => {} },
    onState: listener => { publish = listener; return () => {} },
  }
  const session = new CoopSession(bridge)
  await session.join('10.0.0.2')
  deliver(JSON.stringify({ t: 'hub', event: 'welcome', role: 'guest', peer: true }))
  return { session, sent, host: (message: Record<string, unknown>) => deliver(JSON.stringify(message)) }
}

const guestPlayer: CombatActorRef = { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'viking' }
const mirroredNpc: CombatActorRef = { actorId: 'npc:7', actorType: 'npc', allegiance: Faction.ENEMY, characterFaction: 'roman' }

describe('Co-op guest structure hits', () => {
  it('asks the host to break a keyed structure, keeps local HP until the host reports it, and ignores mirrored sources', async () => {
    const { session, sent, host } = await guestLink()
    const root = { visible: true, parent: null, removeFromParent() {} } as unknown as Object3D
    const gate = new DamageableObstacle({ kind: 'gate', maxHp: 100, root, ownerFaction: 'roman' })
    // The guest only touches its Player's position at construction; the structures are the contract here.
    const port = { player: { position: new Vector3() }, structures: () => new Map([['obstacle:3', gate]]) } as unknown as CoopGamePort
    const guest = new CoopGuestMission(port, () => {}, session)
    try {
      sent.length = 0
      const hit = damageObstacle(gate, 40, { source: guestPlayer, method: 'melee', weaponId: 'viking_axe_t1' })
      expect(hit.appliedDamage).toBe(40)
      expect(gate.currentHp).toBe(100)
      expect(sent).toEqual([{ t: 'hit', kind: 'structure', key: 'obstacle:3', damage: 40, method: 'melee', weaponId: 'viking_axe_t1' }])
      expect(damageObstacle(gate, 40, { source: mirroredNpc, method: 'melee' }).appliedDamage).toBe(0)
      expect(sent).toHaveLength(1)
      host({ t: 'structures', hp: [['obstacle:3', 25]] })
      expect(gate.currentHp).toBe(25)
      host({ t: 'structures', hp: [['obstacle:3', 0]] })
      expect(gate.destroyed).toBe(true)
    } finally { guest.dispose() }
  })
})
