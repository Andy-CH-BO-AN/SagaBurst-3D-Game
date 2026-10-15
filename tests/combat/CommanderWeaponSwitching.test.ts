import { Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { Faction } from '../../src/combat/CombatFaction'
import type { Player } from '../../src/player/Player'
import { AIState, NPC } from '../../src/world/NPC'
import type { ObstacleData } from '../../src/world/Terrain'

interface SelectionActor {
  faction: Faction
  combatPosition: Vector3
  rangedWeaponId: string
  meleeWeaponId: string
  arrows: number
  rangedActive: boolean
  maxRangedAttackDistance: number
  bowArrowReleased: boolean
  animator: { busy: boolean; cancel(): void }
  bowVisual: { hideArrow(): void }
  swordPivot: { visible: boolean }
  bowPivot: { visible: boolean }
  attackTimer: number
  attackHitProcessed: boolean
  meleeApproachLimit: number
  meleeApproachTarget: object | null
  pendingLanceChargeSpeed: number
  state: AIState
  _cancelEquipmentCombatState(): void
  _restoreCombatReadyRangedVisual(): void
  _switchToMelee(consumeRemainingAmmo?: boolean, cancelAnimation?: boolean): void
  _findRangedTrajectoryBlocker(): ObstacleData | null
}
interface SelectionMethods extends Pick<SelectionActor, '_cancelEquipmentCombatState' | '_switchToMelee'> {
  _selectRangedMeleeMode(this: SelectionActor, target: { position: Vector3; isDead: boolean } | null,
    player: Player, nearby: readonly NPC[], obstacles: ObstacleData[]): void
}
// The existing decision entry needs state and narrow animation/visibility boundaries only.
// Its production cancellation and mode-switch methods run without constructing an actor.
const methods = NPC.prototype as unknown as SelectionMethods
function selection(overrides: Partial<SelectionActor> = {}) {
  const actor: SelectionActor = {
    faction: Faction.ENEMY, combatPosition: new Vector3(), rangedWeaponId: 'recurve_longbow',
    meleeWeaponId: 'steel_sword', arrows: 12, rangedActive: true, maxRangedAttackDistance: 30,
    bowArrowReleased: false, animator: { busy: false, cancel: vi.fn() }, bowVisual: { hideArrow: vi.fn() },
    swordPivot: { visible: false }, bowPivot: { visible: true }, attackTimer: 2,
    attackHitProcessed: true, meleeApproachLimit: 3, meleeApproachTarget: {}, pendingLanceChargeSpeed: 15,
    state: AIState.ATTACK, _cancelEquipmentCombatState: methods._cancelEquipmentCombatState,
    _switchToMelee: methods._switchToMelee, _restoreCombatReadyRangedVisual: vi.fn(),
    _findRangedTrajectoryBlocker: vi.fn(() => null), ...overrides,
  }
  const target = { position: new Vector3(0, 0, 20), isDead: false }
  const player = { faction: Faction.PLAYER, dead: true, combatPosition: new Vector3(0, 0, 100) } as Player
  const select = (nearby: readonly NPC[] = []) => methods._selectRangedMeleeMode.call(actor, target, player, nearby, [])
  return { actor, target, player, select }
}

describe('Commander weapon choice', () => {
  it('cancels an unreleased attack for a nearby hostile without spending ammunition', () => {
    const h = selection()
    const hostile = { faction: Faction.PLAYER, dead: false, combatPosition: new Vector3(0, 0, 5) } as NPC
    h.select([hostile])
    expect(h.actor.rangedActive).toBe(false)
    expect(h.actor.arrows).toBe(12)
    expect(h.actor.animator.cancel).toHaveBeenCalled()
    expect(h.actor.bowVisual.hideArrow).toHaveBeenCalledOnce()
    expect(h.actor).toMatchObject({ state: AIState.CHASE, attackTimer: 0, attackHitProcessed: false,
      bowArrowReleased: false, pendingLanceChargeSpeed: 0, meleeApproachLimit: Infinity, meleeApproachTarget: null })
  })

  it('ignores peaceful and dead neighbors when the selected hostile is in bow range', () => {
    const h = selection()
    h.select([
      { faction: Faction.ENEMY, dead: false, combatPosition: new Vector3(0, 0, 1) },
      { faction: Faction.PLAYER, dead: true, combatPosition: new Vector3(0, 0, 1) },
    ] as NPC[])
    expect(h.actor.rangedActive).toBe(true)
    expect(h.actor.animator.cancel).not.toHaveBeenCalled()
  })

  it('requires the re-equip distance before returning from melee to bow', () => {
    const h = selection({ rangedActive: false })
    h.target.position.z = 9
    h.select()
    expect(h.actor.rangedActive).toBe(false)
    h.target.position.z = 9.01
    h.select()
    expect(h.actor.rangedActive).toBe(true)
    expect(h.actor.arrows).toBe(12)
    expect(h.actor.state).toBe(AIState.CHASE)
  })

  it('keeps melee when the target trajectory is blocked', () => {
    const h = selection({ rangedActive: false, _findRangedTrajectoryBlocker: () => ({}) as ObstacleData })
    h.select()
    expect(h.actor.rangedActive).toBe(false)
    expect(h.actor.animator.cancel).not.toHaveBeenCalled()
  })

  it('falls back to melee when ammunition is exhausted', () => {
    const h = selection({ arrows: 0 })
    h.select()
    expect(h.actor.rangedActive).toBe(false)
    expect(h.actor.arrows).toBe(0)
  })

  it('preserves a released arrow recovery until the animation finishes', () => {
    const h = selection({ bowArrowReleased: true, animator: { busy: true, cancel: vi.fn() } })
    h.target.position.z = 2
    h.select()
    expect(h.actor.rangedActive).toBe(true)
    expect(h.actor.bowArrowReleased).toBe(true)
    expect(h.actor.animator.cancel).not.toHaveBeenCalled()
  })

  it('finishes an active melee swing before re-equipping a bow', () => {
    const h = selection({ rangedActive: false, animator: { busy: true, cancel: vi.fn() } })
    h.select()
    expect(h.actor.rangedActive).toBe(false)
    expect(h.actor.animator.cancel).not.toHaveBeenCalled()
  })
})
