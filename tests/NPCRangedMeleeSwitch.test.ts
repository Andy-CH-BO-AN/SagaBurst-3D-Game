import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AIState, AIType, Faction, NPC } from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { Mount, MountType } from '../src/world/Mount'
import { getRangedCooldown } from '../src/combat/CombatBalance'
import {
  BACKWARD_SPEED_MULTIPLIER,
  FORWARD_SPEED_MULTIPLIER,
  LATERAL_SPEED_MULTIPLIER,
  getDirectionalMovementFromVector,
} from '../src/movement/DirectionalMovement'

describe('NPC Ranged Melee Switch & Distance Boundaries', () => {
  let scene: THREE.Scene
  let player: Player

  beforeEach(() => {
    scene = new THREE.Scene()
    player = new Player(scene)
    player.setPosition(0, 0, 0)
  })

  function updateNpc(npc: NPC, dt = 0.016, onFireArrow = () => {}) {
    player.group.position.y = npc.combatPosition.y
    npc.update(
      dt,
      player,
      [npc],
      [npc],
      [],
      null as any,
      () => {},
      onFireArrow,
      true, // skipBoidsAndObstacles
    )
  }

  it('NPC pilum releases once and completes recovery before switching an empty loadout to melee', () => {
    const npc = new NPC(scene, 0, 10, Faction.ENEMY, 'roman', AIType.RANGED, 'PilumThrower', 2, false, {
      meleeWeaponId: 'gladius_rusty',
      rangedWeaponId: 'pilum_standard',
      shieldId: null,
      mountId: null,
    })
    npc.state = AIState.ATTACK
    ;(npc as any).arrows = 1
    updateNpc(npc, 0)
    const animator = (npc as any).animator
    const cancel = vi.spyOn(animator, 'cancel')
    const projectiles = vi.fn()
    ;(npc as any).attackTimer = 10

    updateNpc(npc, 0.44, projectiles)
    expect(npc.combatAnimationAction).toBe('pilumThrow')
    expect(projectiles).not.toHaveBeenCalled()
    expect((npc as any).bowPivot.visible).toBe(true)

    updateNpc(npc, 0.02, projectiles)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(projectiles.mock.calls[0][2]).toBe('pilum')
    expect(npc.combatAnimationAction).toBe('pilumThrow')
    expect((npc as any).bowPivot.visible).toBe(false)
    expect(npc.currentState).toBe(AIState.ATTACK)
    expect(cancel).not.toHaveBeenCalled()

    updateNpc(npc, 0.15, projectiles)
    expect(npc.combatAnimationAction).toBe('pilumThrow')
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(npc.currentState).toBe(AIState.ATTACK)

    updateNpc(npc, 0.10, projectiles)
    expect(npc.combatAnimationAction).toBe('idle')
    expect(npc.currentState).toBe(AIState.CHASE)
    expect((npc as any).swordPivot.visible).toBe(true)
    expect((npc as any).bowPivot.visible).toBe(false)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('schedules an imported pilumThrow from its canonical 1.5s clip duration', () => {
    const npc = new NPC(scene, 0, 10, Faction.ENEMY, 'roman', AIType.RANGED, 'ImportedPilumThrower', 2, false, {
      meleeWeaponId: 'gladius_rusty',
      rangedWeaponId: 'pilum_standard',
      shieldId: null,
      mountId: null,
    })
    npc.state = AIState.ATTACK
    ;(npc as any).arrows = 2
    ;(npc as any).rig.animation = {
      has: (state: string) => state === 'pilumThrow',
      getDuration: (state: string) => state === 'pilumThrow' ? 1.5 : undefined,
      play: () => true,
      update: () => {},
      setEquipmentState: () => {},
    }
    ;(npc as any).attackTimer = getRangedCooldown('javelin') - 1.5
    const projectiles = vi.fn()

    updateNpc(npc, 0.016, projectiles)
    expect(npc.combatAnimationAction).toBe('pilumThrow')
    updateNpc(npc, 1.483, projectiles)
    expect(projectiles).not.toHaveBeenCalled()
    expect(npc.combatAnimationAction).toBe('pilumThrow')

    updateNpc(npc, 0.001, projectiles)
    expect(projectiles).toHaveBeenCalledTimes(1)
    expect(npc.combatAnimationAction).toBe('idle')
    expect(npc.currentState).toBe(AIState.CHASE)
    expect(npc.arrows).toBe(1)
  })

  function createMountedNpc(
    x: number,
    z: number,
    faction: Faction,
    aiType: AIType,
    name: string,
  ): { npc: NPC; mount: Mount } {
    const mount = new Mount(scene, MountType.CORGI, x, z)
    const npc = new NPC(scene, x, z, faction, faction === Faction.ENEMY ? 'roman' : 'viking', aiType, name, 1, false)
    npc.mount = mount
    mount.setNpcRider(npc, faction)
    return { npc, mount }
  }

  describe('Distance Boundaries for Foot Archer', () => {
    it('switches to melee commit at 5.9m (dist < 6m)', () => {
      const npc = new NPC(scene, 0, 5.9, Faction.ENEMY, 'roman', AIType.RANGED, 'FootArcher', 1, false)
      npc.state = AIState.CHASE
      expect(npc.arrows).toBeGreaterThan(0)
      expect((npc as any).bowPivot.visible).toBe(true)

      updateNpc(npc)

      // Must switch to melee immediately
      expect(npc.arrows).toBe(0)
      expect((npc as any).swordPivot.visible).toBe(true)
      expect((npc as any).bowPivot.visible).toBe(false)
      // Remained in CHASE to charge target (distance 5.9m > meleeAttackRadius)
      expect(npc.state).toBe(AIState.CHASE)
    })

    it('stays ranged at 6.0m (6m <= dist <= 22m)', () => {
      const npc = new NPC(scene, 0, 6.0, Faction.ENEMY, 'roman', AIType.RANGED, 'FootArcher', 1, false)
      npc.state = AIState.CHASE
      expect(npc.arrows).toBeGreaterThan(0)

      updateNpc(npc)

      // Enters ranged attack
      expect(npc.state).toBe(AIState.ATTACK)
      expect(npc.arrows).toBeGreaterThan(0)
      expect((npc as any).bowPivot.visible).toBe(true)
    })

    it('stays ranged at max distance boundary (6m <= dist <= maxDist)', () => {
      const npc = new NPC(scene, 0, 10.0, Faction.ENEMY, 'roman', AIType.RANGED, 'FootArcher', 1, false)
      const maxDist = npc.maxRangedAttackDistance
      npc.group.position.set(0, 0, maxDist)
      npc.state = AIState.CHASE
      expect(npc.arrows).toBeGreaterThan(0)

      updateNpc(npc)

      // Enters ranged attack at boundary
      expect(npc.state).toBe(AIState.ATTACK)
      expect(npc.arrows).toBeGreaterThan(0)
    })

    it('approaches target beyond max distance (dist > maxDist)', () => {
      const npc = new NPC(scene, 0, 10.0, Faction.ENEMY, 'roman', AIType.RANGED, 'FootArcher', 1, false)
      const maxDist = npc.maxRangedAttackDistance
      npc.group.position.set(0, 0, maxDist + 0.1)
      npc.state = AIState.CHASE
      expect(npc.arrows).toBeGreaterThan(0)

      updateNpc(npc)

      // Stays in CHASE to approach (does not start ranged attack)
      expect(npc.state).toBe(AIState.CHASE)
      expect(npc.arrows).toBeGreaterThan(0)
    })

    it('transitions from ATTACK to CHASE if target retreats past max distance', () => {
      const npc = new NPC(scene, 0, 10.0, Faction.ENEMY, 'roman', AIType.RANGED, 'FootArcher', 1, false)
      const maxDist = npc.maxRangedAttackDistance
      npc.group.position.set(0, 0, maxDist + 0.1)
      npc.state = AIState.ATTACK
      expect(npc.arrows).toBeGreaterThan(0)

      updateNpc(npc)

      // Cancels attack and switches to CHASE to approach
      expect(npc.state).toBe(AIState.CHASE)
      expect(npc.arrows).toBeGreaterThan(0)
    })
  })

  describe('Distance Boundaries for Mounted Archer', () => {
    it('mounted archer switches to melee commit at 5.9m (dist < 6m)', () => {
      const { npc } = createMountedNpc(0, 5.9, Faction.ENEMY, AIType.RANGED, 'HorseArcher')
      npc.state = AIState.CHASE
      expect(npc.isMounted).toBe(true)
      expect(npc.arrows).toBeGreaterThan(0)

      updateNpc(npc)

      // Must switch to melee
      expect(npc.arrows).toBe(0)
      expect((npc as any).swordPivot.visible).toBe(true)
      expect((npc as any).bowPivot.visible).toBe(false)
      expect(npc.state).toBe(AIState.CHASE)
    })

    it('mounted archer in ATTACK commits to melee when player gets within 5.9m', () => {
      const { npc } = createMountedNpc(0, 5.9, Faction.ENEMY, AIType.RANGED, 'HorseArcher')
      npc.state = AIState.ATTACK
      expect(npc.arrows).toBeGreaterThan(0)

      updateNpc(npc)

      expect(npc.arrows).toBe(0)
      expect((npc as any).swordPivot.visible).toBe(true)
      expect(npc.state).toBe(AIState.CHASE)
    })

    it('mounted archer stays ranged and orbits in 6.0m to 22.0m', () => {
      const { npc } = createMountedNpc(0, 15.0, Faction.ENEMY, AIType.RANGED, 'HorseArcher')
      npc.state = AIState.CHASE

      updateNpc(npc)

      expect(npc.state).toBe(AIState.ATTACK)
      expect(npc.arrows).toBeGreaterThan(0)
      expect((npc as any).bowPivot.visible).toBe(true)
    })
  })

  describe('Melee Commit Irreversibility', () => {
    it('does NOT re-equip bow when enemy retreats to 10m or 25m after <6m melee commit', () => {
      // Step 1: Trigger melee switch at 5.0m
      const npc = new NPC(scene, 0, 5.0, Faction.ENEMY, 'roman', AIType.RANGED, 'FootArcher', 1, false)
      npc.state = AIState.CHASE
      updateNpc(npc)

      expect(npc.arrows).toBe(0)
      expect((npc as any).swordPivot.visible).toBe(true)
      expect((npc as any).bowPivot.visible).toBe(false)

      // Step 2: Player pulls back to 10.0m (within original ranged bracket)
      player.setPosition(0, 0, -10.0)
      updateNpc(npc)

      // Must remain in melee (arrows stay 0, sword visible, bow hidden)
      expect(npc.arrows).toBe(0)
      expect((npc as any).swordPivot.visible).toBe(true)
      expect((npc as any).bowPivot.visible).toBe(false)

      // Step 3: Player pulls back to 25.0m
      player.setPosition(0, 0, -25.0)
      updateNpc(npc)

      expect(npc.arrows).toBe(0)
      expect((npc as any).swordPivot.visible).toBe(true)
      expect((npc as any).bowPivot.visible).toBe(false)
    })
  })

  describe('NPC Facing and Movement Direction Evaluation', () => {
    it('applies 100% speed when moveDir is aligned with facing (forward)', () => {
      const facing = new THREE.Vector3(0, 0, 1)
      const moveDir = new THREE.Vector3(0, 0, 1)
      const policy = getDirectionalMovementFromVector(facing, moveDir)

      expect(policy.direction).toBe('forward')
      expect(policy.multiplier).toBe(FORWARD_SPEED_MULTIPLIER)
    })

    it('applies 30% speed when moveDir is opposite to facing (backward)', () => {
      const facing = new THREE.Vector3(0, 0, 1)
      const moveDir = new THREE.Vector3(0, 0, -1)
      const policy = getDirectionalMovementFromVector(facing, moveDir)

      expect(policy.direction).toBe('backward')
      expect(policy.multiplier).toBe(BACKWARD_SPEED_MULTIPLIER)
    })

    it('applies 100% speed when moveDir is lateral (left / right)', () => {
      const facing = new THREE.Vector3(0, 0, 1)
      const moveLeft = new THREE.Vector3(-1, 0, 0)
      const moveRight = new THREE.Vector3(1, 0, 0)

      expect(getDirectionalMovementFromVector(facing, moveLeft).multiplier).toBe(LATERAL_SPEED_MULTIPLIER)
      expect(getDirectionalMovementFromVector(facing, moveRight).multiplier).toBe(LATERAL_SPEED_MULTIPLIER)
    })

    it('applies 30% speed when moveDir is backward-diagonal (backward-left / backward-right)', () => {
      const facing = new THREE.Vector3(0, 0, 1)
      const moveBackLeft = new THREE.Vector3(-1, 0, -1).normalize()
      const moveBackRight = new THREE.Vector3(1, 0, -1).normalize()

      expect(getDirectionalMovementFromVector(facing, moveBackLeft).multiplier).toBe(BACKWARD_SPEED_MULTIPLIER)
      expect(getDirectionalMovementFromVector(facing, moveBackRight).multiplier).toBe(BACKWARD_SPEED_MULTIPLIER)
    })

    it('updates foot NPC position at 30% speed when moving backward', () => {
      const npc = new NPC(scene, 0, 10, Faction.PLAYER, 'viking', AIType.MELEE, 'TestNPC', 1, false)
      npc.group.rotation.y = 0 // facing +Z
      const startPos = npc.group.position.clone()

      // Call _moveByDirection with backward direction (0, 0, -1)
      const backwardDir = new THREE.Vector3(0, 0, -1)
      ;(npc as any)._moveByDirection(backwardDir, 10.0, 0.1)

      const dist = Math.hypot(npc.group.position.x - startPos.x, npc.group.position.z - startPos.z)
      // baseSpeed = 10, backward multiplier = 0.3, dt = 0.1 -> 10 * 0.3 * 0.1 = 0.3
      expect(dist).toBeCloseTo(0.3, 5)
      expect((npc as any).visualMovementSpeed).toBeCloseTo(3.0, 5) // 10 * 0.3
    })

    it('updates mounted NPC position at 30% speed when moving backward', () => {
      const { npc, mount } = createMountedNpc(0, 10, Faction.PLAYER, AIType.MELEE, 'MountedNPC')
      mount.group.rotation.y = 0 // mount facing +Z
      mount.group.position.set(0, 0, 10)
      const startPos = mount.group.position.clone()

      // Call _moveByDirection with backward direction (0, 0, -1)
      const backwardDir = new THREE.Vector3(0, 0, -1)
      ;(npc as any)._moveByDirection(backwardDir, mount.baseSpeed, 0.1)

      const dist = Math.hypot(mount.group.position.x - startPos.x, mount.group.position.z - startPos.z)
      // mount baseSpeed = 12, backward multiplier = 0.3, dt = 0.1 -> 12 * 0.3 * 0.1 = 0.36
      expect(dist).toBeCloseTo(0.36, 5)
      expect((npc as any).visualMovementSpeed).toBeCloseTo(3.6, 5) // 12 * 0.3
    })

    it('updates mounted NPC position at 50% speed when moving lateral/orbiting (mount.baseSpeed * 0.5)', () => {
      const { npc, mount } = createMountedNpc(0, 10, Faction.PLAYER, AIType.RANGED, 'MountedArcher')
      mount.group.rotation.y = 0 // mount facing +Z
      mount.group.position.set(0, 0, 10)
      const startPos = mount.group.position.clone()

      // Call _moveByDirection with lateral direction (+X, 1, 0, 0)
      const lateralDir = new THREE.Vector3(1, 0, 0)
      ;(npc as any)._moveByDirection(lateralDir, mount.baseSpeed, 0.1)

      const dist = Math.hypot(mount.group.position.x - startPos.x, mount.group.position.z - startPos.z)
      // mount baseSpeed = 12, lateral mount multiplier = 0.5, dt = 0.1 -> 12 * 0.5 * 0.1 = 0.6
      expect(dist).toBeCloseTo(0.6, 5)
      expect((npc as any).visualMovementSpeed).toBeCloseTo(6.0, 5) // 12 * 0.5
    })

    it('updates foot NPC position at 100% speed when moving lateral', () => {
      const npc = new NPC(scene, 0, 10, Faction.PLAYER, 'viking', AIType.MELEE, 'FootNPC', 1, false)
      npc.group.rotation.y = 0 // facing +Z
      const startPos = npc.group.position.clone()

      // Call _moveByDirection with lateral direction (+X, 1, 0, 0)
      const lateralDir = new THREE.Vector3(1, 0, 0)
      ;(npc as any)._moveByDirection(lateralDir, 10.0, 0.1)

      const dist = Math.hypot(npc.group.position.x - startPos.x, npc.group.position.z - startPos.z)
      // foot baseSpeed = 10, lateral multiplier = 1.0, dt = 0.1 -> 10 * 1.0 * 0.1 = 1.0
      expect(dist).toBeCloseTo(1.0, 5)
      expect((npc as any).visualMovementSpeed).toBeCloseTo(10.0, 5)
    })

    it('early returns on zero vector movement without altering position or visualMovementSpeed', () => {
      const npc = new NPC(scene, 0, 10, Faction.PLAYER, 'viking', AIType.MELEE, 'TestNPC', 1, false)
      ;(npc as any).visualMovementSpeed = 0
      const startPos = npc.group.position.clone()

      const zeroDir = new THREE.Vector3(0, 0, 0)
      ;(npc as any)._moveByDirection(zeroDir, 10.0, 0.1)

      expect(npc.group.position.distanceTo(startPos)).toBe(0)
      expect((npc as any).visualMovementSpeed).toBe(0)
    })
  })
})
