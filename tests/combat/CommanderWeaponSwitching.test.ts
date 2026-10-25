import { minimumReachableShoulderSwing } from '../../src/world/AuthoredCarryGrip'
import { Box3, Quaternion, Vector3, type Object3D } from 'three'
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
import { careerCommanderLoadout } from '../../src/career/CareerCommanderEquipment'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { CharacterCombatAnimator, COMBAT_ANIMATION_PROFILES, meleeActionTimeScale } from '../../src/world/CharacterCombatAnimator'
import { MixerController } from '../../src/world/HumanoidAssetRegistry'
import { InertialPoseTransition } from '../../src/world/InertialPoseTransition'
import { axeRecoveryWeight } from '../../src/world/SwordAttachmentContract'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { blendContinuousLocalQuaternion, type EquipmentPoseState } from '../../src/world/CharacterEquipmentPose'
import type { HumanoidAnimationController } from '../../src/world/CharacterVisuals'

/** Real animation state owner; only the external clip/pose boundary is doubled. */
function combatAnimator(getMeleeTiming?: HumanoidAnimationController['getMeleeTiming'], weapon: 'lance' | 'axe' = 'lance') {
  const state: Partial<EquipmentPoseState> = {}
  const attachment: Record<string, unknown> = weapon === 'lance'
    ? { equipmentAttachmentOwned: 'lance' }
    : { swordAttachmentOwned: true, meleeAnimationKind: 'axe' }
  const meleePivot = { visible: true, userData: attachment }
  const animation = {
    setEquipmentState: (update: Partial<EquipmentPoseState>) => Object.assign(state, update),
    play: vi.fn(() => true), seek: vi.fn(() => true), has: () => true,
    setBowLocomotion: vi.fn(), update: vi.fn(), getDuration: () => undefined, stop: vi.fn(),
    getMeleeTiming,
  } satisfies HumanoidAnimationController
  // No constructor, rig, bones or mixer: the production methods need only this
  // equipment ownership marker and scalar action/locomotion state.
  const animator = Object.assign(Object.create(CharacterCombatAnimator.prototype), {
    rig: { animation, equipmentGripFrames: {} },
    meleePivot,
    bowPivot: { visible: false, userData: {} },
    action: 'idle', ownership: 'procedural', elapsed: 0, actionTimeScale: 1,
    shieldGuardEnabled: false, shieldRaised: false, lanceEquipped: false,
    locomotion: 'idle', mountKind: 'HORSE', locomotionTimeScale: 1,
    events: { hitActiveStarted: false, projectileRelease: false, actionCompleted: false },
  }) as CharacterCombatAnimator
  return { animator, animation, state, attachment, meleePivot }
}

function lanceAnimator() {
  const fixture = combatAnimator()
  const { animator } = fixture
  animator.setEquipment(true, false, 'HORSE')
  animator.setLocomotion(0, true)
  return fixture
}

function trimmedAxeAnimator(attackFadeInSeconds?: number) {
  // Exercise the real registry conversion with data only: no clips or mixers.
  const controller = new MixerController([], [], [], [{
    clip: 'axeAttack2H', source: 'Meshy', sourceClip: 'axeAttack2H', loop: false,
    duration: .48, meleeCycleSeconds: .48, attackFadeInSeconds,
    events: { activeStart: .12, hit: .18, activeEnd: .24, actionComplete: .48 },
  }])
  return { controller, ...combatAnimator(state => controller.getMeleeTiming(state), 'axe') }
}

