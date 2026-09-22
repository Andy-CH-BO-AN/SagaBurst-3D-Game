import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  applyCampaignBreachOrders,
  CampaignBreachController,
  CampaignGateController,
  isCampaignGateOccupied,
} from './CampaignGate'
import { DamageableObstacle } from '../world/DamageableObstacle'
import { AIType, type NPC } from '../world/NPC'
import type { ObstacleData } from '../world/Terrain'

function createGateController() {
  const root = new THREE.Group()
  const damageable = new DamageableObstacle({
    kind: 'gate',
    maxHp: 100,
    root,
    ownerFaction: 'roman',
  })
  const obstacle: ObstacleData = {
    box: new THREE.Box3(
      new THREE.Vector3(-4, 0, -0.5),
      new THREE.Vector3(4, 1.38, 0.5),
    ),
    isBarricade: true,
    damageable,
  }
  const obstacles = [obstacle]
  const leftHinge = new THREE.Group()
  const rightHinge = new THREE.Group()
  const breachController = new CampaignBreachController()
  const controller = new CampaignGateController({
    defenderFaction: 'roman',
    damageable,
    obstacle,
    obstacles,
    leftHinge,
    rightHinge,
    openRotationY: Math.PI / 2,
    breachController,
  })

  return {
    controller,
    damageable,
    obstacle,
    obstacles,
    leftHinge,
    rightHinge,
    breachController,
  }
}

describe('CampaignGateController', () => {
  it('opens by removing collision, rotating leaves, and emitting breach once', () => {
    const {
      controller,
      obstacle,
      obstacles,
      leftHinge,
      rightHinge,
      breachController,
    } = createGateController()
    const onBreach = vi.fn()
    breachController.onBreach(onBreach)

    expect(controller.state).toBe('closed')
    expect(controller.breached).toBe(false)
    expect(controller.open()).toBe(true)

    expect(controller.state).toBe('open')
    expect(controller.breached).toBe(true)
    expect(obstacles).not.toContain(obstacle)
    expect(leftHinge.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(rightHinge.rotation.y).toBeCloseTo(-Math.PI / 2)
    expect(onBreach).toHaveBeenCalledTimes(1)

    controller.open()
    expect(onBreach).toHaveBeenCalledTimes(1)
  })

  it('closes only when the doorway is clear and does not reset breach state', () => {
    const { controller, obstacle, obstacles } = createGateController()

    controller.open()

    expect(controller.close(true)).toBe(false)
    expect(controller.state).toBe('open')
    expect(obstacles).not.toContain(obstacle)

    expect(controller.close(false)).toBe(true)
    expect(controller.state).toBe('closed')
    expect(controller.breached).toBe(true)
    expect(obstacles.filter(candidate => candidate === obstacle)).toHaveLength(1)
  })

  it('destroying a closed gate removes the route blocker and emits breach once', () => {
    const {
      controller,
      damageable,
      obstacle,
      obstacles,
      breachController,
    } = createGateController()
    const onBreach = vi.fn()
    breachController.onBreach(onBreach)

    damageable.destroy()

    expect(controller.state).toBe('destroyed')
    expect(controller.breached).toBe(true)
    expect(obstacles).not.toContain(obstacle)
    expect(onBreach).toHaveBeenCalledTimes(1)

    damageable.destroy()
    expect(onBreach).toHaveBeenCalledTimes(1)
  })

  it('does not emit a second breach when an open gate is later destroyed', () => {
    const { controller, damageable, breachController } = createGateController()
    const onBreach = vi.fn()
    breachController.onBreach(onBreach)

    controller.open()
    damageable.destroy()

    expect(controller.state).toBe('destroyed')
    expect(onBreach).toHaveBeenCalledTimes(1)
  })
})

describe('Campaign gate occupancy', () => {
  it('uses X/Z clearance even when actors are on different terrain heights', () => {
    const box = new THREE.Box3(
      new THREE.Vector3(-4, 0, -0.5),
      new THREE.Vector3(4, 1.38, 0.5),
    )

    expect(
      isCampaignGateOccupied(box, [new THREE.Vector3(0, 20, 0)]),
    ).toBe(true)
    expect(
      isCampaignGateOccupied(box, [new THREE.Vector3(8, 0, 0)]),
    ).toBe(false)
  })
})

describe('Campaign breach orders', () => {
  it('charges melee attackers, keeps ranged attackers on attack, and activates defenders', () => {
    const meleeSetOrder = vi.fn()
    const rangedSetOrder = vi.fn()
    const defenderSetOrder = vi.fn()

    const npcs = [
      {
        dead: false,
        characterFaction: 'viking',
        aiType: AIType.MELEE,
        setTacticalOrder: meleeSetOrder,
      },
      {
        dead: false,
        characterFaction: 'viking',
        aiType: AIType.RANGED,
        setTacticalOrder: rangedSetOrder,
      },
      {
        dead: false,
        characterFaction: 'roman',
        aiType: AIType.MELEE,
        setTacticalOrder: defenderSetOrder,
      },
    ] as unknown as NPC[]

    expect(applyCampaignBreachOrders(npcs, 'viking')).toEqual({
      attackerChargeCount: 1,
      attackerAttackCount: 1,
      defenderAttackCount: 1,
    })
    expect(meleeSetOrder).toHaveBeenCalledWith('charge')
    expect(rangedSetOrder).toHaveBeenCalledWith('attack')
    expect(defenderSetOrder).toHaveBeenCalledWith('attack')
  })
})
