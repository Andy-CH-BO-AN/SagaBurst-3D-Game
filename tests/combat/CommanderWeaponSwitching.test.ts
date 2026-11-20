import { Box3, Euler, Vector3, type Group, type Object3D } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { resolveT4UnitLoadout } from '../../src/battle/T4HeroCatalog'
import type { UnitLoadout } from '../../src/battle/UnitPresetCatalog'
import { careerCommanderLoadout } from '../../src/career/CareerCommanderEquipment'
import { Faction } from '../../src/combat/CombatFaction'
import { chooseReversibleWeaponMode, needsWeaponModeDecision, withinRangedMeleeThreatReach } from '../../src/combat/ReversibleWeaponMode'
import { ShieldState } from '../../src/combat/ShieldBlocking'
import type { OutpostLayeredNavigation } from '../../src/navigation/OutpostLayeredNavigation'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import type { Player } from '../../src/player/Player'
import { resolveRangedAim } from '../../src/player/RangedAimGate'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { chooseMerchantMelee, isTownMerchantLoadout, townMerchantLoadout } from '../../src/town/TownMerchantEquipment'
import { CharacterCombatAnimator, type CombatAction, COMBAT_ANIMATION_PROFILES, meleeActionTimeScale, PILUM_THROW_RELEASE_TIME } from '../../src/world/CharacterCombatAnimator'
import { type EquipmentPoseState } from '../../src/world/CharacterEquipmentPose'
import type { CharacterRig, HumanoidAnimationController, HumanoidAnimationPlayOptions, HumanoidAnimationState } from '../../src/world/CharacterVisuals'
import type { EquipmentGripFrames } from '../../src/world/EquipmentAttachmentContract'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { MixerController } from '../../src/world/HumanoidAssetRegistry'
import { AIState, AIType, NPC } from '../../src/world/NPC'
import { RampartDuty } from '../../src/battle/RampartDuty'
import { axeRecoveryWeight } from '../../src/world/SwordAttachmentContract'
import type { ObstacleData } from '../../src/world/Terrain'

/** Clip and update requests the animator made to its external animation boundary. */
interface AnimationRecord {
  lastPlay?: { clip: HumanoidAnimationState } & HumanoidAnimationPlayOptions
  readonly updates: { dt: number; cameraDistance?: number }[]
  seeks: number
}