describe('Combat animator imported melee clock', () => {
  it('decays one fixed rotation offset continuously across a target hemisphere change without accumulating on repeated samples', () => {
    const axis = new Vector3(0, 1, 0)
    const target = { position: new Vector3(4, 2, 1), quaternion: new Quaternion(), scale: new Vector3(2, 3, 4) }
    const transition = new InertialPoseTransition([target])
    transition.capture()
    target.position.set(0, 0, 0)
    target.quaternion.setFromAxisAngle(axis, 170 * Math.PI / 180)
    target.scale.set(1, 1, 1)
    transition.begin(1)
    expect(transition.blend).toBe(0)
    expect(target.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-7)
    expect(target.position.toArray()).toEqual([4, 2, 1])

    transition.restore()
    target.position.set(2, 0, 0)
    target.quaternion.setFromAxisAngle(axis, 179 * Math.PI / 180)
    transition.advance(.25)
    expect(transition.blend).toBe(.15625)
    transition.advance(.25)
    expect(transition.blend).toBe(.5)
    transition.apply()
    // Half of the fixed -170 degree offset leaves +94 degrees, not the
    // opposite route selected by blending a changing target against idle.
    const expected = new Quaternion().setFromAxisAngle(axis, 94 * Math.PI / 180)
    expect(target.quaternion.angleTo(expected)).toBeLessThan(1e-7)
    transition.apply()
    expect(target.quaternion.angleTo(expected)).toBeLessThan(1e-7)
    expect(target.position.toArray()).toEqual([4, 1, .5])
    expect(target.scale.toArray()).toEqual([1.5, 2, 2.5])

    transition.restore()
    target.quaternion.setFromAxisAngle(axis, 181 * Math.PI / 180)
    transition.apply()
    expected.setFromAxisAngle(axis, 96 * Math.PI / 180)
    expect(target.quaternion.angleTo(expected)).toBeLessThan(1e-7)
    transition.advance(.5)
    transition.apply()
    expected.setFromAxisAngle(axis, 181 * Math.PI / 180)
    expect(target.quaternion.angleTo(expected)).toBeLessThan(1e-7)
    expect(target.position.toArray()).toEqual([2, 0, 0])
    expect(target.scale.toArray()).toEqual([1, 1, 1])
    expect(transition.active).toBe(false)
    expect(transition.blend).toBe(1)

    // Dynamic relative rotation (saved^-1 * target) during trimmed 2H axe
    // release/acquisition must also track across the 180-degree hemisphere
    // boundary without flipping the blended branch when prevDelta is carried.
    const saved = new Quaternion().setFromAxisAngle(axis, 20 * Math.PI / 180)
    const dynamicTarget = new Quaternion().setFromAxisAngle(axis, 199 * Math.PI / 180)
    const prevDelta = blendContinuousLocalQuaternion(saved, dynamicTarget, .5).clone()
    expect(dynamicTarget.angleTo(new Quaternion().setFromAxisAngle(axis, 109.5 * Math.PI / 180))).toBeLessThan(1e-7)

    dynamicTarget.setFromAxisAngle(axis, 201 * Math.PI / 180)
    blendContinuousLocalQuaternion(saved, dynamicTarget, .5, prevDelta)
    expect(dynamicTarget.angleTo(new Quaternion().setFromAxisAngle(axis, 110.5 * Math.PI / 180))).toBeLessThan(1e-7)
  })

  it('keeps the weapon cycle and emits one hit when a fast distant swing crosses contact and completion together', () => {
    const { animator, animation, controller } = trimmedAxeAnimator(.06)
    // The recovery clock remains clamped when one update skips its entire window.
    expect(axeRecoveryWeight('axeAttack2H', .42, true)).toBe(0)
    expect(axeRecoveryWeight('axeAttack2H', .45, true)).toBeCloseTo(.5)
    expect(axeRecoveryWeight('axeAttack2H', 2, true)).toBe(1)
    expect(axeRecoveryWeight('axeAttack2H', 2)).toBe(0)
    expect(axeRecoveryWeight('axeAttack1H', 2, true)).toBe(0)
    expect(controller.getMeleeTiming('axeAttack2H')).toEqual({
      duration: .48, activeStart: .12, hit: .18, activeEnd: .24, clipTimeScale: 1, attackFadeInSeconds: .06,
    })
    // A .54s weapon cycle at 2.25x hero speed must finish in .24s, not .48s.
    const timeScale = meleeActionTimeScale('axeAttack2H', WEAPONS.axe_t5, 2.25)
    expect(timeScale).toBe(2)
    expect(animator.start('axeAttack2H', timeScale)).toBe(true)
    expect(animation.play).toHaveBeenLastCalledWith('axeAttack2H', {
      fadeSeconds: .03, loop: false, timeScale: 2,
    })
    expect(animator.update(.059, 100).hitActiveStarted).toBe(false)
    expect(animator.meleeHitActive).toBe(false)
    // Source .175s is active, but must not use the legacy .17s fallback hit.
    expect(animator.update(.0285, 100).hitActiveStarted).toBe(false)
    expect(animator.meleeHitActive).toBe(true)
    expect(animator.busy).toBe(true)
    expect(animator.update(.1525, 100)).toEqual({
      hitActiveStarted: true, projectileRelease: false, actionCompleted: true,
    })
    expect(animation.update).toHaveBeenCalledWith(.1525, 0)
    expect(animator.busy).toBe(false)
    expect(animator.meleeHitActive).toBe(false)
    expect(animator.update(1, 100)).toEqual({
      hitActiveStarted: false, projectileRelease: false, actionCompleted: false,
    })
  })

  it('cancels an imported axe without a fade opt-in before contact and restores the latest mounted locomotion', () => {
    // A measured melee timeline does not itself opt into a different fade.
    const { animator, animation, state } = trimmedAxeAnimator()
    animator.setLocomotion(2)
    expect(animator.start('axeAttack2H', 2)).toBe(true)
    expect(animation.play).toHaveBeenLastCalledWith('axeAttack2H', {
      fadeSeconds: .1, loop: false, timeScale: 2,
    })
    expect(animator.update(.08, 100).hitActiveStarted).toBe(false)
    expect(animator.meleeHitActive).toBe(true)
    animator.setLocomotion(4, true)
    animator.cancel()
    expect(animator.currentAction).toBe('idle')
    expect(state).toMatchObject({ action: 'idle', elapsed: 0, mounted: true })
    expect(animation.play).toHaveBeenLastCalledWith('mounted', expect.objectContaining({ loop: true, timeScale: 1 }))
    expect(animator.update(1, 100)).toEqual({
      hitActiveStarted: false, projectileRelease: false, actionCompleted: false,
    })
    expect(animator.meleeHitActive).toBe(false)
  })

  it('cancels gameplay immediately while the authored axe visual release finishes without another event', () => {
    const { animator, animation, state, attachment, meleePivot } = trimmedAxeAnimator(.06)
    // Presence markers only; the geometry attachment boundary remains absent.
    Object.assign(attachment, { swordAttachmentOwned: false, equipmentAttachmentOwned: 'axe', authoredAxeSocket: {}, axeVisual: {} })
    animator.setLocomotion(0, true)
    animator.start('axeAttack2H', 2)
    expect(animator.update(.225).hitActiveStarted).toBe(true)
    animator.cancel()
    expect(animator.currentAction).toBe('idle')
    expect(animator.busy).toBe(false)
    expect(animator.meleeHitActive).toBe(false)
    expect(state.action).toBe('axeAttack2H')
    expect(state.elapsed).toBeCloseTo(.45)
    animator.setLocomotion(4, true)
    animator.poseIdle()
    expect(animator.update(0, 100)).toEqual({ hitActiveStarted: false, projectileRelease: false, actionCompleted: false })
    expect(state.elapsed).toBeCloseTo(.45)
    expect(animator.update(.014, 100).actionCompleted).toBe(false)
    expect(state.elapsed).toBeCloseTo(.478)
    expect(animation.update).toHaveBeenLastCalledWith(.014, 0)
    animator.cancel()
    expect(state.elapsed).toBeCloseTo(.478)
    // None/bow can hide the old axe without replacing its visual identity.
    const holdsTail = Object.getOwnPropertyDescriptor(CharacterCombatAnimator.prototype, 'hasCanceledAxePose')!.get!
    meleePivot.visible = false
    expect(holdsTail.call(animator)).toBe(false)
    meleePivot.visible = true
    attachment.meleeAnimationKind = 'sword'
    expect(holdsTail.call(animator)).toBe(false)
    attachment.meleeAnimationKind = 'axe'
    expect(holdsTail.call(animator)).toBe(true)
    expect(animator.update(1, 100)).toEqual({ hitActiveStarted: false, projectileRelease: false, actionCompleted: false })
    expect(state).toMatchObject({ action: 'idle', elapsed: 0, continuousAxeAction: false })
  })
})

