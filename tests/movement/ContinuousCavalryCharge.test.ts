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

  it('distinguishes targets in front vs behind the charging cavalry', () => {
    const cavalryPos = new THREE.Vector3(0, 0, 0)
    const yaw = 0 // Local +Z is forward: (0, 0, 1)

    const forwardTarget = new THREE.Vector3(0, 0, 10)
    const rearTarget = new THREE.Vector3(0, 0, -10)
    const sideTarget = new THREE.Vector3(10, 0, 0)

    expect(isTargetInForwardCone(cavalryPos, yaw, forwardTarget)).toBe(true)
    expect(isTargetInForwardCone(cavalryPos, yaw, rearTarget)).toBe(false)
    expect(isTargetInForwardCone(cavalryPos, yaw, sideTarget)).toBe(false)
  })

  it('strictly filters out rearward targets during pass-through phase', () => {
    const cx = 0, cz = 10
    const yaw = 0 // Facing +Z
    const rearX = 0, rearZ = 8 // Behind at 2m
    const aheadX = 0, aheadZ = 18 // Ahead at 8m

    // In passthrough: rear target must return Infinity (disqualified)
    expect(scoreCavalryTarget(cx, cz, yaw, rearX, rearZ, true)).toBe(Infinity)

    // Ahead target has a finite, valid score
    const aheadScore = scoreCavalryTarget(cx, cz, yaw, aheadX, aheadZ, true)
    expect(Number.isFinite(aheadScore)).toBe(true)
    expect(aheadScore).toBeLessThan(50)
  })

  it('prefers distant forward targets over closer rearward targets during normal charge', () => {
    const cx = 0, cz = 0
    const yaw = 0 // Facing +Z
    const aheadX = 0, aheadZ = 12 // 12m in front
    const rearX = 0, rearZ = -4 // 4m behind

    const forwardScore = scoreCavalryTarget(cx, cz, yaw, aheadX, aheadZ, false)
    const rearScore = scoreCavalryTarget(cx, cz, yaw, rearX, rearZ, false)

    // Forward target at 12m has a better (lower) score than rear target at 4m
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
})