/** Real animator constructor; only the clip/pose controller and attachment markers are doubled. */
function combatAnimator(getMeleeTiming?: HumanoidAnimationController['getMeleeTiming'], weapon: 'lance' | 'axe' = 'lance') {
  const state: Partial<EquipmentPoseState> = {}
  const attachment: Record<string, unknown> = weapon === 'lance'
    ? { equipmentAttachmentOwned: 'lance' }
    : { swordAttachmentOwned: true, meleeAnimationKind: 'axe' }
  const meleePivot = { visible: true, userData: attachment, position: new Vector3(), rotation: new Euler() }
  const bowPivot = { visible: false, userData: {}, position: new Vector3(), rotation: new Euler() }
  const record: AnimationRecord = { updates: [], seeks: 0 }
  const animation = {
    setEquipmentState: (update: Partial<EquipmentPoseState>) => Object.assign(state, update),
    play: (clip, options) => { record.lastPlay = { clip, ...options }; return true },
    seek: () => { record.seeks++; return true },
    has: () => true,
    setBowLocomotion: () => {},
    update: (dt, cameraDistance) => { record.updates.push({ dt, cameraDistance }) },
    getDuration: () => undefined, stop: () => {},
    getMeleeTiming,
  } satisfies HumanoidAnimationController
  // Imported-rig path only: no bones, mixer or Object3D. Grip frames mark
  // equipment-owned hand poses, so procedural arm rotation is never reached.
  const rig: Pick<CharacterRig, 'animation' | 'equipmentGripFrames'> & { right: { handSocket: Pick<Object3D, 'userData'> } } = {
    animation, equipmentGripFrames: {} as EquipmentGripFrames, right: { handSocket: { userData: {} } },
  }
  const animator = new CharacterCombatAnimator(rig as unknown as CharacterRig, meleePivot as unknown as Group, bowPivot as unknown as Group)
  return { animator, animation: record, state, attachment, meleePivot }
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
    expect(animation.lastPlay).toEqual({ clip: 'axeAttack2H', fadeSeconds: .03, loop: false, timeScale: 2 })
    expect(animator.update(.059, 100).hitActiveStarted).toBe(false)
    expect(animator.meleeHitActive).toBe(false)
    // Source .175s is active, but must not use the legacy .17s fallback hit.
    expect(animator.update(.0285, 100).hitActiveStarted).toBe(false)
    expect(animator.meleeHitActive).toBe(true)
    expect(animator.busy).toBe(true)
    expect(animator.update(.1525, 100)).toEqual({
      hitActiveStarted: true, projectileRelease: false, actionCompleted: true, fists: [],
    })
    expect(animation.updates).toContainEqual({ dt: .1525, cameraDistance: 0 })
    expect(animator.busy).toBe(false)
    expect(animator.meleeHitActive).toBe(false)
    expect(animator.update(1, 100)).toEqual({
      hitActiveStarted: false, projectileRelease: false, actionCompleted: false, fists: [],
    })
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
    expect(animator.update(0, 100)).toEqual({ hitActiveStarted: false, projectileRelease: false, actionCompleted: false, fists: [] })
    expect(state.elapsed).toBeCloseTo(.45)
    expect(animator.update(.014, 100).actionCompleted).toBe(false)
    expect(state.elapsed).toBeCloseTo(.478)
    expect(animation.updates.at(-1)).toEqual({ dt: .014, cameraDistance: 0 })
    animator.cancel()
    expect(state.elapsed).toBeCloseTo(.478)
    // None/bow can hide the old axe without replacing its visual identity:
    // the idle pose drops the tail while hidden or replaced, then resumes it.
    meleePivot.visible = false
    animator.poseIdle()
    expect(state).toMatchObject({ action: 'idle', elapsed: 0 })
    meleePivot.visible = true
    attachment.meleeAnimationKind = 'sword'
    animator.poseIdle()
    expect(state).toMatchObject({ action: 'idle', elapsed: 0 })
    attachment.meleeAnimationKind = 'axe'
    animator.poseIdle()
    expect(state.action).toBe('axeAttack2H')
    expect(state.elapsed).toBeCloseTo(.478)
    expect(animator.update(1, 100)).toEqual({ hitActiveStarted: false, projectileRelease: false, actionCompleted: false, fists: [] })
    expect(state).toMatchObject({ action: 'idle', elapsed: 0, continuousAxeAction: false })
  })
})

