import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { COMBAT_BALANCE } from '../../src/combat/CombatBalance'
import { damagePlayer } from '../../src/combat/DamageRouter'
import * as THREE from 'three'
import { Faction } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import { ArrowProjectile } from '../../src/world/ArrowProjectile'
import { Mount, MountType } from '../../src/world/Mount'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual,
  },
}))

describe('Player projectile damage routing', () => {
  describe('K. Enemy Projectiles Damaging Player Integration', () => {
    it('1. Unmounted Player, no shield takes authoritative T2 bow damage and repeated hits trigger death flow', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'viking')
      player.position.set(0, 0, 0)
      const mockHpBar = { setFill: vi.fn() } as any
      const onDeath = vi.fn()
      player.onPlayerDeath = onDeath

      const onHitTarget = vi.fn()
      const t2BowDamage = WEAPONS.recurve_longbow.damageMax * COMBAT_BALANCE.bow.damageMultiplier
      const expectedHp = 200 - t2BowDamage
      const arrow = new ArrowProjectile(
        scene,
        new THREE.Vector3(0, .5, .25),
        new THREE.Vector3(0, 0, -1),
        10,
        t2BowDamage,
        Faction.ENEMY,
        false,
        'arrow'
      )

      arrow.update(
        0.01,
        player,
        [],
        [],
        onHitTarget,
        (damage, context) => damagePlayer(player, damage, mockHpBar, null, context)
      )

      expect(player.currentHp).toBeCloseTo(expectedHp)
      expect(onHitTarget).toHaveBeenCalledWith(
        expect.closeTo(t2BowDamage, 6),
        expect.any(THREE.Vector3),
        'Player',
        expectedHp / 200,
        true,
        undefined,
        false
      )
      expect(mockHpBar.setFill).toHaveBeenCalledWith(expectedHp / 200)
      expect(player.dead).toBe(false)
      expect(onDeath).not.toHaveBeenCalled()

      // Repeated hits reduce HP to 0 and trigger permanent death flow
      const fatalArrow = new ArrowProjectile(
        scene,
        new THREE.Vector3(0, .5, .25),
        new THREE.Vector3(0, 0, -1),
        10,
        200,
        Faction.ENEMY,
        false,
        'arrow'
      )
      fatalArrow.update(
        0.01,
        player,
        [],
        [],
        onHitTarget,
        (damage, context) => damagePlayer(player, damage, mockHpBar, null, context)
      )

      expect(player.currentHp).toBe(0)
      expect(player.dead).toBe(true)
      expect(onDeath).toHaveBeenCalledTimes(1)
    })

    it('2. Unmounted Player, T2 shield (no passive reduction) receives full damage on direct body hit', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'viking')
      player.position.set(0, 0, 0)
      const mockHpBar = { setFill: vi.fn() } as any
      const onHitTarget = vi.fn()

      const arrow = new ArrowProjectile(
        scene,
        new THREE.Vector3(0, .5, .25),
        new THREE.Vector3(0, 0, -1),
        10,
        100,
        Faction.ENEMY,
        false,
        'arrow'
      )

      arrow.update(
        0.01,
        player,
        [],
        [],
        onHitTarget,
        (damage, context) => damagePlayer(player, damage, mockHpBar, 'round_shield_t2', context)
      )

      // 100 * (1 - 0.15) = 85 damage -> 200 - 85 = 115 HP
      expect(player.currentHp).toBe(100)
      expect(onHitTarget).toHaveBeenCalledWith(
        100,
        expect.any(THREE.Vector3),
        'Player',
        100 / 200,
        true,
        undefined,
        false
      )
      expect(mockHpBar.setFill).toHaveBeenCalledWith(100 / 200)
    })

    it('3. Mounted Player, T2 shield (no passive reduction) routes full damage to Horse, Rider HP unchanged', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'viking')
      player.position.set(0, 0, 0)
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.currentHp = 200
      mount.maxHp = 200
      player.mountVehicle(mount)

      const mockHpBar = { setFill: vi.fn() } as any
      const onHitTarget = vi.fn()

      const arrow = new ArrowProjectile(
        scene,
        new THREE.Vector3(0, .5, .25),
        new THREE.Vector3(0, 0, -1),
        10,
        100,
        Faction.ENEMY,
        false,
        'arrow'
      )

      arrow.update(
        0.01,
        player,
        [],
        [],
        onHitTarget,
        (damage, context) => damagePlayer(player, damage, mockHpBar, 'round_shield_t2', context)
      )

      // Horse receives 85 damage -> 115 HP
      expect(mount.currentHp).toBe(100)
      // Rider HP unchanged
      expect(player.currentHp).toBe(200)
      expect(player.isMounted).toBe(true)
      expect(onHitTarget).toHaveBeenCalledWith(
        100,
        expect.any(THREE.Vector3),
        mount.displayName,
        100 / 200,
        true,
        undefined,
        true
      )
    })

    it('4. Mounted Player, no shield routes full 100 damage to Horse, Rider HP unchanged', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'viking')
      player.position.set(0, 0, 0)
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.currentHp = 200
      mount.maxHp = 200
      player.mountVehicle(mount)

      const mockHpBar = { setFill: vi.fn() } as any
      const onHitTarget = vi.fn()

      const arrow = new ArrowProjectile(
        scene,
        new THREE.Vector3(0, .5, .25),
        new THREE.Vector3(0, 0, -1),
        10,
        100,
        Faction.ENEMY,
        false,
        'arrow'
      )

      arrow.update(
        0.01,
        player,
        [],
        [],
        onHitTarget,
        (damage, context) => damagePlayer(player, damage, mockHpBar, null, context)
      )

      // Horse receives 100 damage -> 100 HP
      expect(mount.currentHp).toBe(100)
      expect(player.currentHp).toBe(200)
      expect(onHitTarget).toHaveBeenCalledWith(
        100,
        expect.any(THREE.Vector3),
        mount.displayName,
        100 / 200,
        true,
        undefined,
        true
      )
    })

    it('5. Horse death from a projectile causes dismount behavior exactly once', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'viking')
      player.position.set(0, 0, 0)
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.currentHp = 50
      mount.maxHp = 200
      player.mountVehicle(mount)

      const dismountSpy = vi.spyOn(player, 'dismountFromMount')
      const mockHpBar = { setFill: vi.fn() } as any
      const onHitTarget = vi.fn()

      const arrow = new ArrowProjectile(
        scene,
        new THREE.Vector3(0, .5, .25),
        new THREE.Vector3(0, 0, -1),
        10,
        100,
        Faction.ENEMY,
        false,
        'arrow'
      )

      arrow.update(
        0.01,
        player,
        [],
        [],
        onHitTarget,
        (damage, context) => damagePlayer(player, damage, mockHpBar, null, context)
      )

      expect(mount.dead).toBe(true)
      expect(player.isMounted).toBe(false)
      expect(dismountSpy).toHaveBeenCalledTimes(1)
      expect(onHitTarget).toHaveBeenCalledWith(
        50,
        expect.any(THREE.Vector3),
        mount.displayName,
        0,
        true,
        undefined,
        true
      )
    })

    it('6. Javelin uses the same Player damage routing as Bow', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'viking')
      player.position.set(0, 0, 0)
      const mockHpBar = { setFill: vi.fn() } as any
      const onHitTarget = vi.fn()

      // T2 Javelin projectile with 63 damage
      const javelin = new ArrowProjectile(
        scene,
        new THREE.Vector3(0, .5, .25),
        new THREE.Vector3(0, 0, -1),
        10,
        63,
        Faction.ENEMY,
        false,
        'pilum'
      )

      javelin.update(
        0.01,
        player,
        [],
        [],
        onHitTarget,
        (damage, context) => damagePlayer(player, damage, mockHpBar, null, context)
      )

      expect(player.currentHp).toBe(200 - 63)
      expect(onHitTarget).toHaveBeenCalledWith(
        63,
        expect.any(THREE.Vector3),
        'Player',
        137 / 200,
        true,
        undefined,
        false
      )
    })

    it('7. The hit callback/HUD receives the actual post-hit target HP ratio for both Player and Mount', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'viking')
      player.position.set(0, 0, 0)
      const mockHpBar = { setFill: vi.fn() } as any
      let reportedRatio = -1

      const arrow = new ArrowProjectile(
        scene,
        new THREE.Vector3(0, .5, .25),
        new THREE.Vector3(0, 0, -1),
        10,
        50,
        Faction.ENEMY,
        false,
        'arrow'
      )

      arrow.update(
        0.01,
        player,
        [],
        [],
        (_damage, _pos, _name, hpRatio) => {
          reportedRatio = hpRatio
        },
        (damage, context) => damagePlayer(player, damage, mockHpBar, null, context)
      )

      // Post-hit HP is 150 / 200 = 0.75
      expect(reportedRatio).toBe(0.75)
      expect(player.hpRatio).toBe(0.75)
    })
  })
})
