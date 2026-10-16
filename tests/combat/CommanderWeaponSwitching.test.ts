import { Box3, Vector3, type Object3D } from 'three'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { ShieldState } from '../../src/combat/ShieldBlocking'
import { describe, expect, it, vi } from 'vitest'
import { Faction } from '../../src/combat/CombatFaction'
import type { Player } from '../../src/player/Player'
import { AIState, AIType, NPC } from '../../src/world/NPC'
import type { ObstacleData } from '../../src/world/Terrain'
import { townMerchantLoadout } from '../../src/town/TownMerchantEquipment'
import type { UnitLoadout } from '../../src/battle/UnitPresetCatalog'
import { resolveT4UnitLoadout } from '../../src/battle/T4HeroCatalog'
import { townMilitaryEquipment } from '../../src/town/TownRules'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { CharacterCombatAnimator } from '../../src/world/CharacterCombatAnimator'
import type { EquipmentPoseState } from '../../src/world/CharacterEquipmentPose'

interface SelectionTarget { position: Vector3; isDead: boolean; isPlayer: boolean; npc?: NPC }

interface SelectionActor {
  faction: Faction
  specialCombatProfile?: 'maki-ranger'
  holdsRampartFirePosition: boolean
  _activeNavigationWorld?: { townNav: TownLayeredNavigation }
  combatPosition: Vector3
  rangedWeaponId: string
  meleeWeaponId: string | null
  meleeAttackRadius: number
  shieldId: string | null
  readonly hasActiveShield: boolean
  readonly hasActiveRangedWeapon: boolean
  shield: ShieldState
  shieldPivot: { visible: boolean }
  shieldCollider: { refreshVisibility(): void }
  tacticalOrder: string
  mount?: { flight: object }
  eaglePilot?: { canUseMelee: boolean }
  arrows: number
  rangedActive: boolean
  maxRangedAttackDistance: number
  bowArrowReleased: boolean
  animator: { busy: boolean; cancel(): void; setEquipment(...args: unknown[]): void; setShieldRaised(raised: boolean): void }
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
  _switchToMelee(cancelAnimation?: boolean): void
  _refreshActiveShield(): void
  _isRangedMeleeThreat(position: Vector3): boolean
  _usesReversibleRangedSwitch(): boolean
  _findRangedTrajectoryBlocker(): ObstacleData | null
  _isRampartMeleeThreat(position: Vector3): boolean
}
interface SelectionMethods extends Pick<SelectionActor, '_cancelEquipmentCombatState' | '_switchToMelee' | '_isRampartMeleeThreat' | '_isRangedMeleeThreat' | '_refreshActiveShield' | '_usesReversibleRangedSwitch' | '_restoreCombatReadyRangedVisual'> {
  _selectRangedMeleeMode(this: SelectionActor, target: SelectionTarget | null,
    player: Player, nearby: readonly NPC[], obstacles: ObstacleData[]): void
}
// The existing decision entry needs state and narrow animation/visibility boundaries only.
// Its production cancellation and mode-switch methods run without constructing an actor.
const methods = NPC.prototype as unknown as SelectionMethods
function selection(overrides: Partial<SelectionActor> = {}) {
  const actor = {
    faction: Faction.ENEMY, holdsRampartFirePosition: false, combatPosition: new Vector3(), rangedWeaponId: 'recurve_longbow',
    meleeWeaponId: 'steel_sword', meleeAttackRadius: 1.8, shieldId: null, shieldPivot: { visible: false }, tacticalOrder: 'attack',
    shieldCollider: { refreshVisibility() { actor.shieldPivot.visible = actor.hasActiveShield && !actor.shield.shieldBroken } },
    arrows: 12, rangedActive: true, maxRangedAttackDistance: 30,
    bowArrowReleased: false, animator: { busy: false, cancel: vi.fn(), setEquipment: vi.fn(), setShieldRaised: vi.fn() }, bowVisual: { hideArrow: vi.fn() },
    swordPivot: { visible: false }, bowPivot: { visible: true }, attackTimer: 2,
    attackHitProcessed: true, meleeApproachLimit: 3, meleeApproachTarget: {}, pendingLanceChargeSpeed: 15,
    state: AIState.ATTACK, _cancelEquipmentCombatState: methods._cancelEquipmentCombatState,
    _switchToMelee: methods._switchToMelee, _restoreCombatReadyRangedVisual: methods._restoreCombatReadyRangedVisual,
    _refreshActiveShield: methods._refreshActiveShield, _isRangedMeleeThreat: methods._isRangedMeleeThreat,
    _usesReversibleRangedSwitch: methods._usesReversibleRangedSwitch,
    _isRampartMeleeThreat: methods._isRampartMeleeThreat,
    _findRangedTrajectoryBlocker: vi.fn(() => null), ...overrides,
  } as SelectionActor
  Object.defineProperties(actor, {
    hasActiveShield: Object.getOwnPropertyDescriptor(NPC.prototype, 'hasActiveShield')!,
    hasActiveRangedWeapon: Object.getOwnPropertyDescriptor(NPC.prototype, 'hasActiveRangedWeapon')!,
  })
  actor.shield = new ShieldState(() => actor.hasActiveShield)
  actor.shield.equip(actor.shieldId)
  const targetPosition = new Vector3(0, 0, 20)
  const target: SelectionTarget = { position: targetPosition, isDead: false, isPlayer: false,
    npc: { faction: Faction.PLAYER, dead: false, combatPosition: targetPosition } as NPC }
  const player = { faction: Faction.PLAYER, dead: true, combatPosition: new Vector3(0, 0, 100) }
  const select = (nearby: readonly NPC[] = [], selected: SelectionTarget | null = target, obstacles: ObstacleData[] = []) =>
    methods._selectRangedMeleeMode.call(actor, selected, player as Player, nearby, obstacles)
  return { actor, target, player, select }
}