describe('Combat animator bow-to-lance recovery', () => {
  const rmbHeld = { rightMouseDown: true, wantAim: true, swinging: false } as const
  const rmbUp = { rightMouseDown: false, wantAim: false, swinging: false } as const
  interface AimFrame { action: CombatAction; rightMouseDown: boolean; wantAim: boolean; requiresRmbRelease: boolean; swinging: boolean; viewActive: boolean }
  const aim = (f: AimFrame) => ({ ...resolveRangedAim(f.action, f.rightMouseDown, f.wantAim, f.requiresRmbRelease, f.swinging, f.viewActive) })

  it('射箭與連射的收招維持右鍵視角，收招中放開右鍵立即退出', () => {
    const fresh = { requiresRmbRelease: false } as const
    expect(aim({ ...rmbHeld, ...fresh, action: 'idle', viewActive: false }))
      .toEqual({ aiming: true, viewActive: true, requiresRmbRelease: false })
    expect(aim({ ...rmbHeld, ...fresh, action: 'bowAim', viewActive: true }))
      .toEqual({ aiming: true, viewActive: true, requiresRmbRelease: false })
    // Release and recovery block a new draw but keep the held view for rapid fire.
    expect(aim({ ...rmbHeld, ...fresh, action: 'bowRelease', viewActive: true }))
      .toEqual({ aiming: false, viewActive: true, requiresRmbRelease: false })
    // Letting go of RMB mid-recovery leaves the view on that same frame.
    expect(aim({ ...rmbUp, ...fresh, action: 'bowRelease', viewActive: true }))
      .toEqual({ aiming: false, viewActive: false, requiresRmbRelease: false })
    expect(aim({ ...rmbUp, ...fresh, action: 'idle', viewActive: false }))
      .toEqual({ aiming: false, viewActive: false, requiresRmbRelease: false })
    // A melee swing never opens the ranged view.
    expect(aim({ ...rmbHeld, ...fresh, swinging: true, action: 'swordSlash', viewActive: false }))
      .toEqual({ aiming: false, viewActive: false, requiresRmbRelease: false })
  })

  it('標槍投擲維持既有釋放前視角與右鍵重新按壓限制', () => {
    const { animator } = lanceAnimator()
    const frame = (input: typeof rmbHeld | typeof rmbUp, requiresRmbRelease: boolean, viewActive: boolean) =>
      aim({ ...input, action: animator.currentAction, requiresRmbRelease, viewActive })
    expect(frame(rmbHeld, false, false)).toEqual({ aiming: true, viewActive: true, requiresRmbRelease: false })
    animator.posePilum(0)
    expect(animator.start('pilumThrow')).toBe(true)
    // Starting the throw locks RMB; the pre-release view stays while RMB is held.
    expect(frame(rmbHeld, true, true)).toEqual({ aiming: false, viewActive: true, requiresRmbRelease: true })
    const profile = COMBAT_ANIMATION_PROFILES.pilumThrow
    expect(animator.update(PILUM_THROW_RELEASE_TIME).projectileRelease).toBe(true)
    // The projectile event ended the view; releasing RMB mid-throw keeps the lock.
    expect(frame(rmbUp, true, false)).toEqual({ aiming: false, viewActive: false, requiresRmbRelease: true })
    expect(animator.update(profile.windup + profile.recovery - PILUM_THROW_RELEASE_TIME).actionCompleted).toBe(true)
    expect(frame(rmbHeld, true, false)).toEqual({ aiming: false, viewActive: false, requiresRmbRelease: true })
    expect(frame(rmbUp, true, false)).toEqual({ aiming: false, viewActive: false, requiresRmbRelease: false })
    expect(frame(rmbHeld, false, false)).toEqual({ aiming: true, viewActive: true, requiresRmbRelease: false })
  })

  it('ends the fresh bow aim after a shot and permits another mounted shot', () => {
    const { animator, animation, state } = lanceAnimator()
    animator.poseBow(1)
    expect(animator.start('bowRelease')).toBe(true)
    expect(animation.lastPlay).toEqual({ clip: 'bowRelease', fadeSeconds: .1, loop: false })
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
    expect(animation.lastPlay).toMatchObject({ clip: 'mounted', loop: true })
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
    expect(animation.lastPlay).toMatchObject({ clip: 'mounted', loop: true })

    // The next draw ends while dismounting; the current walking state wins.
    animator.poseBow(.5)
    animator.setLocomotion(2, false)
    animator.poseLanceReady(false)
    animator.setLocomotion(2, false)
    expect(animator.currentAction).toBe('idle')
    expect(state).toMatchObject({ action: 'idle', mounted: false, lance: true, elapsed: 0 })
    expect(animation.lastPlay).toMatchObject({ clip: 'walk', loop: true, timeScale: 1 })
    expect(animator.update(.5)).toEqual({ hitActiveStarted: false, projectileRelease: false, actionCompleted: false, fists: [] })
  })
})

/**
 * The one unconstructed-NPC seam: only model, scene and mount construction are
 * bypassed. Each caller passes the plain state and boundary doubles its entry reads.
 */
