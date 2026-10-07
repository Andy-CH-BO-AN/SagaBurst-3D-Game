import { createTacticalNpc, type TacticalNpcArgs } from '../helpers/tacticalNpc'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { AIState, Faction } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import { STAMINA_DRAIN, SPRINT_MULTIPLIER } from '../../src/movement/MovementBalance'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'

function createNpc(...args: TacticalNpcArgs) {
  return createTacticalNpc(npc => onTestFinished(() => npc.dispose()), ...args)
}

import { blockingBox } from '../helpers/formationPlacement'

describe('NPC defend, charge and formation movement', () => {
  it('follows the navigation waypoint instead of running straight through an obstacle toward a formation slot', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    onTestFinished(() => player.dispose())
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    ally.assignFormationTarget(51, new THREE.Vector3(0, 0, -10), new THREE.Vector3(0, 0, 1))
    const route = vi.spyOn(ally as any, '_resolveNavigationMoveTarget').mockImplementation(() => {
      ;(ally as any)._tmpNavigationTarget.set(5, 0, 0)
      return 'path'
    })

    ally.update(0.1, player, [ally], [], [blockingBox(-1, 1, -6, -4)] as any,
      null as any, () => {}, () => {}, false, 0, null, null, new NavigationWorld())

    expect(route).toHaveBeenCalledOnce()
    expect(ally.position.x).toBeGreaterThan(0.1)
    expect(ally.position.z).toBeCloseTo(0)
  })

  it('moves to a formation target without sprinting and clears it on overwrite', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    onTestFinished(() => player.dispose())
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    ally.assignFormationTarget(42, new THREE.Vector3(0, 0, -10), new THREE.Vector3(0, 0, 1))
    ally.update(0.1, player, [ally], [], [], null as any, () => {}, () => {})
    expect(ally.tacticalOrder).toBe('formation')
    expect(ally.isFormationTargetReached(42)).toBe(false)
    expect(ally.sprinting).toBe(false)
    expect(ally.position.z).toBeLessThan(-0.1)

    ally.setTacticalOrder('charge')
    expect(ally.formationCommandId).toBeNull()
    expect(ally.tacticalOrder).toBe('charge')
  })

  it('moves a ranged Viking Archer from ATTACK to CHASE immediately on Charge', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    onTestFinished(() => player.dispose())
    const archer = createNpc(scene, Faction.PLAYER, 'viking', 'viking_archer', {
      meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 40)
    ;(archer as any).state = AIState.ATTACK
    archer.setTacticalOrder('charge')
    expect(archer.currentState).toBe(AIState.CHASE)
    const before = archer.position.z
    archer.update(0.1, player, [archer, enemy], [], [], null as any, () => {}, () => {})
    expect(archer.position.z).toBeGreaterThan(before)
    expect(archer.sprinting).toBe(true)
  })

  it('Defend holds position outside weapon range', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    onTestFinished(() => player.dispose())
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 20)
    ally.setTacticalOrder('defend')
    const start = ally.position.clone()
    for (let i = 0; i < 20; i++) ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.position.distanceTo(start)).toBeLessThan(0.001)
    expect(ally.currentState).not.toBe(AIState.CHASE)
  })

  it('Charge sprints while stamina is available, then keeps normal chase and regenerates', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    onTestFinished(() => player.dispose())
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 40)
    ally.setTacticalOrder('charge')
    ;(ally as any).state = AIState.CHASE
    const before = ally.position.z
    ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.sprinting).toBe(true)
    expect(ally.position.z).toBeGreaterThan(before + 4.8 * SPRINT_MULTIPLIER * 0.1 * 1.2)
    expect(ally.staminaValue).toBeCloseTo(100 - STAMINA_DRAIN * 0.1, 5)

    ;(ally as any).stamina = 0
    const exhaustedBefore = ally.position.z
    ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.sprinting).toBe(false)
    expect(ally.position.z).toBeGreaterThan(exhaustedBefore)
    expect(ally.staminaValue).toBeGreaterThan(0)
  })

  it('keeps an active Charge sprint latched below threshold until stamina reaches zero', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    onTestFinished(() => player.dispose())
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 40)
    ally.setTacticalOrder('charge')
    ;(ally as any).state = AIState.CHASE
    ;(ally as any).stamina = 11
    for (let i = 0; i < 4; i++) {
      ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
      expect(ally.sprinting).toBe(true)
    }
    expect(ally.staminaValue).toBe(0)
    const beforeNormalChase = ally.position.z
    ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.sprinting).toBe(false)
    expect(ally.position.z).toBeGreaterThan(beforeNormalChase)
  })
})