describe('Combat animator bow-to-lance recovery', () => {
  it('ends the fresh bow aim after a shot and permits another mounted shot', () => {
    const { animator, animation, state } = lanceAnimator()
    animator.poseBow(1)
    expect(animator.start('bowRelease')).toBe(true)
    expect(animation.play).toHaveBeenLastCalledWith('bowRelease', { fadeSeconds: .1, loop: false })
    animator.poseLanceReady(true)
    expect(animator.currentAction).toBe('bowRelease')
    const profile = COMBAT_ANIMATION_PROFILES.bowRelease
    expect(animator.update(profile.windup).projectileRelease).toBe(true)
    expect(animator.update(profile.recovery).actionCompleted).toBe(true)
    expect(animator.currentAction).toBe('idle')

    // RMB is still held on the next Player frame, so aiming resumes. Releasing
    // RMB must end that state even when imported equipment owns the lance pose.
    animator.poseBow(0)
    animator.setLocomotion(0, true)
    animator.poseLanceReady(true)
    animator.setLocomotion(0, true)
    animator.update(0)
    expect(animator.currentAction).toBe('idle')
    expect(state).toMatchObject({ action: 'idle', mounted: true, lance: true, elapsed: 0 })
    expect(animation.play).toHaveBeenLastCalledWith('mounted', expect.objectContaining({ loop: true }))
    expect(animator.update(.1).projectileRelease).toBe(false)

    animator.poseBow(1)
    expect(animator.start('bowRelease')).toBe(true)
    expect(animator.update(profile.windup).projectileRelease).toBe(true)
    expect(animator.update(profile.recovery).actionCompleted).toBe(true)
  })

  it('cancels a partial draw into the latest moving or dismounted locomotion', () => {
    const { animator, animation, state } = lanceAnimator()
    animator.setLocomotion(4, true)
    animator.poseBow(.5)
    animator.poseLanceReady(true)
    animator.setLocomotion(4, true)
    expect(animator.currentAction).toBe('idle')
    expect(state.action).toBe('idle')
    expect(animation.play).toHaveBeenLastCalledWith('mounted', expect.objectContaining({ loop: true }))

    // The next draw ends while dismounting; the current walking state wins.
    animator.poseBow(.5)
    animator.setLocomotion(2, false)
    animator.poseLanceReady(false)
    animator.setLocomotion(2, false)
    expect(animator.currentAction).toBe('idle')
    expect(state).toMatchObject({ action: 'idle', mounted: false, lance: true, elapsed: 0 })
    expect(animation.play).toHaveBeenLastCalledWith('walk', expect.objectContaining({ loop: true, timeScale: 1 }))
    expect(animator.update(.5)).toEqual({ hitActiveStarted: false, projectileRelease: false, actionCompleted: false })
  })
})