function unconstructedNpc<T>(state: object): T {
  return Object.assign(Object.create(NPC.prototype) as object, state) as T
}

interface IdleLocomotionActor {
  animator: CharacterCombatAnimator
  bowPivot: { visible: boolean }
  bowVisual: { update(draw: number, target: Vector3 | undefined, arrow: boolean): void }
  characterFaction: 'viking'
  isUsingLance: boolean
  visualMovementSpeed: number
  readonly isMounted: boolean
  isSprinting: boolean
  _updateIdleLocomotion(animationAdvanced: boolean): void
}
function mountedTravelPose() {
  const { animator, animation } = lanceAnimator()
  animator.setEquipment(false, false, 'HORSE')
  const bowVisual = {
    shown: undefined as { draw: number; target: Vector3 | undefined; arrow: boolean } | undefined,
    update(draw: number, target: Vector3 | undefined, arrow: boolean) { bowVisual.shown = { draw, target, arrow } },
  }
  const actor = unconstructedNpc<IdleLocomotionActor>({
    animator, bowVisual, bowPivot: { visible: true }, characterFaction: 'viking',
    visualMovementSpeed: 5, isSprinting: false, isUsingLance: false,
  })
  Object.defineProperty(actor, 'isMounted', { value: true })
  return { actor, animator, animation, bowVisual }
}
describe('NPC non-combat locomotion ownership', () => {
  it('manages non-combat locomotion and preserves real combat aiming during updates', () => {
    const { actor, animator, animation, bowVisual } = mountedTravelPose()
    actor._updateIdleLocomotion(false)
    expect(animator.currentAction).toBe('idle')
    expect(animation.seeks).toBe(0)
    animator.poseBow(0)
    actor._updateIdleLocomotion(false)
    expect(animator.currentAction).toBe('idle')
    expect(bowVisual.shown).toEqual({ draw: 0, target: undefined, arrow: false })
    expect(animation.lastPlay).toMatchObject({ clip: 'mounted', loop: true })
    expect(animator.update(.1).projectileRelease).toBe(false)
    actor._updateIdleLocomotion(false)
    expect(animator.currentAction).toBe('idle')

    // Preserves real combat aiming, bow release and recovery during locomotion
    animator.poseBow(1)
    actor._updateIdleLocomotion(true)
    expect(animator.currentAction).toBe('bowAim')
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
  holdsRampartPosition?: boolean
  _activeNavigationWorld?: { townNav?: TownLayeredNavigation; outpostNav?: Pick<OutpostLayeredNavigation, 'getNavLayer'> }
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
  mount?: { flight: object } | null
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
  swordPivot: { visible: boolean }
  bowPivot: { visible: boolean }
  shieldPivot: { visible: boolean }
  applyTemporaryCombatLoadout(loadout: UnitLoadout): void
  restoreCombatLoadout(): void
}
/** Actual temporary-loadout transaction; only weapon and shield model rebuilding are external boundaries. */
function temporaryLoadoutActor(): TemporaryLoadoutActor {
  return unconstructedNpc<TemporaryLoadoutActor>({
    state: AIState.IDLE, arrows: 7, rangedActive: true, _rangedDamage: 20, meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow',
    shieldId: null, originalCombatEquipment: null, townArmed: false,
    loadout: { meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', reversibleRangedSwitch: true },
    animator: { cancel() {}, setEquipment() {} }, bowVisual: { hideArrow() {} }, rig: {},
    swordPivot: { visible: false }, bowPivot: { visible: true }, shieldPivot: { visible: false },
    _rebuildActiveMeleeVisual() {}, _rebuildActiveRangedVisual() {}, rebuildShield() {},
  })
}

describe('Reversible NPC weapon choice', () => {
  it('keeps the active weapon inside the 6-9 m hysteresis band and re-equips ranged only for a live target in bow range', () => {
    const mode = (rangedActive: boolean, threat: number, target: number | null = 20, arrows = 12) =>
      chooseReversibleWeaponMode(arrows, rangedActive, threat ** 2, target === null ? null : target ** 2, 30)
    // Shooting continues until a threat closes to 6 m.
    expect(mode(true, Infinity)).toBe('ranged')
    expect(mode(true, 6.01)).toBe('ranged')
    expect(mode(true, 6)).toBe('melee')
    // Melee holds through 8.99 m and re-equips the bow from 9 m.
    expect(mode(false, 7)).toBe('melee')
    expect(mode(false, 8.99)).toBe('melee')
    expect(mode(false, 9)).toBe('ranged')
    expect(mode(false, Infinity, 30)).toBe('ranged')
    expect(mode(false, Infinity, 30.01)).toBe('melee')
    expect(mode(false, Infinity, null)).toBe('melee')
    // An empty quiver never keeps or re-equips the bow.
    expect(mode(true, Infinity, 20, 0)).toBe('melee')
    expect(mode(false, Infinity, 20, 0)).toBe('melee')
  })

  it('counts a hostile as a melee threat only within 9 m, at melee height and when an eagle rider can dive', () => {
    const rider = new Vector3(0, 5, 0)
    expect(withinRangedMeleeThreatReach(rider, new Vector3(0, 5, 2), 1.8, true)).toBe(true)
    // An eagle that cannot dive keeps its bow even against an adjacent hostile.
    expect(withinRangedMeleeThreatReach(rider, new Vector3(0, 5, 2), 1.8, false)).toBe(false)
    // A ground threat 5 m below is close in 3D but out of melee height.
    expect(withinRangedMeleeThreatReach(rider, new Vector3(0, 0, 2), 1.8, true)).toBe(false)
    expect(withinRangedMeleeThreatReach(rider, new Vector3(0, 6.5, 2), 1.8, true)).toBe(true)
    expect(withinRangedMeleeThreatReach(rider, new Vector3(0, 7, 2), 1.8, true)).toBe(false)
    expect(withinRangedMeleeThreatReach(rider, new Vector3(0, 5, 9), 1.8, true)).toBe(true)
    expect(withinRangedMeleeThreatReach(rider, new Vector3(0, 5, 12), 1.8, true)).toBe(false)
    // The rider passes its eagle's live dive state into that gate.
    const h = selection({ mount: { flight: {} }, eaglePilot: { canUseMelee: false }, combatPosition: rider })
    h.target.position.set(0, 5, 2)
    h.select()
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
    h.actor.eaglePilot!.canUseMelee = true
    h.select()
    expect(h.actor.rangedActive).toBe(false)
  })

  it('decides weapon mode only between committed actions and skips a melee fighter with no ammunition', () => {
    const hybrid = { hasRangedWeapon: true, hasMeleeWeapon: true, busy: false, arrows: 12, rangedActive: true }
    const gate = (update: Partial<typeof hybrid> = {}) => {
      const g = { ...hybrid, ...update }
      return needsWeaponModeDecision(g.hasRangedWeapon, g.hasMeleeWeapon, g.busy, g.arrows, g.rangedActive)
    }
    expect(gate()).toBe(true)
    expect(gate({ rangedActive: false })).toBe(true)
    // Arrow recovery and melee swings finish before any re-equip.
    expect(gate({ busy: true })).toBe(false)
    expect(gate({ busy: true, rangedActive: false })).toBe(false)
    expect(gate({ hasMeleeWeapon: false })).toBe(false)
    expect(gate({ hasRangedWeapon: false })).toBe(false)
    // An empty bow still switches away; an empty melee fighter has nothing to switch to.
    expect(gate({ arrows: 0 })).toBe(true)
    expect(gate({ arrows: 0, rangedActive: false })).toBe(false)
  })

  it('applies the chosen mode to a shielded Commander, keeps ammunition and shield damage, and skips the threat scan without ammunition', () => {
    const loadout = careerCommanderLoadout('viking')
    const h = selection({ shieldId: loadout.shieldId, meleeWeaponId: loadout.meleeWeaponId,
      rangedWeaponId: loadout.rangedWeaponId!, tacticalOrder: 'defend' })
    const pivots = () => [h.actor.swordPivot.visible, h.actor.bowPivot.visible, h.actor.shieldPivot.visible]
    expect(h.actor.shield.absorb(20, 2)).toEqual({ damage: 20, blockedImpact: 0 })
    const hostile = { faction: Faction.PLAYER, dead: false, combatPosition: new Vector3(0, 0, 4) } as NPC
    h.select([hostile])
    expect(h.actor).toMatchObject({ rangedActive: false, arrows: 12, state: AIState.CHASE, attackTimer: 0, attackHitProcessed: false,
      bowArrowReleased: false, pendingLanceChargeSpeed: 0, meleeApproachLimit: Infinity, meleeApproachTarget: null })
    expect(pivots()).toEqual([true, false, true])
    expect(h.actor.shield.shieldRaised).toBe(true)
    expect(h.actor.animator.cancel).toHaveBeenCalled()
    expect(h.actor.bowVisual.hideArrow).toHaveBeenCalledOnce()
    expect(h.actor.shield.absorb(20, 2).blockedImpact).toBe(2)
    const damaged = h.actor.shield.shieldImpactRemaining
    hostile.combatPosition.z = 12
    h.select([hostile])
    expect(h.actor.hasActiveRangedWeapon).toBe(true)
    expect(pivots()).toEqual([false, true, false])
    expect(h.actor.shield.shieldRaised).toBe(false)
    hostile.combatPosition.z = 4
    h.select([hostile])
    expect(h.actor.shield.active).toBe(true)
    expect(h.actor.shield.shieldImpactRemaining).toBe(damaged)
    expect(h.actor.arrows).toBe(12)
    // Melee with an empty quiver returns before iterating its neighborhood.
    h.actor.arrows = 0
    hostile.combatPosition.z = 12
    const nearby = [hostile]
    const iterate = vi.spyOn(nearby, Symbol.iterator)
    h.select(nearby)
    expect(h.actor.rangedActive).toBe(false)
    expect(iterate).not.toHaveBeenCalled()
  })

  it('applies temporary hybrid loadouts with fresh ammunition and restores the equipment and ammunition held before the first override', () => {
    const actor = temporaryLoadoutActor(), original = { ...actor.loadout }
    const pivots = () => [actor.swordPivot.visible, actor.bowPivot.visible, actor.shieldPivot.visible]
    actor.townCategory = 'civilian'
    actor.applyTemporaryCombatLoadout({ meleeWeaponId: 'heavy_lance', rangedWeaponId: 'recurve_longbow' })
    expect(actor).toMatchObject({ rangedWeaponId: 'recurve_longbow', arrows: 30, rangedActive: true })
    expect(pivots()).toEqual([false, false, false])
    // Ammunition spent and a melee switch during the first override are not restored.
    Object.assign(actor, { arrows: 12, rangedActive: false })
    actor.applyTemporaryCombatLoadout(resolveT4UnitLoadout('roman_archer'))
    expect(actor).toMatchObject({ arrows: 30, rangedActive: true })
    expect(pivots()).toEqual([false, false, false])
    actor.restoreCombatLoadout()
    expect(actor).toMatchObject({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', arrows: 7, rangedActive: true })
    expect(actor.loadout).toEqual(original)
    expect(pivots()).toEqual([false, false, false])
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

  it('keeps a player-commanded wall defender shooting a visible hostile beyond a closer enemy below without reclaiming native duty', () => {
    const h = selection({ tacticalOrder: 'defend', combatPosition: new Vector3(0, 5, 0),
      _activeNavigationWorld: { outpostNav: { getNavLayer: () => 'rampart_left' } },
      _findRangedTrajectoryBlocker: methods._findRangedTrajectoryBlocker })
    h.target.position.set(0, 0, 0)
    const below = h.target.npc!
    const shootable = { faction: Faction.PLAYER, dead: false, combatPosition: new Vector3(0, 5, 18) } as NPC
    // Formation completion has set Defend and released native duty. Navigation
    // classification and path-clearing effects are the only targeting boundaries.
    const actor = Object.assign(h.actor, {
      _aiType: AIType.RANGED, mount: null, rampartDuty: new RampartDuty(),
      targetsPlayer: false, missionCombatTarget: undefined, _cachedTargetIsPlayer: false,
      _pursuitTargetAllowed: NPC.prototype['_pursuitTargetAllowed'],
      _cachedTargetNpc: below, _rangedTargetCandidates: [] as NPC[],
      _rangedTargetEligible: [] as NPC[], _rangedTargetEligibleDistSq: [] as number[], _rangedTargetEligibleOrder: [] as number[],
      _clearObstacleDetour() {}, _clearNavigationPath() {}, _clearSiegeFallback() {},
    })
    Object.defineProperties(actor, Object.fromEntries([
      'aiType', 'isMounted', 'isTownRampartGarrisonActive', 'holdsRampartPosition', 'holdsRampartFirePosition',
    ].map(name => [name, Object.getOwnPropertyDescriptor(NPC.prototype, name)!])))
    const targeting = NPC.prototype as unknown as {
      _findTarget(this: typeof actor, player: Player, npcs: NPC[]): SelectionTarget | null
      _trySwitchToVisibleRangedTarget(this: typeof actor, player: Player, npcs: NPC[], grid: null, obstacles: ObstacleData[]): boolean
      _isTargetInDefendRange(this: typeof actor, position: Vector3): boolean
    }
    const player = h.player as Player
    expect(targeting._findTarget.call(actor, player, [below, shootable])?.npc).toBe(below)
    expect(actor.holdsRampartPosition).toBe(false)
    expect(actor.holdsRampartFirePosition).toBe(true)
    expect(targeting._isTargetInDefendRange.call(actor, below.combatPosition)).toBe(false)
    expect(targeting._trySwitchToVisibleRangedTarget.call(actor, player, [below, shootable], null, [])).toBe(true)
    expect(actor._cachedTargetNpc).toBe(shootable)
    expect(targeting._isTargetInDefendRange.call(actor, shootable.combatPosition)).toBe(true)
    h.select([below], { position: shootable.combatPosition, isDead: false, isPlayer: false, npc: shootable })
    expect(actor.rangedActive).toBe(true)
    expect(actor.arrows).toBe(12)
    actor.tacticalOrder = 'attack'
    expect(actor.holdsRampartPosition).toBe(false)
    expect(actor.holdsRampartFirePosition).toBe(false)
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

})

it('preserves merchant fixed gear with a purchased horse and switches only its existing melee weapon between attacks', () => {
  const loadout = townMerchantLoadout('horse')
  expect(isTownMerchantLoadout(loadout)).toBe(true)
  expect(isTownMerchantLoadout({ ...loadout, secondaryMeleeWeaponId: 'paladin_mace_t4' })).toBe(false)
  expect(isTownMerchantLoadout({ ...loadout, mountId: 'black-cat' })).toBe(false)
  expect(chooseMerchantMelee(loadout, true, false)).toBe('axe_t5')
  // A committed swing keeps the held weapon whatever the target does.
  expect(chooseMerchantMelee(loadout, false, true)).toBeNull()
  expect(chooseMerchantMelee(loadout, true, true)).toBeNull()
  expect(chooseMerchantMelee(loadout, false, false)).toBe('sword_t5')
})

describe('NPC shield durability before the model arrives', () => {
  it('keeps a restored durability for the requested shield until that shield is equipped', () => {
    const id = 'viking_dragonward_shield_t4'
    const shield = new ShieldState()
    shield.restoreDurability({ [id]: 17 })
    expect(shield.captureDurability()).toEqual({ [id]: 17 })
    shield.equip(id)
    expect(shield.shieldImpactRemaining).toBe(17)
    expect(shield.captureDurability()).toEqual({ [id]: 17 })
  })
})

