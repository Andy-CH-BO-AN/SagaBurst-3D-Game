import * as THREE from 'three'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installHorseTestAsset } from '../helpers/horseAsset'
import { createNpcCombatActorRef, createPlayerCombatActorRef, type CombatDamageContext } from '../../src/combat/CombatAttribution'
import { damageNpc, damagePlayer } from '../../src/combat/DamageRouter'
import { ShieldState, weaponShieldImpact } from '../../src/combat/ShieldBlocking'
import { ARMORS } from '../../src/rpg/ArmorDatabase'
import { Player } from '../../src/player/Player'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'

beforeAll(installHorseTestAsset)
const disposables: Array<{ dispose(): void }> = []
afterEach(() => disposables.splice(0).forEach(object => object.dispose()))
const lances = ['hunting_spear', 'steel_lance', 'heavy_lance'] as const
const hpBar = { setFill() {} } as any

function fixture(side: 'player' | 'npc', shieldId: string) {
  const scene = new THREE.Scene(), player = new Player(scene)
  const npc = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'Guard', 1, false)
  const mount = new Mount(scene, MountType.HORSE, 0, 0, 50)
  disposables.push(player, npc, mount)
  player.blockingLevel = 0
  const attacker = side === 'player' ? player : npc
  const target = side === 'player' ? npc : player
  if (side === 'player') { npc.shieldId = shieldId; npc.rebuildShield() }
  else player.rebuildShield(shieldId)
  attacker.mountVehicle(mount)
  const context = (weaponId: string, kind: 'shield' | 'body' = 'shield'): CombatDamageContext => ({
    source: side === 'player' ? createPlayerCombatActorRef(player) : createNpcCombatActorRef(npc),
    method: 'melee', weaponId, contact: { kind, time: .2 },
  })
  const hit = (damage: number, context: CombatDamageContext) => side === 'player'
    ? damageNpc(npc, damage, context)
    : damagePlayer(player, damage, hpBar, shieldId, context)
  return { attacker, target, mount, player, npc, context, hit }
}

describe('Mounted lance shield impact', () => {
  it.each(['scutum', 'round_shield'] as const)('%s uses database capacity in live shield state and reset', kind => {
    for (const tier of [1, 2, 3]) {
      const id = `${kind}_t${tier}`, state = new ShieldState()
      state.equip(id)
      expect(state.shieldImpactMax).toBe(ARMORS[id].shieldImpactMax)
      expect(state.shieldImpactMax).toBe((kind === 'scutum' ? [7.5, 15, 30] : [5, 10, 20])[tier - 1])
      state.absorb(80, 1); state.equip(null); state.equip(id)
      expect(state.shieldImpactRemaining).toBe(state.shieldImpactMax - 1)
      state.reset(); expect(state.shieldImpactRemaining).toBe(state.shieldImpactMax)
    }
  })

  describe.each(['player', 'npc'] as const)('%s attacker', side => {
    it.each(lances)('%s breaks a same-tier Roman shield with 25% overflow at zero speed', weaponId => {
      const tier = lances.indexOf(weaponId) + 1
      const f = fixture(side, `scutum_t${tier}`)
      expect(f.mount.movementSpeed).toBe(0)
      const result = f.hit(80, f.context(weaponId))
      expect(result.blockedImpact).toBe([7.5, 15, 30][tier - 1])
      expect(result.appliedDamage).toBe(20)
      expect(f.target.shield.shieldBroken).toBe(true)
      expect(f.mount.currentHp).toBe(f.mount.maxHp)
    })

    it.each(lances)('%s breaks a same-tier Viking shield with 50% overflow', weaponId => {
      const tier = lances.indexOf(weaponId) + 1
      const f = fixture(side, `round_shield_t${tier}`)
      const result = f.hit(80, f.context(weaponId))
      expect(result.blockedImpact).toBe([5, 10, 20][tier - 1])
      expect(result.appliedDamage).toBe(40)
      expect(f.target.shield.shieldBroken).toBe(true)
    })

    it.each(lances)('%s consumes its tier impact against Roman T3, then returns to 1 on dismount', weaponId => {
      const tier = lances.indexOf(weaponId) + 1
      const f = fixture(side, 'scutum_t3')
      const impact = [10, 20, 40][tier - 1]
      const result = f.hit(80, f.context(weaponId))
      expect(result.blockedImpact).toBe(Math.min(30, impact))
      expect(result.appliedDamage).toBe(tier === 3 ? 20 : 0)
      expect(f.target.shield.shieldImpactRemaining).toBe(Math.max(0, 30 - impact))
      f.attacker.dismountFromMount(); f.target.shield.reset()
      const footHit = f.hit(80, f.context(weaponId))
      expect(footHit.blockedImpact).toBe(1)
      expect(footHit.appliedDamage).toBe(0)
      expect(f.target.shield.shieldImpactRemaining).toBe(29)
    })

    it('body hits bypass shields and mounted projectiles consume only ordinary impact', () => {
      const f = fixture(side, 'scutum_t3')
      expect(f.hit(20, f.context('heavy_lance', 'body')).appliedDamage).toBe(20)
      expect(f.target.shield.shieldImpactRemaining).toBe(30)
      const projectile = { ...f.context('heavy_lance'), method: 'projectile' as const }
      expect(f.hit(80, projectile).blockedImpact).toBe(1)
      expect(f.target.shield.shieldImpactRemaining).toBe(29)
    })
  })

  it('player Blocking skill reduces only lance overflow and awards actual absorbed durability', () => {
    const f = fixture('npc', 'scutum_t1'), award = vi.fn()
    f.player.blockingLevel = 50; f.player.onShieldBlock = award
    const result = f.hit(80, f.context('hunting_spear'))
    expect(result.appliedDamage).toBe(10)
    expect(award).toHaveBeenCalledExactlyOnceWith(7.5)
  })

  it('mounted axes, swords and unknown weapons preserve their previous impact', () => {
    for (const tier of [1, 2, 3]) expect(weaponShieldImpact(`viking_axe_t${tier}`, true)).toBe([2, 4, 8][tier - 1])
    expect(weaponShieldImpact('steel_sword', true)).toBe(1)
    expect(weaponShieldImpact('missing', true)).toBe(1)
    expect(weaponShieldImpact(undefined, true)).toBe(1)
  })
})