interface TemporaryLoadoutActor {
  arrows: number
  rangedActive: boolean
  meleeWeaponId: string | null
  rangedWeaponId?: string
  loadout: UnitLoadout
  townCategory?: 'civilian'
  townArmed: boolean
  swordPivot: { visible: boolean }
  bowPivot: { visible: boolean }
  shieldPivot: { visible: boolean }
  _usesReversibleRangedSwitch(): boolean
  _switchToMelee(): void
  applyTemporaryCombatLoadout(loadout: UnitLoadout): void
  restoreCombatLoadout(): void
}
/** Actual temporary-loadout transaction; only mesh rebuilding is an external boundary. */
function temporaryLoadoutActor(): TemporaryLoadoutActor {
  return Object.assign(Object.create(NPC.prototype) as TemporaryLoadoutActor, {
    _tier: 4, _faction: Faction.ENEMY, _aiType: AIType.RANGED, state: AIState.IDLE,
    arrows: 7, rangedActive: true, _rangedDamage: 20, meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow',
    shieldId: null, originalCombatEquipment: null, townArmed: false,
    loadout: { meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', reversibleRangedSwitch: true },
    animator: { cancel: vi.fn(), setEquipment: vi.fn() }, bowVisual: { hideArrow: vi.fn() }, rig: {},
    swordPivot: { visible: false }, bowPivot: { visible: true }, shieldPivot: { visible: false },
    _setActiveMeleeWeapon(this: TemporaryLoadoutActor, id: string | null) { this.meleeWeaponId = id },
    _rebuildActiveRangedVisual: vi.fn(), rebuildShield: vi.fn(), _refreshActiveShield: vi.fn(),
  })
}

describe('Reversible NPC weapon choice', () => {
  it('refreshes sword pose ownership before same-frame equipment pose evaluation', () => {
    const state: Partial<EquipmentPoseState> = {}
    interface EquipmentAnimatorFixture {
      rig: { animation: { setEquipmentState(update: Partial<EquipmentPoseState>): void } }
      meleePivot: { visible: boolean; userData: { swordAttachmentOwned: boolean; meleeAnimationKind: string; weaponGripSections: { foot: { palmRadius: number; fingerRadius: number; palmOffset: number; fingerOffset: number }; mounted: { palmRadius: number; fingerRadius: number; palmOffset: number; fingerOffset: number } } } }
      setEquipment: CharacterCombatAnimator['setEquipment']
    }
    // Exercise the real state owner without constructing a rig, model or mixer.
    const animator = Object.assign(Object.create(CharacterCombatAnimator.prototype) as EquipmentAnimatorFixture, {
      rig: { animation: { setEquipmentState: (update: Partial<EquipmentPoseState>) => Object.assign(state, update) } },
      meleePivot: { visible: true, userData: { swordAttachmentOwned: true, meleeAnimationKind: 'sword', weaponGripSections: { foot: { palmRadius: .04, fingerRadius: .03, palmOffset: 0, fingerOffset: 0 }, mounted: { palmRadius: .03, fingerRadius: .04, palmOffset: 0, fingerOffset: 0 } } } },
    })
    animator.setEquipment(false, false, 'HORSE')
    expect(state.actualSword).toBe(true)
    expect(state.swordGripSections?.foot.palmRadius).toBe(.04)
    animator.meleePivot.userData.meleeAnimationKind = 'axe'
    animator.setEquipment(false, false, 'HORSE')
    expect(state.actualSword).toBe(false)
    expect(state.swordGripSections).toBeUndefined()
    animator.meleePivot.userData.meleeAnimationKind = 'sword'
    animator.meleePivot.userData.weaponGripSections = { foot: { palmRadius: .02, fingerRadius: .01, palmOffset: 0, fingerOffset: 0 }, mounted: { palmRadius: .01, fingerRadius: .02, palmOffset: 0, fingerOffset: 0 } }
    animator.setEquipment(false, false, 'HORSE')
    expect(state.actualSword).toBe(true)
    expect(state.swordGripSections?.mounted.palmRadius).toBe(.01)
  })

  it('wires authored Commander and Ranger loadouts to their normal melee and reversible bows', () => {
    expect(townMilitaryEquipment('roman', 'commander').loadout).toMatchObject({
      meleeWeaponId: 'sword_t5', rangedWeaponId: 'bow_t5', reversibleRangedSwitch: true,
    })
    expect(townMilitaryEquipment('viking', 'commander').loadout).toMatchObject({
      meleeWeaponId: 'axe_t5', rangedWeaponId: 'bow_t5', reversibleRangedSwitch: true,
    })
    expect(resolveT4UnitLoadout('viking_archer')).toMatchObject({
      meleeWeaponId: 'viking_axe_t3', rangedWeaponId: 'maki-ranger-bow-ranged', reversibleRangedSwitch: true,
    })
    expect(resolveT4UnitLoadout('roman_archer')).toMatchObject({
      meleeWeaponId: 'centurion_blade', rangedWeaponId: 'maki-ranger-bow-ranged', reversibleRangedSwitch: true,
    })
  })
  it('repeats ordinary shielded hybrid switching with hysteresis and preserves ammo and damaged shield', () => {
    const h = selection({ shieldId: 'round_shield_t3', tacticalOrder: 'defend' })
    expect(h.actor._usesReversibleRangedSwitch()).toBe(true)
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
    expect(h.actor.shield.active).toBe(false)
    expect(h.actor.shield.absorb(20, 2)).toEqual({ damage: 20, blockedImpact: 0 })
    const hostile = { faction: Faction.PLAYER, dead: false, combatPosition: new Vector3(0, 0, 6) } as NPC
    h.select([hostile])
    expect(h.actor.rangedActive).toBe(false)
    expect(h.actor.shieldPivot.visible).toBe(true)
    expect(h.actor.shield.shieldRaised).toBe(true)
    const initial = h.actor.shield.shieldImpactRemaining
    expect(h.actor.shield.absorb(20, 2).blockedImpact).toBe(2)
    hostile.combatPosition.z = 8.99
    h.select([hostile])
    expect(h.actor.rangedActive).toBe(false)
    hostile.combatPosition.z = 9
    h.select([hostile])
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
    expect([h.actor.swordPivot.visible, h.actor.bowPivot.visible, h.actor.shieldPivot.visible]).toEqual([false, true, false])
    expect(h.actor.shield.shieldRaised).toBe(false)
    hostile.combatPosition.z = 7
    h.select([hostile])
    expect(h.actor.rangedActive).toBe(true)
    hostile.combatPosition.z = 4
    h.select([hostile])
    expect(h.actor.shield.active).toBe(true)
    expect(h.actor.shield.shieldImpactRemaining).toBe(initial - 2)
    expect(h.actor.arrows).toBe(12)
    expect(h.actor.shieldId).toBe('round_shield_t3')
    h.actor.arrows = 0
    hostile.combatPosition.z = 12
    h.select([hostile])
    expect(h.actor.rangedActive).toBe(false)
  })

  it('leaves a melee-only shield bearer in its original combat mode', () => {
    const h = selection({ rangedWeaponId: '', rangedActive: false, arrows: 0, shieldId: 'scutum_t2',
      swordPivot: { visible: true }, bowPivot: { visible: false } })
    h.select()
    expect(h.actor._usesReversibleRangedSwitch()).toBe(false)
    expect(h.actor.hasActiveRangedWeapon).toBe(false)
    expect(h.actor.shield.active).toBe(true)
    expect(h.actor.swordPivot.visible).toBe(true)
    expect(h.actor.animator.cancel).not.toHaveBeenCalled()
  })

  it('leaves a ranged-only loadout without a fabricated melee weapon', () => {
    const h = selection({ meleeWeaponId: null })
    h.target.position.z = 3
    h.select()
    h.actor._switchToMelee()
    expect(h.actor._usesReversibleRangedSwitch()).toBe(false)
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
    expect(h.actor.meleeWeaponId).toBeNull()
    expect(h.actor.swordPivot.visible).toBe(false)
    expect(h.actor.arrows).toBe(12)
  })

  it('keeps the eagle bow for vertically separated ground threats until physical melee contact is possible', () => {
    const h = selection({ mount: { flight: {} }, eaglePilot: { canUseMelee: false }, combatPosition: new Vector3(0, 5, 0) })
    h.target.position.set(0, 0, 2)
    h.select()
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
    h.actor.eaglePilot!.canUseMelee = true
    h.select()
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
    h.target.position.y = 5
    h.select()
    expect(h.actor.rangedActive).toBe(false)
    h.target.position.z = 12
    h.select()
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
  })

  it('switches a Ranger to real melee for a nearby hostile without spending ammunition', () => {
    const h = selection({ specialCombatProfile: 'maki-ranger', rangedWeaponId: 'maki-ranger-bow-ranged', meleeWeaponId: 'viking_axe_t3' })
    const hostile = { faction: Faction.PLAYER, dead: false, combatPosition: new Vector3(0, 0, 5) } as NPC
    h.select([hostile])
    expect(h.actor.rangedActive).toBe(false)
    expect(h.actor.arrows).toBe(12)
    expect(h.actor.swordPivot.visible).toBe(true)
    expect(h.actor.bowPivot.visible).toBe(false)
    expect(h.actor.animator.cancel).toHaveBeenCalled()
    expect(h.actor.bowVisual.hideArrow).toHaveBeenCalledOnce()
    expect(h.actor).toMatchObject({ state: AIState.CHASE, attackTimer: 0, attackHitProcessed: false,
      bowArrowReleased: false, pendingLanceChargeSpeed: 0, meleeApproachLimit: Infinity, meleeApproachTarget: null })
  })

  it('automatically switches temporary hybrid loadouts and restores original equipment and ammunition', () => {
    const actor = temporaryLoadoutActor(), original = { ...actor.loadout }
    actor.townCategory = 'civilian'
    actor.applyTemporaryCombatLoadout({ meleeWeaponId: 'heavy_lance', rangedWeaponId: 'recurve_longbow' })
    expect([actor.swordPivot.visible, actor.bowPivot.visible, actor.shieldPivot.visible]).toEqual([false, false, false])
    actor._switchToMelee()
    expect(actor.arrows).toBe(30)
    actor.applyTemporaryCombatLoadout(resolveT4UnitLoadout('roman_archer'))
    expect(actor.bowPivot.visible).toBe(false)
    actor._switchToMelee()
    expect(actor.arrows).toBe(30)
    expect(actor.rangedActive).toBe(false)
    expect(actor.swordPivot.visible).toBe(false)
    expect(actor._usesReversibleRangedSwitch()).toBe(true)
    actor.restoreCombatLoadout()
    expect(actor).toMatchObject({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', arrows: 7, rangedActive: true })
    expect(actor.loadout).toEqual(original)
    expect([actor.swordPivot.visible, actor.bowPivot.visible, actor.shieldPivot.visible]).toEqual([false, false, false])
    expect(actor._usesReversibleRangedSwitch()).toBe(true)
  })

  it('ignores peaceful, dead and below-rampart threats until a live hostile reaches the deck', () => {
    const townNav = new TownLayeredNavigation({
      decks: [{ id: 'test-deck', gateId: 'north', box: new Box3(),
        surface: { startX: 0, startZ: 0, startY: 6, topY: 6, dirX: 0, dirZ: 1, length: 30, landing: 0, halfWidth: 2, mounted: true } }],
      ramps: [], corners: [], lengths: [], perimeter: 0, wallSpans: [],
    })
    const h = selection({ specialCombatProfile: 'maki-ranger', holdsRampartFirePosition: true,
      combatPosition: new Vector3(0, 6, 0), _activeNavigationWorld: { townNav } })
    h.target.position.set(0, 0, 5)
    h.player.dead = false
    h.player.combatPosition.set(0, 0, 2)
    h.select([
      { faction: Faction.ENEMY, dead: false, combatPosition: new Vector3(0, 6, 1) },
      { faction: Faction.PLAYER, dead: true, combatPosition: new Vector3(0, 6, 1) },
      { faction: Faction.PLAYER, dead: false, combatPosition: new Vector3(0, 0, 1) },
    ] as NPC[])
    expect(h.actor.rangedActive).toBe(true)
    expect(h.actor.animator.cancel).not.toHaveBeenCalled()
    h.target.position.y = 6
    h.select()
    expect(h.actor.rangedActive).toBe(false)
    expect(h.actor.arrows).toBe(12)
  })

  it('keeps nearby siege targeting separate from hostile actor proximity switches', () => {
    const h = selection({ shieldId: 'scutum_t2' })
    // Plain lifecycle boundary only: no scene, render objects or obstacle builder.
    const root: Pick<Object3D, 'parent'> = { parent: null }
    const gate: ObstacleData = { box: new Box3(new Vector3(-1, -1, 3), new Vector3(1, 1, 5)), isBarricade: true,
      damageable: new DamageableObstacle({ kind: 'gate', maxHp: 100, root: root as Object3D }) }
    const target = { position: gate.box.getCenter(new Vector3()), isDead: gate.damageable!.destroyed, isPlayer: false }
    h.select([], target, [gate])
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
    expect(h.actor.shield.active).toBe(false)
    expect([h.actor.swordPivot.visible, h.actor.bowPivot.visible]).toEqual([false, true])
    expect(h.actor.arrows).toBe(12)
    expect(h.actor.animator.cancel).not.toHaveBeenCalled()
    // A real close enemy must still interrupt that same obstacle target.
    const hostile = { faction: Faction.PLAYER, dead: false, combatPosition: new Vector3(0, 0, 3) } as NPC
    h.select([hostile], target, [gate])
    expect(h.actor.hasActiveRangedWeapon).toBe(false)
    expect(h.actor.shield.active).toBe(true)
    h.select([], target, [gate])
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
    expect(h.actor.arrows).toBe(12)
  })

  it('requires the re-equip distance before returning from melee to bow', () => {
    const h = selection({ rangedActive: false })
    h.target.position.z = 8.99
    h.select()
    expect(h.actor.rangedActive).toBe(false)
    h.target.position.z = 9
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
    const nearby: NPC[] = []
    const scan = vi.spyOn(h.actor, '_isRangedMeleeThreat')
    const iterate = vi.spyOn(nearby, Symbol.iterator)
    h.select(nearby)
    expect(h.actor.rangedActive).toBe(false)
    expect(h.actor.arrows).toBe(0)
    scan.mockClear(); iterate.mockClear()
    h.select(nearby)
    expect(h.actor.rangedActive).toBe(false)
    expect(scan).not.toHaveBeenCalled()
    expect(iterate).not.toHaveBeenCalled()
  })

  it('preserves a released arrow recovery until the animation finishes', () => {
    const h = selection({ bowArrowReleased: false, animator: { busy: true, cancel: vi.fn(), setEquipment: vi.fn(), setShieldRaised: vi.fn() } })
    h.target.position.z = 2
    h.select()
    expect(h.actor.rangedActive).toBe(true)
    expect(h.actor.bowArrowReleased).toBe(false)
    h.actor.bowArrowReleased = true
    h.select()
    expect(h.actor.rangedActive).toBe(true)
    expect(h.actor.animator.cancel).not.toHaveBeenCalled()
  })

  it('finishes an active melee swing before re-equipping a bow', () => {
    const h = selection({ rangedActive: false, animator: { busy: true, cancel: vi.fn(), setEquipment: vi.fn(), setShieldRaised: vi.fn() } })
    h.select()
    expect(h.actor.rangedActive).toBe(false)
    expect(h.actor.animator.cancel).not.toHaveBeenCalled()
  })
})


it('preserves merchant fixed gear with a purchased horse and switches only its existing melee weapon between attacks', () => {
  const actor = { townCombatRole: 'merchant', originalCombatEquipment: null,
    animator: { busy: false }, loadout: townMerchantLoadout('horse'), meleeWeaponId: 'sword_t5',
    dead: false, isFalling: false,
    _setActiveMeleeWeapon(id: string) { this.meleeWeaponId = id },
  }
  interface MerchantSelection {
    _selectMerchantMeleeWeapon(this: typeof actor, target: { shield: { active: boolean } } | null): void
  }
  const choose = (NPC.prototype as unknown as MerchantSelection)._selectMerchantMeleeWeapon
  expect(NPC.prototype.canApplyCareerEquipment.call(actor as unknown as NPC, townMerchantLoadout('horse'))).toBe(true)
  expect(NPC.prototype.canApplyCareerEquipment.call(actor as unknown as NPC, { ...actor.loadout, secondaryMeleeWeaponId: 'paladin_mace_t4' })).toBe(false)
  expect(NPC.prototype.canApplyCareerEquipment.call(actor as unknown as NPC, { ...actor.loadout, mountId: 'black-cat' })).toBe(false)
  const target = { shield: { active: true } }
  choose.call(actor, target)
  expect(actor.meleeWeaponId).toBe('axe_t5')
  actor.animator.busy = true; target.shield.active = false
  choose.call(actor, target)
  expect(actor.meleeWeaponId).toBe('axe_t5')
  actor.animator.busy = false
  choose.call(actor, target)
  expect(actor.meleeWeaponId).toBe('sword_t5')
  expect(actor.loadout).toEqual({ meleeWeaponId: 'sword_t5', secondaryMeleeWeaponId: 'axe_t5',
    shieldId: 'paladin_shield_t4', rangedWeaponId: null, mountId: 'horse' })
})
