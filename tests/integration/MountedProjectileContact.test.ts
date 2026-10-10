import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { createNpcCombatActorRef, createPlayerCombatActorRef } from '../../src/combat/CombatAttribution'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { MountType } from '../../src/world/Mount'
import { damagePlayer } from '../../src/combat/DamageRouter'
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

  describe.each(['arrow', 'pilum'] as const)('%s mount allegiance', kind => {
    it.each(['player', 'allied-npc', 'player-personal'] as const)(
      'released %s mounts let projectiles continue to hostile targets behind them', owner => {
        const { scene, player, rider, mount } = fixture()
        rider.dismountFromMount()
        rider.group.position.set(0, 50, -3)
        if (owner === 'player') {
          player.mountVehicle(mount)
          player.dismountFromMount()
        } else {
          const ally = new NPC(scene, 20, 0, Faction.PLAYER, 'viking', AIType.RANGED, 'Ally', 1, false)
          onTestFinished(() => ally.dispose())
          if (owner === 'player-personal') ally.combatOwnership = 'player-personal'
          ally.mountVehicle(mount)
          ally.dismountFromMount()
        }
        player.position.set(20, 50, 0)
        const before = rider.hp
        const hit = vi.fn()
        const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 0, -1), 200, 30, Faction.PLAYER, true, kind)
        onTestFinished(() => arrow.destroy())

        arrow.update(.05, player, [rider], [], hit, () => { throw new Error('Player hit') }, undefined, false, [mount])

        expect(mount.riderNpc).toBeNull()
        expect(mount.riderPlayer).toBeNull()
        expect(mount.combatOwner?.allegiance).toBe(Faction.PLAYER)
        expect(mount.currentHp).toBe(100)
        expect(rider.hp).toBe(before - 30)
        expect(arrow.isAlive).toBe(false)
        expect(arrow.mesh.position.z).toBeLessThan(-1)
        expect(hit).toHaveBeenCalledExactlyOnceWith(30, expect.any(THREE.Vector3), rider.name, rider.hpRatio, false, rider, false)
      },
    )

    it('allied NPC shots pass through the player ridden mount and hit the enemy behind it', () => {
      const { scene, player, rider, mount } = fixture()
      rider.dismountFromMount()
      rider.group.position.set(0, 50, -3)
      player.mountVehicle(mount)
      const ally = new NPC(scene, 20, 0, Faction.PLAYER, 'viking', AIType.RANGED, 'Shooter', 1, false)
      onTestFinished(() => ally.dispose())
      const before = rider.hp
      const events: import('../../src/combat/CombatAttribution').CombatEvent[] = []
      const source = createNpcCombatActorRef(ally)
      const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 0, -1), 200, 30, Faction.PLAYER, false, kind, { source, emit: event => events.push(event) })
      onTestFinished(() => arrow.destroy())

      arrow.update(.05, player, [rider, ally], [], () => {}, () => { throw new Error('Player hit') }, undefined, false, [mount])

      expect(player.currentMount).toBe(mount)
      expect(mount.currentHp).toBe(100)
      expect(rider.hp).toBe(before - 30)
      expect(arrow.isAlive).toBe(false)
      expect(arrow.mesh.position.z).toBeLessThan(-1)
      expect(events).toEqual([expect.objectContaining({ type: 'damage_applied', source, target: expect.objectContaining({ targetId: rider.combatantId }), appliedDamage: 30 })])
    })

    it('enemy shots still damage the player ridden mount and stop there', () => {
      const { scene, player, rider, mount } = fixture()
      rider.dismountFromMount()
      rider.group.position.set(20, 50, 0)
      player.mountVehicle(mount)
      const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 0, -1), 200, 30, Faction.ENEMY, false, kind, { source: createNpcCombatActorRef(rider) })
      onTestFinished(() => arrow.destroy())

      arrow.update(.03, player, [rider], [], () => {}, (damage, context) => damagePlayer(player, damage, { setFill() {} }, null, context), undefined, false, [mount])

      expect(mount.currentHp).toBe(70)
      expect(player.hp).toBe(player.maxHp)
      expect(arrow.isAlive).toBe(false)
      expect(arrow.mesh.position.z).toBeGreaterThan(-.4)
    })

    it.each(['player', 'allied-npc'] as const)('%s shots still hit released enemy mounts', shooter => {
      const { scene, player, rider, mount } = fixture()
      rider.dismountFromMount()
      rider.group.position.set(0, 50, -3)
      player.position.set(20, 50, 0)
      const before = rider.hp
      const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 0, -1), 200, 30, Faction.PLAYER, shooter === 'player', kind)
      onTestFinished(() => arrow.destroy())

      arrow.update(.05, player, [rider], [], () => {}, () => { throw new Error('Player hit') }, undefined, false, [mount])

      expect(mount.combatOwner?.allegiance).toBe(Faction.ENEMY)
      expect(mount.currentHp).toBe(70)
      expect(rider.hp).toBe(before)
      expect(arrow.isAlive).toBe(false)
      expect(arrow.mesh.position.z).toBeGreaterThan(-.4)
    })

    it.each(['npc', 'player'] as const)('missing owner attribution falls back to the %s rider allegiance', owner => {
      const { scene, player, rider, mount } = fixture()
      if (owner === 'player') {
        rider.dismountFromMount()
        player.mountVehicle(mount)
      } else player.position.set(20, 50, 0)
      mount.combatOwner = undefined
      const faction = owner === 'player' ? Faction.PLAYER : Faction.ENEMY
      const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 0, -1), 200, 30, faction, false, kind)
      onTestFinished(() => arrow.destroy())
      const hit = vi.fn()

      arrow.update(.03, player, [], [], hit, () => { throw new Error('Player hit') }, undefined, false, [mount])

      expect(mount.currentHp).toBe(100)
      expect(arrow.isAlive).toBe(true)
      expect(arrow.isStuck).toBe(false)
      expect(arrow.mesh.position.z).toBeCloseTo(-3)
      expect(hit).not.toHaveBeenCalled()
    })

    it.each(['npc', 'player'] as const)('%s shots cannot hit their own ridden mount even with inconsistent owner allegiance', shooter => {
      const { scene, player, rider, mount } = fixture()
      if (shooter === 'player') {
        rider.dismountFromMount()
        player.mountVehicle(mount)
      } else player.position.set(20, 50, 0)
      const source = shooter === 'player' ? createPlayerCombatActorRef(player) : createNpcCombatActorRef(rider)
      mount.combatOwner = { ...source, allegiance: shooter === 'player' ? Faction.ENEMY : Faction.PLAYER }
      const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 0, -1), 200, 30, source.allegiance, shooter === 'player', kind, { source })
      onTestFinished(() => arrow.destroy())

      arrow.update(.03, player, [], [], () => {}, () => { throw new Error('Player hit') }, undefined, false, [mount])

      expect(mount.currentHp).toBe(100)
      expect(arrow.isAlive).toBe(true)
      expect(arrow.mesh.position.z).toBeCloseTo(-3)
    })

    it('truly unowned mounts remain physical targets', () => {
      const { scene, player, rider, mount } = fixture()
      rider.dismountFromMount()
      mount.combatOwner = undefined
      player.position.set(20, 50, 0)
      const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 0, -1), 200, 30, Faction.PLAYER, true, kind)
      onTestFinished(() => arrow.destroy())

      arrow.update(.03, player, [], [], () => {}, () => { throw new Error('Player hit') }, undefined, false, [mount])

      expect(mount.riderNpc).toBeNull()
      expect(mount.riderPlayer).toBeNull()
      expect(mount.currentHp).toBe(70)
      expect(player.hp).toBe(player.maxHp)
      expect(arrow.isAlive).toBe(false)
    })
  })
})
