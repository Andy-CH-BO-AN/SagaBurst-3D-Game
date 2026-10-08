import { describe, it, expect } from 'vitest'
import { damageNpc } from '../../src/combat/DamageRouter'
import { Faction } from '../../src/world/NPC'

describe('Damage router shield routing', () => {
  describe('H. Shield Damage Reduction for Rider and Horse', () => {

    it('DamageRouter never grants passive shield reduction to horse or rider', () => {
      let mountDamageTaken = 0
      let npcDamageTaken = 0

      const mockMount: any = {
        group: { uuid: 'shield-test-mount' },
        dead: false,
        currentHp: 200,
        maxHp: 200,
        mountDisplayName: '戰馬',
        takeDamage: (amt: number) => {
          mountDamageTaken = amt
          return true
        },
      }

      const mockNpc: any = {
        name: 'TestNpc',
        shieldId: 'round_shield_t2', // 15% reduction
        isMounted: true,
        mount: mockMount,
        hpRatio: 1.0,
        dismountFromMount: () => { mockNpc.isMounted = false },
        takeDamage: (amt: number) => {
          npcDamageTaken = amt
          return true
        },
      }

      // 1. Mounted with T2 shield: 100 incoming damage -> mount takes 85
      damageNpc(mockNpc, 100, { source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' }, method: 'melee', contact: { kind: 'mount', time: 0 } })
      expect(mountDamageTaken).toBe(100)
      expect(npcDamageTaken).toBe(0)

      // 2. Unmounted with T2 shield: 100 incoming damage -> NPC takes 85
      mockNpc.isMounted = false
      mockNpc.mount = null
      damageNpc(mockNpc, 100)
      expect(npcDamageTaken).toBe(100)

      // 3. No shield: 100 incoming damage -> NPC takes full 100
      mockNpc.shieldId = null
      damageNpc(mockNpc, 100)
      expect(npcDamageTaken).toBe(100)
    })
  })
})
