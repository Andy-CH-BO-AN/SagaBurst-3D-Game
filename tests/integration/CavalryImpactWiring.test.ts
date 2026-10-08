import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { calculateMountImpactDamage } from '../../src/combat/CombatBalance'
import { damagePlayer } from '../../src/combat/DamageRouter'
import * as THREE from 'three'
import { NPC, Faction, AIState, AIType } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import { Mount, MountState, MountType } from '../../src/world/Mount'
import { resolveMountImpacts, checkMountImpact } from '../../src/combat/MountImpact'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { Game } from '../../src/Game'

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual,
  },
}))

describe('Cavalry impact wiring', () => {
  describe('L. Cavalry Mechanics & Mount Impact Integration', () => {
    it('1. NPC mounted T3 Lance enters melee after >10 m/s approach -> first hit 180', () => {
      const scene = new THREE.Scene()
      const target = new NPC(scene, 0, 2, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanTarget', 3, false)
      target.group.position.set(0, 0, 2)
      const attacker = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingAttacker', 3, true)
      attacker.group.position.set(0, 0, 0)
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      attacker.mountVehicle(mount)
      attacker.meleeWeaponId = 'heavy_lance'
      attacker.meleeDamage = WEAPONS['heavy_lance'].damageMax // 60
      attacker.isUsingLance = true
      attacker.meleeAttackRadius = 3.9
      attacker.shieldId = null

      mount.movementSpeed = 12
      ;(attacker as any).state = AIState.CHASE

      const onHit = vi.fn()
      // Frame 1: Transitions from CHASE to ATTACK, snapshots pendingLanceChargeSpeed = 12
      attacker.update(0.016, null as any, [attacker, target], [], [], null as any, onHit, () => {})
      expect(attacker.currentState).toBe(AIState.ATTACK)
      expect(attacker.pendingLanceChargeSpeed).toBe(12)

      // Frame 2: Executes attack hit
      vi.spyOn(attacker.weaponSweep, 'trace').mockReturnValue({ kind: 'body', time: .5 }) // Damage coefficient test; physical sweep tested separately.
      vi.spyOn((attacker as any).animator, 'update').mockReturnValue({
        actionCompleted: false,
        hitActiveStarted: true,
        projectileRelease: false,
      } as any)

      attacker.update(0.016, null as any, [attacker, target], [], [], null as any, onHit, () => {})
      expect(onHit).toHaveBeenCalledWith(180, false, target)
      expect(attacker.pendingLanceChargeSpeed).toBe(0)
      expect(mount.skipImpactThisFrame).toBe(true)
    })

    it('2. The next stationary thrust from the same NPC -> 60', () => {
      const scene = new THREE.Scene()
      const target = new NPC(scene, 0, 2, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanTarget', 3, false)
      target.group.position.set(0, 0, 2)
      const attacker = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingAttacker', 3, true)
      attacker.group.position.set(0, 0, 0)
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      attacker.mountVehicle(mount)
      attacker.meleeWeaponId = 'heavy_lance'
      attacker.meleeDamage = WEAPONS['heavy_lance'].damageMax // 60
      attacker.isUsingLance = true
      attacker.meleeAttackRadius = 3.9
      attacker.shieldId = null

      mount.movementSpeed = 12
      ;(attacker as any).state = AIState.CHASE

      const onHit = vi.fn()
      // Transition to ATTACK with charge speed 12
      attacker.update(0.016, null as any, [attacker, target], [], [], null as any, onHit, () => {})
      expect(attacker.pendingLanceChargeSpeed).toBe(12)

      // First hit: charge hit = 180
      vi.spyOn(attacker.weaponSweep, 'trace').mockReturnValue({ kind: 'body', time: .5 }) // Damage coefficient test; physical sweep tested separately.
      vi.spyOn((attacker as any).animator, 'update').mockReturnValue({
        actionCompleted: false,
        hitActiveStarted: true,
        projectileRelease: false,
      } as any)
      attacker.update(0.016, null as any, [attacker, target], [], [], null as any, onHit, () => {})
      expect(onHit).toHaveBeenLastCalledWith(180, false, target)
      expect(attacker.pendingLanceChargeSpeed).toBe(0)

      // Reset hit flag for next attack cycle while stationary (mount.movementSpeed is 0)
      mount.movementSpeed = 0
      attacker.attackHitProcessed = false

      attacker.update(0.016, null as any, [attacker, target], [], [], null as any, onHit, () => {})
      // Subsequent stationary hit must be normal 60 base damage, not 180 again
      expect(onHit).toHaveBeenLastCalledWith(60, false, target)
    })

    it('3. <=10 m/s approach -> 60', () => {
      const scene = new THREE.Scene()
      const target = new NPC(scene, 0, 2, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanTarget', 3, false)
      target.group.position.set(0, 0, 2)
      const attacker = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingAttacker', 3, true)
      attacker.group.position.set(0, 0, 0)
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      attacker.mountVehicle(mount)
      attacker.meleeWeaponId = 'heavy_lance'
      attacker.meleeDamage = WEAPONS['heavy_lance'].damageMax // 60
      attacker.isUsingLance = true
      attacker.meleeAttackRadius = 3.9
      attacker.shieldId = null

      // Approach at 10 m/s (threshold is >10)
      mount.movementSpeed = 10
      ;(attacker as any).state = AIState.CHASE

      const onHit = vi.fn()
      attacker.update(0.016, null as any, [attacker, target], [], [], null as any, onHit, () => {})
      expect(attacker.pendingLanceChargeSpeed).toBe(10)

      vi.spyOn(attacker.weaponSweep, 'trace').mockReturnValue({ kind: 'body', time: .5 }) // Damage coefficient test; physical sweep tested separately.
      vi.spyOn((attacker as any).animator, 'update').mockReturnValue({
        actionCompleted: false,
        hitActiveStarted: true,
        projectileRelease: false,
      } as any)

      attacker.update(0.016, null as any, [attacker, target], [], [], null as any, onHit, () => {})
      // 10 m/s is not > 10 m/s -> standard 60 damage
      expect(onHit).toHaveBeenCalledWith(60, false, target)
    })

    it('4. Foot Spearman vs mounted target remains 120 for T3; same target after dismount = 60', () => {
      const scene = new THREE.Scene()
      const targetMount = new Mount(scene, MountType.HORSE, 0, 2, 0)
      onTestFinished(() => targetMount.dispose())
      expect(targetMount.horseVisual).not.toBeNull()
      const target = new NPC(scene, 0, 2, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanTarget', 3, true)
      target.group.position.set(0, 0, 2)
      target.mountVehicle(targetMount)
      expect(target.isMounted).toBe(true)

      const footSpearman = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingSpearman', 3, false)
      footSpearman.group.position.set(0, 0, 0)
      footSpearman.meleeWeaponId = 'heavy_lance'
      footSpearman.meleeDamage = WEAPONS['heavy_lance'].damageMax // 60
      footSpearman.isUsingLance = true
      footSpearman.meleeAttackRadius = 3.9
      footSpearman.shieldId = null
      expect(footSpearman.isMounted).toBe(false)

      const onHit = vi.fn()
      ;(footSpearman as any).state = AIState.ATTACK
      ;(footSpearman as any).attackTimer = 0
      vi.spyOn(footSpearman.weaponSweep, 'trace').mockReturnValue({ kind: 'body', time: .5 })
      vi.spyOn((footSpearman as any).animator, 'update').mockReturnValue({
        actionCompleted: false,
        hitActiveStarted: true,
        projectileRelease: false,
      } as any)

      // Foot Spearman vs mounted target -> 60 * 2 = 120
      footSpearman.update(0.016, null as any, [footSpearman, target], [], [], null as any, onHit, () => {})
      expect(onHit).toHaveBeenLastCalledWith(120, false, target)

      // Target dismounts
      target.dismountFromMount()
      expect(target.isMounted).toBe(false)
      footSpearman.attackHitProcessed = false

      // Foot Spearman vs unmounted target -> 60 * 1 = 60
      footSpearman.update(0.016, null as any, [footSpearman, target], [], [], null as any, onHit, () => {})
      expect(onHit).toHaveBeenLastCalledWith(60, false, target)
    })

    it('5. NPC mount at 10 m/s impacts hostile foot NPC for 23', () => {
      const scene = new THREE.Scene()
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.state = MountState.CONTROLLED
      mount.riderFaction = Faction.ENEMY
      mount.previousPosition.set(0, 0, -2)
      mount.group.position.set(0, 0, 2)
      mount.movementSpeed = 10
      mount.isSprinting = false

      const hostileFootNpc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'HostileFoot', 1, false)
      hostileFootNpc.group.position.set(0, 0, 0)
      hostileFootNpc.shieldId = null
      expect(hostileFootNpc.hp).toBe(200)

      const player = new Player(scene, 'viking')
      player.group.position.set(100, 0, 100) // far away

      resolveMountImpacts([mount], player, [hostileFootNpc], 1.0, { onDamagePlayer: vi.fn() })
      // Non-sprint speed 10 m/s: 8 + 10 * 1.5 = 23 damage -> 200 - 23 = 177 HP
      expect(hostileFootNpc.hp).toBe(177)
    })

    it('6. NPC mount does not impact friendly NPC', () => {
      const scene = new THREE.Scene()
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.state = MountState.CONTROLLED
      mount.riderFaction = Faction.ENEMY
      mount.previousPosition.set(0, 0, -2)
      mount.group.position.set(0, 0, 2)
      mount.movementSpeed = 10
      mount.isSprinting = false

      const friendlyFootNpc = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'FriendlyFoot', 1, false)
      friendlyFootNpc.group.position.set(0, 0, 0)
      expect(friendlyFootNpc.hp).toBe(200)

      const player = new Player(scene, 'viking')
      player.group.position.set(100, 0, 100)

      resolveMountImpacts([mount], player, [friendlyFootNpc], 1.0, { onDamagePlayer: vi.fn() })
      // Friendly NPC must not receive impact damage
      expect(friendlyFootNpc.hp).toBe(200)
    })

    it('7. Same target cannot receive repeated impact inside 0.6s', () => {
      const scene = new THREE.Scene()
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.state = MountState.CONTROLLED
      mount.riderFaction = Faction.ENEMY
      mount.previousPosition.set(0, 0, -2)
      mount.group.position.set(0, 0, 2)
      mount.movementSpeed = 10
      mount.isSprinting = false

      const hostileFootNpc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'HostileFoot', 1, false)
      hostileFootNpc.group.position.set(0, 0, 0)
      hostileFootNpc.shieldId = null

      const player = new Player(scene, 'viking')
      player.group.position.set(100, 0, 100)

      const onDamagePlayer = vi.fn()
      // First impact at t = 1.0 -> 23 damage (HP = 177)
      resolveMountImpacts([mount], player, [hostileFootNpc], 1.0, { onDamagePlayer })
      expect(hostileFootNpc.hp).toBe(177)

      // Second impact attempt at t = 1.3 (0.3s later < 0.6s cooldown) -> blocked
      resolveMountImpacts([mount], player, [hostileFootNpc], 1.3, { onDamagePlayer })
      expect(hostileFootNpc.hp).toBe(177)

      // Third impact attempt at t = 1.7 (0.7s later > 0.6s cooldown) -> applies 23 damage (HP = 154)
      resolveMountImpacts([mount], player, [hostileFootNpc], 1.7, { onDamagePlayer })
      expect(hostileFootNpc.hp).toBe(154)
    })

    it('8. Charge hit + overlap in the same frame -> Lance charge applies, Horse Impact does not', () => {
      const scene = new THREE.Scene()
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.state = MountState.CONTROLLED
      mount.riderFaction = Faction.ENEMY
      mount.previousPosition.set(0, 0, -2)
      mount.group.position.set(0, 0, 2)
      mount.movementSpeed = 12
      // Simulated Lance charge hit sets skipImpactThisFrame = true
      mount.skipImpactThisFrame = true

      const hostileFootNpc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'HostileFoot', 1, false)
      hostileFootNpc.group.position.set(0, 0, 0)
      expect(hostileFootNpc.hp).toBe(200)

      const player = new Player(scene, 'viking')
      player.group.position.set(100, 0, 100)

      // When skipImpactThisFrame is true, checkMountImpact is false
      expect(checkMountImpact(mount, hostileFootNpc.combatPosition, 0.5)).toBe(false)

      resolveMountImpacts([mount], player, [hostileFootNpc], 1.0, { onDamagePlayer: vi.fn() })
      // Mount impact is suppressed; NPC takes no impact damage
      expect(hostileFootNpc.hp).toBe(200)
    })

    it('9. Following normal movement frame can use impact again when eligible', () => {
      const scene = new THREE.Scene()
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.state = MountState.CONTROLLED
      mount.riderFaction = Faction.ENEMY
      mount.previousPosition.set(0, 0, -2)
      mount.group.position.set(0, 0, 2)
      mount.movementSpeed = 10
      // Frame 1: skipImpactThisFrame suppressed impact
      mount.skipImpactThisFrame = true

      const hostileFootNpc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'HostileFoot', 1, false)
      hostileFootNpc.group.position.set(0, 0, 0)
      hostileFootNpc.shieldId = null

      const player = new Player(scene, 'viking')
      player.group.position.set(100, 0, 100)

      const onDamagePlayer = vi.fn()
      resolveMountImpacts([mount], player, [hostileFootNpc], 1.0, { onDamagePlayer })
      expect(hostileFootNpc.hp).toBe(200)

      // Frame ends -> reset skipImpactThisFrame = false
      mount.skipImpactThisFrame = false

      // Frame 2 at t = 2.0 -> normal movement can impact
      resolveMountImpacts([mount], player, [hostileFootNpc], 2.0, { onDamagePlayer })
      expect(hostileFootNpc.hp).toBe(177)
    })

    it('10. Player Lance charge miss leaves Horse Impact enabled in the same frame', () => {
      const scene = new THREE.Scene()
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.state = MountState.CONTROLLED
      mount.previousPosition.set(0, 0, -2)
      mount.group.position.set(0, 0, 2)
      mount.movementSpeed = 12 // Charge-qualified: strictly greater than 10 m/s

      const enemyNpc = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanFoot', 1, false)
      enemyNpc.group.position.set(0, 0, 0) // On the mount sweep, but behind the Player's Lance
      enemyNpc.shieldId = null

      const player = {
        dead: false,
        spectatorOnly: false,
        isMounted: true,
        currentMount: mount,
        characterFaction: 'viking',
        hasShield: false,
        facingYaw: 0,
        combatPosition: new THREE.Vector3(0, 0, 2),
        isHitFrame: () => true,
        isLanceThrustActive: false,
        weaponSweep: { traceFirst: () => undefined },
        getSwordTipPosition: () => new THREE.Vector3(0, 1, 6),
        hasPrevLanceTip: true,
        prevLanceTipPos: new THREE.Vector3(0, 1, 5),
        getWeaponGripPosition: (out: THREE.Vector3) => out.set(0, 1, 2),
        markHitProcessed: vi.fn(),
        updatePrevLanceTip: vi.fn(),
      }
      const game = {
        player,
        controlMode: 'player',
        inventoryManager: { equippedMelee: WEAPONS.heavy_lance },
        skillManager: { getMultiplier: () => 1, addXp: vi.fn() },
        npcs: [enemyNpc],
        npcGrid: { getNearbyInto: () => [enemyNpc] },
        combatMountGrid: { getNearbyInto: () => [] }, meleeMountCandidates: [],
        _tmpGripPos: new THREE.Vector3(),
        _tmpPlayerForward: new THREE.Vector3(),
        _tmpAiCenter: new THREE.Vector3(),
        _tmpToTarget: new THREE.Vector3(),
        _applyLanceChargeBonus: (Game.prototype as any)._applyLanceChargeBonus,
        _tryDamageObstacleWithMelee: vi.fn(() => false),
        soundManager: { playHit: vi.fn() },
        damageNumbers: { spawn: vi.fn() },
        _showEnemyHud: vi.fn(),
      }

      // Exercise Game's real Lance-hit path. The NPC is behind the Lance, so it misses.
      ;(Game.prototype as any)._checkPlayerMeleeHits.call(game)
      expect(mount.skipImpactThisFrame).toBe(false)

      // The same-frame sweep must remain eligible for Horse Impact: 8 + 12 * 1.5 = 26.
      const damage = calculateMountImpactDamage(mount.movementSpeed, mount.isSprinting)
      resolveMountImpacts([mount], player as any, [enemyNpc], 1.0, { onDamagePlayer: vi.fn() })
      expect(enemyNpc.hp).toBe(200 - damage)
    })

    it('11. Player-owned mount at 10 m/s impacts ENEMY NPC for 23; allied (PLAYER) NPC is not hit', () => {
      const scene = new THREE.Scene()

      // Player owns this mount via player.currentMount (riderFaction intentionally left null)
      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.previousPosition.set(0, 0, -2)
      mount.group.position.set(0, 0, 2)
      mount.movementSpeed = 10
      mount.isSprinting = false

      const player = new Player(scene, 'viking')
      player.group.position.set(0, 0, 0)
      player.mountVehicle(mount)
      // mountVehicle sets currentMount and state=CONTROLLED but does NOT set riderFaction
      expect(mount.riderFaction).toBeNull()
      expect(player.currentMount).toBe(mount)

      const enemyNpc = new NPC(scene, 0, 2, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanFoot', 1, false)
      enemyNpc.group.position.set(0, 0, 0)
      enemyNpc.shieldId = null
      expect(enemyNpc.hp).toBe(200)

      const alliedNpc = new NPC(scene, 0, 2, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingFoot', 1, false)
      alliedNpc.group.position.set(0, 0, 0)
      alliedNpc.shieldId = null
      expect(alliedNpc.hp).toBe(200)

      resolveMountImpacts([mount], player, [enemyNpc, alliedNpc], 1.0, { onDamagePlayer: vi.fn() })

      // Enemy NPC takes 23 damage (8 + 10 * 1.5)
      expect(enemyNpc.hp).toBe(177)
      // Allied NPC is unharmed (Player mount only targets Faction.ENEMY)
      expect(alliedNpc.hp).toBe(200)
    })

    it('12. Player-owned mount impact works correctly even when mount.riderFaction is null', () => {
      const scene = new THREE.Scene()

      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.previousPosition.set(0, 0, -2)
      mount.group.position.set(0, 0, 2)
      mount.movementSpeed = 12
      mount.isSprinting = false
      // riderFaction is explicitly null — ownership detected via player.currentMount only
      mount.riderFaction = null

      const player = new Player(scene, 'viking')
      player.group.position.set(0, 0, 0)
      player.mountVehicle(mount)
      expect(player.currentMount).toBe(mount)
      expect(mount.riderFaction).toBeNull()

      const enemyNpc = new NPC(scene, 0, 2, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanFoot', 1, false)
      enemyNpc.group.position.set(0, 0, 0)
      enemyNpc.shieldId = null

      resolveMountImpacts([mount], player, [enemyNpc], 1.0, { onDamagePlayer: vi.fn() })

      // Sprint speed 12, isSprinting = false: 8 + 12 * 1.5 = 26
      const expectedDamage = calculateMountImpactDamage(12, false)
      expect(enemyNpc.hp).toBe(200 - expectedDamage)
    })

    it('13. Enemy NPC mount -> Player uses the authoritative callback with shield and mount routing', () => {
      const scene = new THREE.Scene()

      const mount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => mount.dispose())
      expect(mount.horseVisual).not.toBeNull()
      mount.state = MountState.CONTROLLED
      mount.riderFaction = Faction.ENEMY
      mount.previousPosition.set(0, 0, -2)
      mount.group.position.set(0, 0, 2)
      mount.movementSpeed = 10
      mount.isSprinting = false

      const player = new Player(scene, 'viking')
      const playerMount = new Mount(scene, MountType.HORSE, 0, 0, 0)
      onTestFinished(() => playerMount.dispose())
      expect(playerMount.horseVisual).not.toBeNull()
      player.mountVehicle(playerMount)
      player.group.position.set(0, 0, 0) // Player target position is in the enemy mount's sweep.
      const hpBar = { setFill: vi.fn() } as any
      const onDamagePlayer = vi.fn((damage: number, context?: any) =>
        damagePlayer(player, damage, hpBar, 'round_shield_t2', context)
      )
      const onEnemyMountHitPlayer = vi.fn()

      resolveMountImpacts([mount], player, [], 1.0, { onDamagePlayer, onEnemyMountHitPlayer })

      // The resolver supplies raw impact damage to the authoritative callback exactly once.
      expect(onDamagePlayer).toHaveBeenCalledTimes(1)
      expect(onDamagePlayer).toHaveBeenCalledWith(23, expect.objectContaining({ method: 'mount-impact' }))
      // The callback applies the equipped T2 shield (15%) and routes damage to the mounted Player's horse.
      expect(playerMount.currentHp).toBeCloseTo(100 - 23)
      expect(onEnemyMountHitPlayer).toHaveBeenCalledWith(
        23,
        expect.objectContaining({ isMountHit: true, targetName: playerMount.displayName })
      )
    })
  })
})
