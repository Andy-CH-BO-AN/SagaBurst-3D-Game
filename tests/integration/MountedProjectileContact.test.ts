import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { createPlayerCombatActorRef } from '../../src/combat/CombatAttribution'
import { Faction } from '../../src/world/NPC'
import { MountType } from '../../src/world/Mount'
import { ArrowProjectile } from '../../src/world/ArrowProjectile'

import { createMountedCombatActors } from '../helpers/mountedCombatActors'
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

describe('Mounted projectile contact wiring', () => {
  it.each(['arrow', 'pilum'] as const)('fast %s stops at mount or rider without damaging both', kind => {
    for (const high of [false, true]) {
      const { scene, player, rider, mount } = fixture()
      rider.shield.shieldImpactRemaining = 0
      player.position.set(100, 50, 100)
      const before = rider.hp
      const y = high ? rider.group.position.y + 1.2 : 50.8
      const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, y, 3), new THREE.Vector3(0, 0, -1), 200, 30, Faction.PLAYER, true, kind)
      arrow.update(.03, player, [rider], [], () => {}, () => { throw new Error('Player hit') }, undefined, false, [mount])
      expect(arrow.isAlive).toBe(false)
      expect(rider.hp).toBe(high ? before - 30 : before)
      expect(mount.currentHp).toBe(high ? 100 : 70)
      expect(arrow.mesh.position.z).toBeGreaterThan(-.4)
    }
  })

  it('released allied mounts still stop projectiles aimed at enemies behind them', () => {
    const { scene, player, rider, mount } = fixture()
    rider.dismountFromMount(); rider.group.position.set(0, 50, -3)
    mount.combatOwner = createPlayerCombatActorRef(player)
    player.position.set(20, 50, 0)
    const before = rider.hp
    const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 0, -1), 200, 30, Faction.PLAYER, true)
    arrow.update(.05, player, [rider], [], () => {}, () => { throw new Error('Player hit') }, undefined, false, [mount])
    expect(mount.riderNpc).toBeNull(); expect(mount.currentHp).toBe(70); expect(rider.hp).toBe(before)
  })
})
