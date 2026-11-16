import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Faction } from '../../src/combat/CombatFaction'
import { WeaponSweep } from '../../src/combat/ShieldBlocking'
import {
  CAVALRY_FORWARD_CONE_COS,
  CAVALRY_MAX_TURN_RATE,
  CAVALRY_PASSTHROUGH_DURATION,
  cavalryTurnRate,
  findCavalryChargeTarget,
  isEligibleMeleeCavalry,
  isTargetInForwardCone,
  scoreCavalryTarget,
  steerCavalryHeading,
} from '../../src/movement/ContinuousCavalryCharge'
import { angleDifference } from '../../src/movement/MountedArcherOrbit'
import { isHostileCombatMount } from '../../src/world/NPC'
import { SpatialGrid } from '../../src/world/SpatialGrid'

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

    const grid = new SpatialGrid<typeof rearEnemy>(20)
    grid.insert(rearEnemy)

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
    expect(findCavalryChargeTarget(cavalry, player, grid, null, candidateBuffer, false, isHostile,
      undefined, candidate => candidate !== rearEnemy)).toBeNull()
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

})