interface IdleLocomotionActor {
  animator: CharacterCombatAnimator
  bowPivot: { visible: boolean }
  bowVisual: { update(draw: number, target: Vector3 | undefined, arrow: boolean): void }
  characterFaction: 'viking'
  isUsingLance: boolean
  visualMovementSpeed: number
  isMounted: boolean
  isSprinting: boolean
  _updateIdleLocomotion(animationAdvanced: boolean): void
}
function mountedTravelPose() {
  const { animator, animation } = lanceAnimator()
  animator.setEquipment(false, false, 'HORSE')
  const bowVisual = { update: vi.fn() }
  const actor = Object.assign(Object.create(NPC.prototype) as IdleLocomotionActor, {
    animator, bowVisual, bowPivot: { visible: true }, characterFaction: 'viking' as const,
    visualMovementSpeed: 5, isSprinting: false,
  })
  Object.defineProperties(actor, { isUsingLance: { value: false }, isMounted: { value: true } })
  return { actor, animator, animation, bowVisual }
}
describe('NPC non-combat locomotion ownership', () => {
  it('uses mounted locomotion without starting a passive bow draw, including after a stale aim', () => {
    const { actor, animator, animation, bowVisual } = mountedTravelPose()
    actor._updateIdleLocomotion(false)
    expect(animator.currentAction).toBe('idle')
    expect(animation.seek).not.toHaveBeenCalled()
    animator.poseBow(0)
    actor._updateIdleLocomotion(false)
    expect(animator.currentAction).toBe('idle')
    expect(bowVisual.update).toHaveBeenCalledWith(0, undefined, false)
    expect(animation.play).toHaveBeenLastCalledWith('mounted', expect.objectContaining({ loop: true }))
    expect(animator.update(.1).projectileRelease).toBe(false)
    actor._updateIdleLocomotion(false)
    expect(animator.currentAction).toBe('idle')
  })
  it('preserves real combat aiming, bow release and recovery during locomotion updates', () => {
    const { actor, animator, bowVisual } = mountedTravelPose()
    animator.poseBow(1)
    actor._updateIdleLocomotion(true)
    expect(animator.currentAction).toBe('bowAim')
    expect(bowVisual.update).not.toHaveBeenCalled()
    expect(animator.start('bowRelease')).toBe(true)
    actor._updateIdleLocomotion(true)
    expect(animator.currentAction).toBe('bowRelease')
    const profile = COMBAT_ANIMATION_PROFILES.bowRelease
    expect(animator.update(profile.windup).projectileRelease).toBe(true)
    actor._updateIdleLocomotion(true)
    expect(animator.update(profile.recovery).actionCompleted).toBe(true)
    actor._updateIdleLocomotion(false)
    expect(animator.currentAction).toBe('idle')
  })
})

