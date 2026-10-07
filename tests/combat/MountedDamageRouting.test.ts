import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { damageNpc, damagePlayer } from '../../src/combat/DamageRouter'
import { MountType } from '../../src/world/Mount'

import { createMountedCombatActors, createMountedDamageContext as ctx } from '../helpers/mountedCombatActors'
function fixture(type = MountType.HORSE) {
  return createMountedCombatActors(type, resource => onTestFinished(() => resource.dispose()))
}

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual,
  },
}))
vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

const hp = { setFill: vi.fn() } as any

describe('Mounted damage routing', () => {
  it('Case A: mount death leaves the rider alive at exactly the same HP', () => {
    const { rider, mount, player } = fixture()
    rider.restoreCombatHealth(100); mount.currentHp = 20
    const result = damageNpc(rider, 30, ctx(player, 'mount', mount))
    expect(result.appliedDamage).toBe(20); expect(mount.dead).toBe(true)
    expect(rider.hp).toBe(100); expect(rider.dead).toBe(false); expect(rider.mount).toBeNull()
  })

  it('Case B: rider death leaves a healthy, released horse which Player can ride and remount', () => {
    const { rider, mount, player } = fixture()
    rider.restoreCombatHealth(20)
    damageNpc(rider, 30, ctx(player, 'body'))
    expect(rider.dead).toBe(true); expect(mount.currentHp).toBe(100); expect(mount.dead).toBe(false)
    expect(mount.riderNpc).toBeNull(); expect(mount.riderFaction).toBeNull(); expect(mount.availableForPlayer).toBe(true)
    player.mountVehicle(mount); expect(player.currentMount).toBe(mount)
    player.dismountFromMount(); expect(mount.availableForPlayer).toBe(true)
    player.mountVehicle(mount); expect(player.isMounted).toBe(true)
  })

  it('shield fully blocks both HP pools; broken-shield overflow hurts only rider', () => {
    const { rider, mount, player } = fixture()
    const before = rider.hp
    expect(damageNpc(rider, 80, ctx(player, 'shield')).appliedDamage).toBe(0)
    rider.shield.shieldImpactRemaining = 1
    const hit = ctx(player, 'shield'); hit.weaponId = 'viking_axe_t3'
    expect(damageNpc(rider, 80, hit).appliedDamage).toBe(70)
    expect(rider.hp).toBe(before - 70); expect(mount.currentHp).toBe(100)
  })

  it('Player death releases the mount without altering its HP', () => {
    const { rider, mount, player } = fixture(); rider.dismountFromMount(); player.mountVehicle(mount)
    player.setHp(20)
    damagePlayer(player, 30, hp, null, ctx(player, 'body'))
    expect(player.dead).toBe(true); expect(mount.currentHp).toBe(100)
    expect(mount.riderPlayer).toBeNull(); expect(mount.availableForPlayer).toBe(true)
  })

  it('mount-impact ignores shield/contact, while unspecified scripted damage stays on the person', () => {
    const { rider, mount, player } = fixture()
    const before = rider.hp, shield = rider.shield.shieldImpactRemaining
    damageNpc(rider, 30, ctx(player, 'shield', undefined, 'mount-impact'))
    expect(mount.currentHp).toBe(70); expect(rider.hp).toBe(before); expect(rider.shield.shieldImpactRemaining).toBe(shield)
    damageNpc(rider, 20)
    expect(rider.hp).toBe(before - 20); expect(mount.currentHp).toBe(70)
    rider.dismountFromMount(); player.mountVehicle(mount)
    const pHp = player.hp
    damagePlayer(player, 20, hp, null)
    expect(player.hp).toBe(pHp - 20); expect(mount.currentHp).toBe(70)
    damagePlayer(player, 20, hp, null, ctx(player, 'body', undefined, 'mount-impact'))
    expect(player.hp).toBe(pHp - 20); expect(mount.currentHp).toBe(50)
  })
})
