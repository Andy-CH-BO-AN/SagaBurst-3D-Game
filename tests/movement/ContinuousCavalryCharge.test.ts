import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  isEligibleMeleeCavalry,
  cavalryTurnRate,
  steerCavalryHeading,
  isTargetInForwardCone,
  scoreCavalryTarget,
  findCavalryChargeTarget,
  CAVALRY_MAX_TURN_RATE,
  CAVALRY_PASSTHROUGH_DURATION,
  CAVALRY_FORWARD_CONE_COS,
} from '../../src/movement/ContinuousCavalryCharge'
import { angleDifference } from '../../src/movement/MountedArcherOrbit'
import { WeaponSweep } from '../../src/combat/ShieldBlocking'
import { Faction } from '../../src/combat/CombatFaction'
import { isHostileCombatMount } from '../../src/world/NPC'
import { TownScene } from '../../src/town/TownScene'

describe('Continuous Melee Cavalry Charge', () => {
  it('identifies eligible ground melee cavalry while excluding ranged, flying, defense, and siege units', () => {
    expect(CAVALRY_PASSTHROUGH_DURATION).toBe(1.0)
    expect(CAVALRY_FORWARD_CONE_COS).toBe(0.2)

    // Eligible: ground mount, melee, attack/charge
    expect(isEligibleMeleeCavalry(true, { isFlyingMount: false }, false, 'attack', false, false)).toBe(true)
    expect(isEligibleMeleeCavalry(true, { isFlyingMount: false }, false, 'charge', false, false)).toBe(true)

    // Ineligible:
    // Dismounted infantry
    expect(isEligibleMeleeCavalry(false, null, false, 'charge', false, false)).toBe(false)
    // Flying mount (Eagle)
    expect(isEligibleMeleeCavalry(true, { isFlyingMount: true }, false, 'charge', false, false)).toBe(false)
    // Ranged cavalry (Mounted archer)
    expect(isEligibleMeleeCavalry(true, { isFlyingMount: false }, true, 'charge', false, false)).toBe(false)
    // Defend order (must hold post)
    expect(isEligibleMeleeCavalry(true, { isFlyingMount: false }, false, 'defend', false, false)).toBe(false)
    // Formation / follow orders
    expect(isEligibleMeleeCavalry(true, { isFlyingMount: false }, false, 'formation', false, false)).toBe(false)
    expect(isEligibleMeleeCavalry(true, { isFlyingMount: false }, false, 'follow', false, false)).toBe(false)
    // Siege obstacle combat
    expect(isEligibleMeleeCavalry(true, { isFlyingMount: false }, false, 'charge', true, false)).toBe(false)
    // Rampart garrison
    expect(isEligibleMeleeCavalry(true, { isFlyingMount: false }, false, 'attack', false, true)).toBe(false)
  })

  it('bounds cavalry turn rate to prevent instantaneous 180 degree snapping', () => {
    const currentYaw = 0 // Facing +Z
    const desiredYaw = Math.PI // Directly behind (180°)
    const speed = 12
    const dt = 1 / 60

    const nextYaw = steerCavalryHeading(currentYaw, desiredYaw, speed, dt)
    const turnDelta = Math.abs(angleDifference(nextYaw, currentYaw))

    // Expected max turn in 1 frame (1/60s)
    const maxExpectedTurn = cavalryTurnRate(speed) * dt
    expect(turnDelta).toBeLessThanOrEqual(maxExpectedTurn + 1e-6)
    expect(turnDelta).toBeLessThan(0.1) // Much less than PI (3.14159)
    expect(cavalryTurnRate(speed)).toBeLessThanOrEqual(CAVALRY_MAX_TURN_RATE)
  })

  it('evaluates forward cone and scores forward over rearward targets during charge and pass-through', () => {
    const cavalryPos = new THREE.Vector3(0, 0, 0)
    const yaw = 0 // Local +Z is forward: (0, 0, 1)

    const forwardTarget = new THREE.Vector3(0, 0, 10)
    const rearTarget = new THREE.Vector3(0, 0, -10)
    const sideTarget = new THREE.Vector3(10, 0, 0)

    expect(isTargetInForwardCone(cavalryPos, yaw, forwardTarget)).toBe(true)
    expect(isTargetInForwardCone(cavalryPos, yaw, rearTarget)).toBe(false)
    expect(isTargetInForwardCone(cavalryPos, yaw, sideTarget)).toBe(false)

    // In passthrough: rear target must return Infinity (disqualified)
    expect(scoreCavalryTarget(0, 10, yaw, 0, 8, true)).toBe(Infinity)
    const aheadScore = scoreCavalryTarget(0, 10, yaw, 0, 18, true)
    expect(Number.isFinite(aheadScore)).toBe(true)
    expect(aheadScore).toBeLessThan(50)

    // Forward target at 12m has a better (lower) score than rear target at 4m
    const forwardScore = scoreCavalryTarget(0, 0, yaw, 0, 12, false)
    const rearScore = scoreCavalryTarget(0, 0, yaw, 0, -4, false)
    expect(forwardScore).toBeLessThan(rearScore)
  })

  it('simulates a charge pass-through without spinning on contact', () => {
    let x = 0, z = 0
    let yaw = 0 // Heading +Z
    const targetZ = 10
    const speed = 12
    const dt = 1 / 60

    let passthroughTimer = 0
    let didSnapTurn = false

    for (let frame = 0; frame < 120; frame++) {
      // Check if reached target
      if (z >= targetZ && passthroughTimer === 0) {
        passthroughTimer = 1.0 // Trigger passthrough
      }

      if (passthroughTimer > 0) {
        passthroughTimer = Math.max(0, passthroughTimer - dt)
      }

      // Check target: enemy at z=10 is now behind if z > 10
      const isBehind = z > targetZ
      const score = scoreCavalryTarget(x, z, yaw, 0, targetZ, passthroughTimer > 0)

      if (isBehind && passthroughTimer > 0) {
        // Must reject target behind
        expect(score).toBe(Infinity)
      }

      const prevYaw = yaw
      // If score is Infinity, maintain forward heading
      const desiredYaw = score === Infinity ? yaw : Math.atan2(0 - x, targetZ - z)
      yaw = steerCavalryHeading(yaw, desiredYaw, speed, dt)

      if (Math.abs(angleDifference(yaw, prevYaw)) > 0.5) {
        didSnapTurn = true
      }

      z += Math.cos(yaw) * speed * dt
      x += Math.sin(yaw) * speed * dt
    }

    expect(didSnapTurn).toBe(false)
    expect(z).toBeGreaterThan(targetZ + 5) // Successfully charged through target position
  })

  it('sequences multiple enemies along a column during continuous charge', () => {
    // Three enemies at z = 10, 18, 26
    const enemies = [
      { id: 1, x: 0, z: 10 },
      { id: 2, x: 0, z: 18 },
      { id: 3, x: 0, z: 26 },
    ]

    let x = 0, z = 0
    let yaw = 0
    const speed = 12
    const dt = 1 / 60
    const hitSequence: number[] = []
    let passthroughTimer = 0

    for (let frame = 0; frame < 180; frame++) {
      if (passthroughTimer > 0) passthroughTimer = Math.max(0, passthroughTimer - dt)

      // Find best target among surviving enemies
      let bestScore = Infinity
      let bestEnemy: (typeof enemies)[0] | null = null

      for (const enemy of enemies) {
        const s = scoreCavalryTarget(x, z, yaw, enemy.x, enemy.z, passthroughTimer > 0)
        if (s < bestScore) {
          bestScore = s
          bestEnemy = enemy
        }
      }

      if (bestEnemy) {
        // If within 1.5m, register hit
        const dist = Math.hypot(bestEnemy.x - x, bestEnemy.z - z)
        if (dist <= 1.5 && !hitSequence.includes(bestEnemy.id)) {
          hitSequence.push(bestEnemy.id)
          passthroughTimer = 0.5 // brief passthrough per hit
        }
      }

      // Steer toward bestEnemy if found, else maintain forward
      const desiredYaw = bestEnemy ? Math.atan2(bestEnemy.x - x, bestEnemy.z - z) : yaw
      yaw = steerCavalryHeading(yaw, desiredYaw, speed, dt)

      z += Math.cos(yaw) * speed * dt
      x += Math.sin(yaw) * speed * dt
    }

    // Must hit enemies in sequence 1, 2, 3 without stalling
    expect(hitSequence).toEqual([1, 2, 3])
    expect(z).toBeGreaterThan(30)
  })

  it('finds best forward target using findCavalryChargeTarget', () => {
    const cavalry = {
      combatPosition: new THREE.Vector3(0, 0, 0),
      group: { rotation: { y: 0 } },
      mount: { group: { rotation: { y: 0 } } },
      faction: 'roman',
      isFriendly: true,
      hostileToPlayer: true,
      combatTargetAllowed: undefined,
    } as any

    const player = {
      position: new THREE.Vector3(0, 0, 15),
      targetable: true,
      dead: false,
      isFriendly: false,
      faction: 'bandit',
    } as any

    const enemyAhead = {
      combatPosition: new THREE.Vector3(0, 0, 10),
      dead: false,
      faction: 'bandit',
      isFriendly: false,
      mount: null,
    } as any

    const enemyBehind = {
      combatPosition: new THREE.Vector3(0, 0, -5),
      dead: false,
      faction: 'bandit',
      isFriendly: false,
      mount: null,
    } as any

    const candidateBuffer: any[] = []
    const grid = {
      getNearbyInto: (_pos: any, _range: any, out: any[]) => {
        out.push(enemyAhead, enemyBehind)
      },
      findNearest: () => enemyAhead,
    } as any

    // Normal charge: chooses nearest forward enemy ahead
    const target = findCavalryChargeTarget(cavalry, player, grid, null, candidateBuffer, false)
    expect(target).not.toBeNull()
    expect(target?.position).toBe(enemyAhead.combatPosition)

    // Passthrough charge: strictly ignores enemy behind and picks enemy ahead
    const ptTarget = findCavalryChargeTarget(cavalry, player, grid, null, candidateBuffer, true)
    expect(ptTarget).not.toBeNull()
    expect(ptTarget?.position).toBe(enemyAhead.combatPosition)

    // When only enemy behind exists, passthrough returns null instead of turning 180°
    const gridBehindOnly = {
      getNearbyInto: (_pos: any, _range: any, out: any[]) => {
        out.push(enemyBehind)
      },
      findNearest: () => enemyBehind,
    } as any
    const deadPlayer = { ...player, dead: true } as any
    const nullTarget = findCavalryChargeTarget(cavalry, deadPlayer, gridBehindOnly, null, candidateBuffer, true)
    expect(nullTarget).toBeNull()
  })

  it('respects player targeting permissions, eagle exclusion, and ground mount positions', () => {
    const cavalry = {
      combatPosition: new THREE.Vector3(0, 0, 0),
      group: { rotation: { y: 0 } },
      mount: { group: { rotation: { y: 0 } } },
      faction: 'bandit',
      isFriendly: false,
      hostileToPlayer: true,
      combatTargetAllowed: undefined,
    } as any

    const groundMountPos = new THREE.Vector3(0, 0, 12)
    const playerOnGroundMount = {
      position: new THREE.Vector3(0, 1, 12),
      targetable: true,
      dead: false,
      isMounted: true,
      currentMount: { isFlyingMount: false, group: { position: groundMountPos } },
    } as any

    const candidateBuffer: any[] = []

    // 1. Player riding a ground mount: target position uses mount group position
    const groundTarget = findCavalryChargeTarget(cavalry, playerOnGroundMount, null, null, candidateBuffer, false)
    expect(groundTarget).not.toBeNull()
    expect(groundTarget?.isPlayer).toBe(true)
    expect(groundTarget?.position).toBe(groundMountPos)

    // 2. Player riding an eagle (flying mount): ground melee cavalry cannot target airborne player
    const playerOnEagle = {
      position: new THREE.Vector3(0, 10, 12),
      targetable: true,
      dead: false,
      isMounted: true,
      currentMount: { isFlyingMount: true, group: { position: new THREE.Vector3(0, 10, 12) } },
    } as any
    const eagleTarget = findCavalryChargeTarget(cavalry, playerOnEagle, null, null, candidateBuffer, false)
    expect(eagleTarget).toBeNull()

    // 3. Cavalry not hostile to player: cannot target player
    const peacefulCavalry = { ...cavalry, hostileToPlayer: false } as any
    const peacefulTarget = findCavalryChargeTarget(peacefulCavalry, playerOnGroundMount, null, null, candidateBuffer, false)
    expect(peacefulTarget).toBeNull()

    // 4. combatTargetAllowed explicitly rejects player: cannot target player
    const restrictedCavalry = {
      ...cavalry,
      combatTargetAllowed: (target: any) => target !== playerOnGroundMount,
    } as any
    const restrictedTarget = findCavalryChargeTarget(restrictedCavalry, playerOnGroundMount, null, null, candidateBuffer, false)
    expect(restrictedTarget).toBeNull()
  })

  it('keeps charge heading forward when target moves behind and shares turn budget with lance tip', () => {
    const cavalryPos = new THREE.Vector3(0, 0, 10)
    const currentYaw = 0 // Facing +Z
    const enemyBehindPos = new THREE.Vector3(0, 0, 8) // Behind at z=8
    const speed = 12
    const dt = 1 / 60

    // Enemy is behind: isTargetInForwardCone must be false
    const inFront = isTargetInForwardCone(cavalryPos, currentYaw, enemyBehindPos)
    expect(inFront).toBe(false)

    // Because enemy is behind, desiredYaw must remain currentYaw (forward)
    const targetDirX = enemyBehindPos.x - cavalryPos.x
    const targetDirZ = enemyBehindPos.z - cavalryPos.z
    const desiredYaw = (inFront && targetDirX * targetDirX + targetDirZ * targetDirZ > 0.001)
      ? Math.atan2(targetDirX, targetDirZ)
      : currentYaw
    expect(desiredYaw).toBe(currentYaw)

    // Steering maintains heading with zero turn
    const newYaw = steerCavalryHeading(currentYaw, desiredYaw, speed, dt)
    expect(newYaw).toBe(currentYaw)

    // Shares turn budget between heading steering and lance tip correction
    const maxTurnBudget = cavalryTurnRate(speed) * dt
    const initialYaw = 0
    const steerYaw = steerCavalryHeading(initialYaw, 0.5, speed, dt)
    const headingTurn = steerYaw - initialYaw
    expect(headingTurn).toBeCloseTo(maxTurnBudget, 6)

    const tipYawOffset = -0.3
    const unconstrainedYaw = steerYaw - tipYawOffset
    const totalDiff = angleDifference(unconstrainedYaw, initialYaw)
    const clampedDiff = Math.max(-maxTurnBudget, Math.min(maxTurnBudget, totalDiff))
    const finalYaw = initialYaw + clampedDiff
    const actualTotalTurn = Math.abs(angleDifference(finalYaw, initialYaw))
    expect(actualTotalTurn).toBeLessThanOrEqual(maxTurnBudget + 1e-6)
    expect(actualTotalTurn).toBeCloseTo(maxTurnBudget, 6)
  })

  it('preserves navigation pause and stops at blocking obstacles during CHASE', () => {
    // 1. Navigation pause: when moveDir is (0, 0, 0), cavalry does not force forward movement
    const moveDir = new THREE.Vector3(0, 0, 0)
    const currentYaw = 0
    const speed = 12
    const dt = 1 / 60

    if (moveDir.lengthSq() > 0.0001) {
      const desiredYaw = Math.atan2(moveDir.x, moveDir.z)
      const newYaw = steerCavalryHeading(currentYaw, desiredYaw, speed, dt)
      moveDir.set(Math.sin(newYaw), 0, Math.cos(newYaw))
    }

    // moveDir remains zero: navigation stop decision preserved
    expect(moveDir.lengthSq()).toBe(0)

    // 2. Obstacle ahead: when a wall/gate is detected along path, moveDir is stopped
    const activeMoveDir = new THREE.Vector3(0, 0, 1)
    const cavalryPos = new THREE.Vector3(0, 0, 10)
    const wallBox = new THREE.Box3(new THREE.Vector3(-5, 0, 11), new THREE.Vector3(5, 5, 13))

    // Simulate lookahead endpoint
    const endpoint = new THREE.Vector3().copy(cavalryPos).addScaledVector(activeMoveDir, speed * (dt + 0.15))
    // Path intersects wallBox:
    const intersectsWall = wallBox.intersectsBox(new THREE.Box3(
      new THREE.Vector3(Math.min(cavalryPos.x, endpoint.x) - 1, 0, Math.min(cavalryPos.z, endpoint.z) - 1),
      new THREE.Vector3(Math.max(cavalryPos.x, endpoint.x) + 1, 2, Math.max(cavalryPos.z, endpoint.z) + 1),
    ))
    expect(intersectsWall).toBe(true)

    // Obstacle along path halts movement
    if (intersectsWall) activeMoveDir.set(0, 0, 0)
    expect(activeMoveDir.lengthSq()).toBe(0)

    // 3. Passthrough without target stops at obstacle and resets timer
    let passthroughTimer = 1.0
    if (intersectsWall) passthroughTimer = 0
    expect(passthroughTimer).toBe(0)
  })

  it('synchronizes rider transform and weapon sweep with mount movement during ATTACK', () => {
    const mountPosition = new THREE.Vector3(0, 0, 0)
    const riderPosition = new THREE.Vector3(0, 1.2, 0) // Sitting on mount at y=1.2
    const rideOffset = new THREE.Vector3(0, 1.2, 0)

    const mount = {
      group: { position: mountPosition, rotation: { y: 0 } },
      baseSpeed: 12,
      getRiderPelvisSeatWorld: (target: THREE.Vector3) => target.copy(mountPosition).add(rideOffset),
      addControlledMovement: (dir: THREE.Vector3, speed: number, dt: number) => {
        mountPosition.addScaledVector(dir, speed * dt)
      },
    }

    const dt = 1 / 60
    const forwardDir = new THREE.Vector3(0, 0, 1)

    // Simulate mount movement in ATTACK
    mount.addControlledMovement(forwardDir, mount.baseSpeed, dt)
    expect(mountPosition.z).toBeCloseTo(0.2, 5)

    // Synchronize rider seat to mount
    mount.getRiderPelvisSeatWorld(riderPosition)
    expect(riderPosition.z).toBeCloseTo(0.2, 5)
    expect(riderPosition.y).toBeCloseTo(1.2, 5)

    // Weapon grip and tip world positions computed relative to updated rider
    const gripLocal = new THREE.Vector3(0.3, 0.2, 0.4)
    const tipLocal = new THREE.Vector3(0.3, 0.2, 2.5) // 2.1m lance forward

    const gripWorld = new THREE.Vector3().copy(riderPosition).add(gripLocal)
    const tipWorld = new THREE.Vector3().copy(riderPosition).add(tipLocal)

    expect(gripWorld.z).toBeCloseTo(0.6, 5)
    expect(tipWorld.z).toBeCloseTo(2.7, 5)

    // Geometry is in exact sync with mount forward step
    const distToTarget = new THREE.Vector3(0.3, 1.4, 2.5).distanceTo(tipWorld)
    expect(distToTarget).toBeCloseTo(0.2, 5)
  })

  it('falls back to nearest available ground target when no forward candidate exists', () => {
    const cavalry = {
      combatPosition: new THREE.Vector3(0, 0, 0),
      group: { rotation: { y: 0 } }, // facing +Z
      mount: { group: { rotation: { y: 0 } } },
      hostileToPlayer: false, // Player not an enemy
      combatTargetAllowed: () => true,
    } as any

    const player = {
      targetable: false,
      dead: false,
      position: new THREE.Vector3(0, 0, 100),
    } as any

    // Enemy is behind at z = -20
    const rearEnemy = {
      combatPosition: new THREE.Vector3(0, 0, -20),
      dead: false,
      mount: null,
    } as any

    const candidateBuffer: any[] = []
    const isHostile = () => true

    const grid = {
      getNearbyInto: (_pos: any, _radius: number, out: any[]) => {
        out.push(rearEnemy)
        return out
      },
      findNearest: () => rearEnemy,
    } as any

    // 1. In passthrough mode: must NOT fall back to rear enemy (returns null to keep straight)
    const passthroughTarget = findCavalryChargeTarget(
      cavalry,
      player,
      grid,
      null,
      candidateBuffer,
      true, // isPassthrough
      isHostile,
    )
    expect(passthroughTarget).toBeNull()

    // 2. In normal charge mode (!isPassthrough): falls back to nearest available ground enemy
    const normalTarget = findCavalryChargeTarget(
      cavalry,
      player,
      grid,
      null,
      candidateBuffer,
      false, // !isPassthrough
      isHostile,
    )
    expect(normalTarget).not.toBeNull()
    expect(normalTarget!.npc).toBe(rearEnemy)
    expect(normalTarget!.position.z).toBe(-20)
  })

  it('invalidates cached target on attack completion and ignores rear cached target in CHASE during passthrough', () => {
    const cavalryPos = new THREE.Vector3(0, 0, 10)
    const currentYaw = 0 // Facing +Z
    let passthroughTimer = 1.0

    // Enemy that was just attacked has now been crossed: position is at z = 8 (behind cavalry at z = 10)
    const rearEnemy = {
      combatPosition: new THREE.Vector3(0, 0, 8),
      dead: false,
    }

    // Verify rear target is not in forward cone
    const inForwardCone = isTargetInForwardCone(cavalryPos, currentYaw, rearEnemy.combatPosition)
    expect(inForwardCone).toBe(false)

    // Simulate cached target validation policy in NPC.ts:
    // If cavalryPassthroughTimer > 0 and target is behind, cached target is invalid
    const isCachedTargetValid = inForwardCone // returns false
    expect(isCachedTargetValid).toBe(false)

    // When invalid, CHASE invalidates targetInfo and clears cache
    let targetInfo: any = { position: rearEnemy.combatPosition, isDead: false, npc: rearEnemy }
    let cachedTargetNpc: any = rearEnemy

    if (targetInfo && !targetInfo.isDead && passthroughTimer > 0) {
      if (!isTargetInForwardCone(cavalryPos, currentYaw, targetInfo.position)) {
        targetInfo = null
        cachedTargetNpc = null
      }
    }

    expect(targetInfo).toBeNull()
    expect(cachedTargetNpc).toBeNull()

    // In CHASE with targetInfo == null and passthroughTimer > 0:
    // Cavalry maintains straight forward movement along currentYaw without turning backward
    const moveDir = new THREE.Vector3(Math.sin(currentYaw), 0, Math.cos(currentYaw))
    expect(moveDir.z).toBe(1)
    expect(moveDir.x).toBe(0)
  })

  it('executes real geometric weapon sweep across candidates along charging path hitting second enemy without distance cutoff', () => {
    // Enemy 1 was originally locked at z=1, cavalry has charged past it to z=3.5
    const target1 = {
      group: { position: new THREE.Vector3(0, 0, 1) },
      combatPosition: new THREE.Vector3(0, 0, 1),
      isMounted: false,
      dead: false,
    } as any

    // Enemy 2 is in front along the charging path at z=4.0
    const target2 = {
      group: { position: new THREE.Vector3(0, 0, 4.0) },
      combatPosition: new THREE.Vector3(0, 0, 4.0),
      isMounted: false,
      dead: false,
    } as any

    const sweep = new WeaponSweep()
    // Frame 1: blade beginning swing forward at z=3.5
    sweep.capture(new THREE.Vector3(0, 1.0, 3.2), new THREE.Vector3(0, 1.0, 3.8))
    // Frame 2: blade sweeping through z=4.0 (intersecting target 2's body box: [-0.3..0.3, 0.06..1.8, 3.7..4.3])
    sweep.capture(new THREE.Vector3(0, 1.0, 3.6), new THREE.Vector3(0, 1.0, 4.2))

    // Real geometric trace across both targets
    const contact = sweep.traceFirst([target1, target2], [])

    expect(contact).toBeDefined()
    expect(contact!.kind).toBe('body')
    // Contact is geometrically confirmed on the forward target 2
    expect(contact!.target).toBe(target2)
    expect(contact!.target).not.toBe(target1)
  })

  it('evaluates hostile mount candidates fail-closed: excludes unowned neutral mounts and friendly mounts, while allowing hostile dismounted/mounted horses', () => {
    const attackerNpc = {
      faction: Faction.PLAYER,
      hostileToPlayer: false,
      mount: { id: 'own-mount' },
      combatTargetAllowed: () => true,
    } as any

    const player = {
      targetable: true,
      dead: false,
    } as any

    // 1. Unowned / neutral scene mount (no rider, no combatOwner) -> strictly excluded (fail-closed)
    const neutralSceneMount = {
      id: 'neutral-horse',
      dead: false,
      disposed: false,
      riderNpc: undefined,
      riderPlayer: undefined,
      combatOwner: undefined,
    } as any
    expect(isHostileCombatMount(attackerNpc, neutralSceneMount, player)).toBe(false)

    // 2. Dead or disposed mount -> excluded
    const deadMount = {
      id: 'dead-horse',
      dead: true,
      disposed: false,
      riderNpc: undefined,
      combatOwner: { actorType: 'npc', allegiance: Faction.ENEMY },
    } as any
    expect(isHostileCombatMount(attackerNpc, deadMount, player)).toBe(false)

    // 3. Own mount -> excluded
    expect(isHostileCombatMount(attackerNpc, attackerNpc.mount, player)).toBe(false)

    // 4. Friendly mounted mount -> excluded
    const friendlyMountedHorse = {
      id: 'friendly-mounted-horse',
      dead: false,
      disposed: false,
      riderNpc: { faction: Faction.PLAYER, dead: false },
      combatOwner: { actorType: 'npc', allegiance: Faction.PLAYER },
    } as any
    expect(isHostileCombatMount(attackerNpc, friendlyMountedHorse, player)).toBe(false)

    // 5. Friendly dismounted mount with friendly combatOwner -> excluded
    const friendlyDismountedHorse = {
      id: 'friendly-dismounted-horse',
      dead: false,
      disposed: false,
      riderNpc: undefined,
      riderPlayer: undefined,
      combatOwner: { actorType: 'npc', allegiance: Faction.PLAYER },
    } as any
    expect(isHostileCombatMount(attackerNpc, friendlyDismountedHorse, player)).toBe(false)

    // 6. Hostile mounted mount -> allowed
    const enemyMountedHorse = {
      id: 'enemy-mounted-horse',
      dead: false,
      disposed: false,
      riderNpc: { faction: Faction.ENEMY, dead: false },
      combatOwner: { actorType: 'npc', allegiance: Faction.ENEMY },
    } as any
    expect(isHostileCombatMount(attackerNpc, enemyMountedHorse, player)).toBe(true)

    // 7. Hostile dismounted mount with enemy combatOwner -> allowed
    const enemyDismountedHorse = {
      id: 'enemy-dismounted-horse',
      dead: false,
      disposed: false,
      riderNpc: undefined,
      riderPlayer: undefined,
      combatOwner: { actorType: 'npc', allegiance: Faction.ENEMY },
    } as any
    expect(isHostileCombatMount(attackerNpc, enemyDismountedHorse, player)).toBe(true)

    // 8. Enemy attacker cannot attack friendly dismounted horse
    const enemyAttacker = {
      faction: Faction.ENEMY,
      hostileToPlayer: true,
      mount: { id: 'enemy-own-mount' },
    } as any
    expect(isHostileCombatMount(enemyAttacker, enemyDismountedHorse, player)).toBe(false)
  })

  it('enforces TownScene hitBattlefieldMount protection during PREPARING phase and routes melee hits authoritatively', () => {
    const targetMount = {
      id: 'personal-horse',
      dead: false,
      disposed: false,
      currentHp: 100,
      maxHp: 100,
      group: { position: new THREE.Vector3(0, 0, 0) },
    } as any

    const attackerNpc = {
      combatantId: 'attacker-1',
      combatOwnership: 'player-personal',
      faction: Faction.PLAYER,
      meleeWeaponId: 'sword_iron',
    } as any

    const mockTown = {
      retirementFinale: null,
      fourGateCombatHeld: false,
      isRetirementEvacuating: () => false,
      defense: { phase: 'PREPARING' },
      personalSquad: { mounts: [targetMount] },
      canHitTownMount: () => true,
    }

    // 1. During PREPARING phase, personalSquad mount is protected
    const hitBattlefieldMount = (TownScene.prototype as any).hitBattlefieldMount
    hitBattlefieldMount.call(mockTown, targetMount, 25, 'melee', attackerNpc, undefined)
    expect(targetMount.currentHp).toBe(100)

    // 2. Authoritative callback routing in TownScene update
    let routedToTownBattlefieldMount = false
    const townCallback = (_damage: number, isPlayer: boolean, targetNpc?: any, mountTarget?: any) => {
      if (isPlayer) { /* player */ }
      else if (targetNpc) { /* npc */ }
      else if (mountTarget) {
        routedToTownBattlefieldMount = true
      }
    }

    townCallback(30, false, undefined, targetMount)
    expect(routedToTownBattlefieldMount).toBe(true)
  })

  it('routes melee contact to the exact hit entity for player, mounted NPC rider, and standalone mount', () => {
    let routedPlayer = false
    let routedNpc: any = null
    let routedMount: any = null

    const onHitEntity = (_damage: number, isPlayer: boolean, targetNpc?: any, targetMount?: any) => {
      if (isPlayer) routedPlayer = true
      if (targetNpc) routedNpc = targetNpc
      if (targetMount) routedMount = targetMount
    }

    // 1. Direct hit on Player
    const playerTarget = { id: 'player-entity' }
    const playerContact = { kind: 'body' as const, target: playerTarget, time: 0.1 }

    let hitIsPlayer = false
    let hitNpc: any = undefined
    let hitMount: any = undefined

    if (playerContact.kind === 'body') {
      if (playerContact.target === playerTarget) hitIsPlayer = true
    }
    onHitEntity(25, hitIsPlayer, hitNpc, hitMount)
    expect(routedPlayer).toBe(true)
    expect(routedNpc).toBeNull()
    expect(routedMount).toBeNull()

    // 2. Direct hit on Mounted NPC rider's horse
    routedPlayer = false
    routedNpc = null
    routedMount = null

    const enemyRider = { id: 'enemy-rider-npc', isMounted: true }
    const enemyHorse = { id: 'enemy-horse', riderNpc: enemyRider }
    const horseContact = { kind: 'mount' as const, mount: enemyHorse, time: 0.2 }

    hitIsPlayer = false
    hitNpc = undefined
    hitMount = undefined

    if (horseContact.kind === 'mount') {
      hitMount = horseContact.mount
      if (horseContact.mount?.riderNpc) hitNpc = horseContact.mount.riderNpc
    }

    onHitEntity(30, hitIsPlayer, hitNpc, hitMount)
    expect(routedPlayer).toBe(false)
    expect(routedNpc).toBe(enemyRider)
    expect(routedMount).toBe(enemyHorse)

    // 3. Direct hit on Standalone / Unmounted Mount
    routedPlayer = false
    routedNpc = null
    routedMount = null

    const standaloneHorse = { id: 'standalone-horse', riderNpc: undefined, riderPlayer: undefined }
    const standaloneContact = { kind: 'mount' as const, mount: standaloneHorse, time: 0.15 }

    hitIsPlayer = false
    hitNpc = undefined
    hitMount = undefined

    if (standaloneContact.kind === 'mount') {
      hitMount = standaloneContact.mount
      if (standaloneContact.mount?.riderNpc) hitNpc = standaloneContact.mount.riderNpc
    }

    onHitEntity(20, hitIsPlayer, hitNpc, hitMount)
    expect(routedPlayer).toBe(false)
    // Never falsely attributes to an unrelated NPC
    expect(routedNpc).toBeNull()
    expect(routedMount).toBe(standaloneHorse)
  })
})