interface SelectionTarget { position: Vector3; isDead: boolean; isPlayer: boolean; npc?: NPC }

interface SelectionActor {
  characterFaction: NPC['characterFaction']
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
  readonly rangedProjectileSpeed: number
  assignedSiegeObstacle: ObstacleData | null
  _tmpRangedOrigin: Vector3
  _tmpRangedLosTarget: Vector3
  _tmpRangedArcPrevious: Vector3
  _tmpRangedArcPoint: Vector3
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
  _findRangedTrajectoryBlocker(target: Vector3, obstacles: ObstacleData[]): ObstacleData | null
  _isAttackableObstacle(obstacle: ObstacleData | null): boolean
  _isRampartMeleeThreat(position: Vector3): boolean
}
interface SelectionMethods extends Pick<SelectionActor, '_cancelEquipmentCombatState' | '_switchToMelee' | '_isRampartMeleeThreat' | '_isRangedMeleeThreat' | '_refreshActiveShield' | '_usesReversibleRangedSwitch' | '_restoreCombatReadyRangedVisual' | '_findRangedTrajectoryBlocker' | '_isAttackableObstacle'> {
  _selectRangedMeleeMode(this: SelectionActor, target: SelectionTarget | null,
    player: Player, nearby: readonly NPC[], obstacles: ObstacleData[]): void
}
// The existing decision entry needs state and narrow animation/visibility boundaries only.
// Its production cancellation and mode-switch methods run without constructing an actor.
const methods = NPC.prototype as unknown as SelectionMethods
function selection(overrides: Partial<SelectionActor> = {}) {
  const actor = {
    characterFaction: 'roman', faction: Faction.ENEMY, holdsRampartFirePosition: false, combatPosition: new Vector3(), rangedWeaponId: 'recurve_longbow',
    meleeWeaponId: 'steel_sword', meleeAttackRadius: 1.8, shieldId: null, shieldPivot: { visible: false }, tacticalOrder: 'attack',
    shieldCollider: { refreshVisibility() { actor.shieldPivot.visible = actor.hasActiveShield && !actor.shield.shieldBroken } },
    assignedSiegeObstacle: null, _isAttackableObstacle: methods._isAttackableObstacle,
    _tmpRangedOrigin: new Vector3(), _tmpRangedLosTarget: new Vector3(),
    _tmpRangedArcPrevious: new Vector3(), _tmpRangedArcPoint: new Vector3(),
    _rangedPathBounds: new Box3(), _rangedPathObstacles: [],
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
    rangedProjectileSpeed: Object.getOwnPropertyDescriptor(NPC.prototype, 'rangedProjectileSpeed')!,
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
  it('repeats Commander shielded hybrid switching with hysteresis and preserves ammo and damaged shield', () => {
    const loadout = careerCommanderLoadout('viking')
    const h = selection({ shieldId: loadout.shieldId, meleeWeaponId: loadout.meleeWeaponId,
      rangedWeaponId: loadout.rangedWeaponId!, tacticalOrder: 'defend' })
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
    expect(h.actor.shieldId).toBe('commander_shield_t5')
    h.actor.arrows = 0
    hostile.combatPosition.z = 12
    h.select([hostile])
    expect(h.actor.rangedActive).toBe(false)
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

  it('excludes friendly structures while retaining hostile and unowned siege blockers', () => {
    const { actor } = selection()
    const root: Pick<Object3D, 'parent'> = { parent: null }
    const candidates = (['roman', 'viking', null] as const).map(ownerFaction => ({
      box: new Box3(new Vector3(-1, -1, 3), new Vector3(1, 3, 5)), isBarricade: true,
      damageable: new DamageableObstacle({ kind: 'siege_ramp', maxHp: 100, root: root as Object3D, ownerFaction }),
    }))
    expect(candidates.filter(obstacle => actor._isAttackableObstacle(obstacle))).toEqual([candidates[1], candidates[2]])
  })

  it('resumes shooting its assigned siege target after a hostile retreats without allowing unrelated blockers', () => {
    const h = selection({ shieldId: 'scutum_t2', _findRangedTrajectoryBlocker: methods._findRangedTrajectoryBlocker })
    // Plain lifecycle boundary only: no scene, render objects or obstacle builder.
    const root: Pick<Object3D, 'parent'> = { parent: null }
    const gate: ObstacleData = { box: new Box3(new Vector3(-1, -1, 3), new Vector3(1, 3, 5)), isBarricade: true,
      damageable: new DamageableObstacle({ kind: 'gate', maxHp: 100, root: root as Object3D }) }
    const target = { position: gate.box.getCenter(new Vector3()), isDead: gate.damageable!.destroyed, isPlayer: false }
    h.actor.assignedSiegeObstacle = gate
    expect(h.actor._findRangedTrajectoryBlocker(target.position, [gate])).toBe(gate)
    h.select([], target, [gate])
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
    expect(h.actor.shield.active).toBe(false)
    expect([h.actor.swordPivot.visible, h.actor.bowPivot.visible]).toEqual([false, true])
    expect(h.actor.arrows).toBe(12)
    expect(h.actor.animator.cancel).not.toHaveBeenCalled()
    // A real close enemy behind the closed gate intentionally still triggers melee readiness.
    const hostile = { faction: Faction.PLAYER, dead: false, combatPosition: new Vector3(0, 0, 5.5) } as NPC
    h.select([hostile], target, [gate])
    expect(h.actor.hasActiveRangedWeapon).toBe(false)
    expect(h.actor.shield.active).toBe(true)
    hostile.combatPosition.z = 12
    const wall: ObstacleData = { box: new Box3(new Vector3(-1, -1, 1), new Vector3(1, 3, 2)), isBarricade: true,
      damageable: new DamageableObstacle({ kind: 'palisade', maxHp: 100, root: root as Object3D }) }
    expect(h.actor._findRangedTrajectoryBlocker(target.position, [wall, gate])).toBe(wall)
    h.select([hostile], target, [wall, gate])
    expect(h.actor.hasActiveRangedWeapon).toBe(false)
    h.actor.assignedSiegeObstacle = null
    h.select([hostile], target, [gate])
    expect(h.actor.hasActiveRangedWeapon).toBe(false)
    h.actor.assignedSiegeObstacle = gate
    h.select([hostile], target, [gate])
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
    expect(h.actor.shield.active).toBe(false)
    expect(h.actor.arrows).toBe(12)
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


it('uses the smallest shoulder swing and approaches zero continuously at the reach boundary', () => {
  const shoulder = new Vector3(0, 1, 0), wrist = new Vector3(1, 0, 0)
  const swing = minimumReachableShoulderSwing(shoulder, wrist, 1)!
  expect(swing).toBeCloseTo(Math.PI / 6, 12)
  expect(minimumReachableShoulderSwing(shoulder.clone().negate(), wrist, 1)).toBeCloseTo(swing, 12)
  const axis = new Vector3(0, 0, -1)
  expect(wrist.distanceTo(shoulder.clone().applyAxisAngle(axis, swing))).toBeCloseTo(1, 12)
  expect(wrist.distanceTo(shoulder.clone().applyAxisAngle(axis, swing / 2))).toBeGreaterThan(1)
  expect(minimumReachableShoulderSwing(shoulder, wrist, Math.sqrt(2))).toBeCloseTo(0, 12)
  const epsilon = 1e-5
  const nearBoundary = Math.sqrt(2 - 2 * Math.sin(epsilon))
  expect(minimumReachableShoulderSwing(shoulder, wrist, nearBoundary)).toBeCloseTo(epsilon, 10)
  expect(shoulder.toArray()).toEqual([0, 1, 0])
  expect(wrist.toArray()).toEqual([1, 0, 0])
})

it('does not invent a reachable shoulder swing for impossible targets or invalid geometry', () => {
  const shoulder = new Vector3(0, 1, 0), wrist = new Vector3(2, 0, 0)
  expect(minimumReachableShoulderSwing(shoulder, wrist, 1)).toBeCloseTo(Math.PI / 2, 12)
  expect(minimumReachableShoulderSwing(shoulder, wrist, 0.5)).toBeNull()
  expect(minimumReachableShoulderSwing(shoulder, new Vector3(), 1)).toBe(0)
  expect(minimumReachableShoulderSwing(shoulder, new Vector3(), 0.5)).toBeNull()
  expect(minimumReachableShoulderSwing(new Vector3(), wrist, 1)).toBeNull()
  expect(minimumReachableShoulderSwing(shoulder, wrist, Number.NaN)).toBeNull()
  expect(minimumReachableShoulderSwing(new Vector3(Infinity, 0, 0), wrist, 1)).toBeNull()
})
