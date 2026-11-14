import * as THREE from 'three'
import { UNARMED_DURATION, punchEventsBetween, punchExtension, type FistStrike, type PunchHand } from '../combat/UnarmedCombat'
import type { CharacterRig, HumanoidAnimationState, HumanoidPunchTiming, MountedPoseKind } from './CharacterVisuals'
import { setRigRotation } from './CharacterVisuals'
import { axeCarryWeight, axeRecoveryWeight, setSwordMountedAttachment } from './SwordAttachmentContract'
import type { EquipmentPoseState } from './CharacterEquipmentPose'
import type { WeaponData } from '../rpg/WeaponDatabase'

export type CombatAction =
  | 'idle'
  | 'daggerSlash'
  | 'swordSlash'
  | 'axeAttack1H'
  | 'axeAttack2H'
  | 'greatswordSlash'
  | 'bowAim'
  | 'bowRelease'
  | 'pilumThrow'
  | 'lanceThrust'
  | 'mountedLance'
  | 'punchCombo'
  | 'punchRight'

export interface CombatAnimationProfile {
  windup: number
  active: number
  recovery: number
}

export interface CombatAnimationEvents {
  hitActiveStarted: boolean
  projectileRelease: boolean
  actionCompleted: boolean
  fists: FistStrike[]
}

export const COMBAT_ANIMATION_PROFILES: Readonly<Record<CombatAction, CombatAnimationProfile>> = {
  punchCombo: { windup: .18, active: 1.2, recovery: .22 },
  punchRight: { windup: .18, active: 1.2, recovery: .22 },
  idle: { windup: 0, active: 0, recovery: 0 },
  daggerSlash: { windup: 0.08, active: 0.10, recovery: 0.14 },
  swordSlash: { windup: 0.14, active: 0.14, recovery: 0.20 },
  axeAttack1H: { windup: 0.10, active: 0.06, recovery: 0.32 },
  axeAttack2H: { windup: 0.14, active: 0.06, recovery: 0.28 },
  greatswordSlash: { windup: 0.28, active: 0.18, recovery: 0.32 },
  bowAim: { windup: 0.18, active: 0, recovery: 0 },
  bowRelease: { windup: 0.04, active: 0, recovery: 0.18 },
  pilumThrow: { windup: 0.45, active: 0, recovery: 0.25 },
  lanceThrust: { windup: 0.12, active: 0.14, recovery: 0.16 },
  mountedLance: { windup: 0.08, active: 0.08, recovery: 0.12 },
}

// The imported 30 FPS overhand throw reaches its shoulder-high forward swing
// on frame 17. Keep the projectile in the hand through the windup.
export const PILUM_THROW_RELEASE_TIME = 17 / 30

// Source frame 10/34 (1H) and 18/49 (2H), with source frame 1 at t=0.
// Measured on the actual cutting edge, not the sword's legacy tip marker.
// Retiming retains the original .48s action/cadence budget.
export const AXE_HIT_TIMES = { axeAttack1H: .48 * 9 / 33, axeAttack2H: .48 * 17 / 48 } as const

/** One clock scales clip playback, contact events and recovery together. */
export function meleeActionTimeScale(action: CombatAction, weapon: WeaponData | undefined, heroSpeed = 1): number {
  if (!weapon?.meleeCycleSeconds) return heroSpeed
  const profile = COMBAT_ANIMATION_PROFILES[action]
  return heroSpeed * (profile.windup + profile.active + profile.recovery) / weapon.meleeCycleSeconds
}

const clamp01 = (value: number): number => THREE.MathUtils.clamp(value, 0, 1)
const IDLE_BLADE_PITCH = 2.85
const ease = (value: number): number => {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function holdsVisibleMesh(node: THREE.Object3D): boolean {
  if (!node.visible) return false
  if (node instanceof THREE.Mesh) return true
  return node.children.some(holdsVisibleMesh)
}

/** Shared allocation-free FK pose sampler used by Player and NPC combat. */
export class CharacterCombatAnimator {
  private action: CombatAction = 'idle'
  private ownership: 'clip' | 'procedural' = 'procedural'
  private elapsed = 0
  private actionTimeScale = 1
  private canceledAxePose = 0
  private canceledAxePoseRate = 1
  private canceledAxeVisual: unknown
  private shieldGuardEnabled = false
  private shieldRaised = false
  private lanceEquipped = false
  private locomotion: 'idle' | 'walk' | 'run' | 'mounted' = 'idle'
  private mountKind: MountedPoseKind = 'HORSE'
  private locomotionTimeScale = 1
  /** Last update's camera distance, so explicit draw/throw samples share the far cadence. */
  private cameraDistance = 0
  /** Imported-clip fists: contact times and recent palm positions (clip seconds), never seeking the live mixer. */
  private punchTiming: HumanoidPunchTiming | undefined
  private punchNext = 0
  private punchSamples: { time: number; left: THREE.Vector3; right: THREE.Vector3 }[] = []
  private readonly events: CombatAnimationEvents = {
    hitActiveStarted: false,
    projectileRelease: false,
    actionCompleted: false,
    fists: [],
  }

  constructor(
    private readonly rig: CharacterRig,
    private readonly meleePivot: THREE.Group,
    private readonly bowPivot: THREE.Group,
  ) {
    this.ownsAxeContact = !!rig.right.handSocket.userData.articulatedAxeContact
    if (this.ownsAxeContact) rig.animation?.setEquipmentState?.({ prepareAxeAttachment: this.prepareAxeAttachment })
    this.poseIdle()
  }

  get currentAction(): CombatAction { return this.action }
  /** True while an authored punch clip (not the procedural fallback) drives the fists. */
  get isPunchClip(): boolean { return this.punchTiming !== undefined && this.ownership === 'clip' && (this.action === 'punchCombo' || this.action === 'punchRight') }
  private get meleeTiming() { return this.rig.animation?.getMeleeTiming?.(this.action as HumanoidAnimationState) }
  private poseTime(elapsed: number): number {
    const timing = this.meleeTiming
    return timing ? elapsed * .48 / timing.duration : elapsed
  }
  private get isMeleeAction(): boolean {
    return this.action !== 'idle' && this.action !== 'bowAim' && this.action !== 'bowRelease' && this.action !== 'pilumThrow'
  }
  get meleeHitActive(): boolean {
    if (!this.isMeleeAction) return false
    const p = COMBAT_ANIMATION_PROFILES[this.action]
    const timing = this.meleeTiming
    return this.elapsed >= (timing?.activeStart ?? p.windup) && this.elapsed <= (timing?.activeEnd ?? p.windup + p.active)
  }
  get currentOwnership(): 'clip' | 'procedural' { return this.ownership }
  get busy(): boolean { return this.action !== 'idle' && this.action !== 'bowAim' }
  private readonly ownsAxeContact: boolean
  private readonly axeHandMatrix = new THREE.Matrix4()
  private readonly axeHandFrame = { center: new THREE.Vector3(), rotation: new THREE.Quaternion() }

  private readonly prepareAxeAttachment = (state: EquipmentPoseState): void => {
    setSwordMountedAttachment(this.meleePivot, state.mounted, state.mounted ? axeCarryWeight(state.action, state.elapsed) : 0,
      this.usesTwoHandedAxeCarry, state.action, axeCarryWeight(state.action, state.elapsed), !!state.continuousAxeAction,
      axeRecoveryWeight(state.action, state.elapsed, !!state.continuousAxeAction))
    const axeVisual = (this.meleePivot.userData.swordAttachmentOwned ? this.meleePivot.userData.axeVisual : undefined) as THREE.Object3D | undefined
    if (axeVisual) {
      // Read the actual attachment after carry selection, rather than assuming
      // the foot axe rotation also describes mounted carry and other weapons.
      this.axeHandMatrix.identity()
      for (let node: THREE.Object3D | null = axeVisual; node && node !== this.rig.right.handSocket; node = node.parent) {
        node.updateMatrix()
        this.axeHandMatrix.premultiply(node.matrix)
      }
      this.rig.right.handSocket.updateMatrix()
      this.axeHandMatrix.premultiply(this.rig.right.handSocket.matrix)
      this.axeHandFrame.rotation.setFromRotationMatrix(this.axeHandMatrix)
      this.axeHandFrame.center.setFromMatrixPosition(this.axeHandMatrix)
    }
    state.axeHandFrame = axeVisual ? this.axeHandFrame : undefined
    state.axeGripProfile = axeVisual?.parent?.userData.meleeWeaponId
  }

  get isLanceThrustActive(): boolean {
    if (this.action !== 'lanceThrust' && this.action !== 'mountedLance') return false
    const profile = COMBAT_ANIMATION_PROFILES[this.action]
    return this.elapsed >= profile.windup && this.elapsed <= (profile.windup + profile.active)
  }

  setShieldGuard(enabled: boolean): void {
    this.shieldGuardEnabled = enabled
    this.rig.animation?.setEquipmentState?.({ shield: enabled })
  }

  setShieldRaised(raised: boolean): void {
    this.shieldRaised = raised
    this.rig.animation?.setEquipmentState?.({ shieldRaised: raised })
  }

  private get hasEquippedSword(): boolean {
    return this.meleePivot.visible && this.meleePivot.userData.swordAttachmentOwned === true && this.meleePivot.userData.meleeAnimationKind === 'sword'
  }

  setEquipment(lance: boolean, shield: boolean, mountKind: MountedPoseKind = 'HORSE', alive = true): void {
    this.mountKind = mountKind
    this.lanceEquipped = lance
    this.setShieldGuard(shield)
    if (!alive || !this.hasCanceledAxePose) this.clearCanceledAxePose()
    this.rig.animation?.setEquipmentState?.({ lance, shield, mountKind, alive, actualSword: this.hasEquippedSword, swordGripSections: this.hasEquippedSword ? this.meleePivot.userData.weaponGripSections : undefined })
  }

  private get usesTwoHandedAxeCarry(): boolean {
    return !!this.meleePivot.userData.swordAttachmentOwned && !!this.meleePivot.userData.axeVisual && !this.shieldGuardEnabled && !!this.rig.animation?.has('axeMountedIdle')
  }

  private get usesContinuousAxeCarry(): boolean {
    return this.action === 'axeAttack2H' && this.meleeTiming?.attackFadeInSeconds !== undefined
  }

  private get hasCanceledAxePose(): boolean {
    return this.canceledAxePose > 0 && this.meleePivot.visible && this.meleePivot.userData.meleeAnimationKind === 'axe'
      && !this.shieldGuardEnabled && !this.lanceEquipped
      && this.canceledAxeVisual === this.meleePivot.userData.axeVisual
  }

  private clearCanceledAxePose(): void {
    this.canceledAxePose = 0
    this.canceledAxeVisual = undefined
  }

  private get locomotionClip(): HumanoidAnimationState {
    if (this.locomotion === 'mounted' && this.mountKind === 'xongkoro') return 'idle'
    return this.locomotion === 'mounted' && this.usesTwoHandedAxeCarry ? 'axeMountedIdle' : this.locomotion
  }

  setLocomotion(speed: number, mounted = false, sprinting = false, options?: { fadeSeconds?: number }): void {
    const poseAction = this.hasCanceledAxePose ? 'axeAttack2H' : this.action
    const poseElapsed = this.hasCanceledAxePose ? this.canceledAxePose : this.poseTime(this.elapsed)
    const continuous = this.hasCanceledAxePose || this.usesContinuousAxeCarry
    setSwordMountedAttachment(this.meleePivot, mounted, mounted ? axeCarryWeight(poseAction, poseElapsed) : 0, this.usesTwoHandedAxeCarry, poseAction, axeCarryWeight(poseAction, poseElapsed), continuous, axeRecoveryWeight(poseAction, poseElapsed, continuous))
    const state = mounted ? 'mounted' : speed <= 0.1 ? 'idle' : sprinting ? 'run' : 'walk'
    const timeScale = state === 'walk'
      ? Math.min(2, Math.max(0.1, speed / 2))
      : state === 'run'
        ? Math.min(2.2, Math.max(0.1, speed / 4))
        : 1
    this.locomotion = state
    this.locomotionTimeScale = timeScale
    this.rig.animation?.setEquipmentState?.({ mounted, moving: speed > 0.1, flightLean: mounted && this.mountKind === 'xongkoro' && sprinting ? 1 : 0 })
    if (this.busy && this.action !== 'bowRelease' && this.action !== 'lanceThrust' && this.action !== 'mountedLance') return
    if (this.action === 'bowAim' || this.action === 'bowRelease') {
      this.rig.animation?.setBowLocomotion?.(state === 'mounted' ? 'idle' : state, timeScale)
      return
    }
    const fadeSeconds = options?.fadeSeconds ?? 0.14
    this.rig.animation?.play(this.locomotionClip, { fadeSeconds, loop: true, timeScale })
  }

  sampleInitialPose(): void {
    this.rig.animation?.sampleInitialPose?.()
  }

  start(action: Exclude<CombatAction, 'idle' | 'bowAim'>, timeScale = 1): boolean {
    if (this.busy || (this.shieldGuardEnabled && (action === 'bowRelease' || action === 'greatswordSlash' || action === 'axeAttack2H'))) return false
    this.clearCanceledAxePose()
    this.action = action
    this.actionTimeScale = timeScale
    delete this.meleePivot.userData.continuousAxeCarryHeading
    setSwordMountedAttachment(this.meleePivot, this.locomotion === 'mounted', this.locomotion === 'mounted' ? axeCarryWeight(action, 0) : 0, this.usesTwoHandedAxeCarry, this.action, 1, this.usesContinuousAxeCarry)
    const importedState = action === 'bowRelease' || action === 'swordSlash' || action === 'pilumThrow' || action === 'axeAttack1H' || action === 'axeAttack2H'
      ? action
      : null
    const punchTiming = action === 'punchCombo' || action === 'punchRight' ? this.rig.animation?.getPunchTiming?.(action as HumanoidAnimationState) : undefined
    this.punchTiming = punchTiming && this.rig.animation?.has(action as HumanoidAnimationState) ? punchTiming : undefined
    this.punchNext = 0
    this.punchSamples = []
    this.ownership = importedState && this.rig.animation?.has(importedState) || this.punchTiming ? 'clip' : 'procedural'
    this.elapsed = 0
    const timing = this.meleeTiming
    const clipTimeScale = timeScale * (timing?.clipTimeScale ?? 1)
    // Some trimmed 2H takes must finish blending before their quaternion seam.
    // Keep that phase fixed at higher attack speeds without changing the clock.
    const attackFade = action === 'axeAttack2H' ? timing?.attackFadeInSeconds : undefined
    const fadeSeconds = attackFade !== undefined && Number.isFinite(timeScale) && timeScale > 0 ? attackFade / timeScale : .1
    const clipState = action === 'axeAttack1H' && this.meleePivot.userData.swordAttachmentOwned && this.meleePivot.userData.meleeAnimationKind === 'axe' && this.locomotion !== 'mounted' && this.rig.animation?.has('axeAttack1HFoot') ? 'axeAttack1HFoot' : action
    if (this.ownership === 'clip') this.rig.animation?.play(clipState, { fadeSeconds: this.punchTiming ? .06 : fadeSeconds, loop: false, ...(clipTimeScale === 1 ? {} : { timeScale: clipTimeScale }) })
    if (this.punchTiming) {
      this.rig.animation?.setEquipmentState?.({ punchClip: true, action, elapsed: 0 })
      this.rig.animation?.update(0)
      this.recordPunchSample(0)
    }
    return true
  }

  cancel(): void {
    const poseElapsed = this.poseTime(this.elapsed)
    if (!this.hasCanceledAxePose && this.usesContinuousAxeCarry && this.meleePivot.userData.authoredAxeSocket
      && this.meleePivot.userData.axeVisual && poseElapsed >= .42 && poseElapsed < .48 && this.actionTimeScale > 0) {
      // Gameplay cancels now. Let only the already-started visual release
      // finish, rather than dropping its torso and attachment offsets at once.
      this.canceledAxePose = poseElapsed
      this.canceledAxePoseRate = this.actionTimeScale * .48 / this.meleeTiming!.duration
      this.canceledAxeVisual = this.meleePivot.userData.axeVisual
    }
    if (!this.hasCanceledAxePose) this.clearCanceledAxePose()
    this.punchTiming = undefined
    this.rig.animation?.setEquipmentState?.({ punchClip: false })
    this.action = 'idle'
    this.ownership = 'procedural'
    this.elapsed = 0
    this.actionTimeScale = 1
    if (!this.hasCanceledAxePose) setSwordMountedAttachment(this.meleePivot, this.locomotion === 'mounted', this.locomotion === 'mounted' ? 1 : 0, this.usesTwoHandedAxeCarry, this.action, axeCarryWeight(this.action, this.poseTime(this.elapsed)))
    this.rig.animation?.setEquipmentState?.({ action: this.hasCanceledAxePose ? 'axeAttack2H' : 'idle', elapsed: this.hasCanceledAxePose ? this.canceledAxePose : 0 })
    this.rig.animation?.play(this.locomotionClip, { fadeSeconds: 0.12, loop: true, timeScale: this.locomotionTimeScale })
    this.poseIdle()
  }

  update(dt: number, cameraDistance = 0): CombatAnimationEvents {
    this.events.hitActiveStarted = false
    this.events.projectileRelease = false
    this.events.actionCompleted = false
    this.events.fists.length = 0

    if (!Number.isFinite(dt) || dt < 0) return this.events
    this.cameraDistance = cameraDistance
    const actionDt = dt * this.actionTimeScale
    const mounted = this.locomotion === 'mounted'
    const canceledPose = this.hasCanceledAxePose
    if (!canceledPose) this.clearCanceledAxePose()
    else this.canceledAxePose = Math.min(.48, this.canceledAxePose + dt * this.canceledAxePoseRate)
    const poseAction = canceledPose ? 'axeAttack2H' : this.action
    const poseElapsed = canceledPose ? this.canceledAxePose : this.poseTime(this.elapsed + actionDt)
    const continuous = canceledPose || this.usesContinuousAxeCarry
    setSwordMountedAttachment(this.meleePivot, mounted, mounted ? axeCarryWeight(poseAction, poseElapsed) : 0, this.usesTwoHandedAxeCarry, poseAction, axeCarryWeight(poseAction, poseElapsed), continuous, axeRecoveryWeight(poseAction, poseElapsed, continuous))
    if (this.rig.mittenHands) this.rig.animation?.setEquipmentState?.({
      rightGrip: this.lanceEquipped || this.action === 'pilumThrow' || holdsVisibleMesh(this.meleePivot),
      leftGrip: holdsVisibleMesh(this.bowPivot),
    })
    this.rig.animation?.setEquipmentState?.({ punchClip: this.isPunchClip, action: poseAction, elapsed: poseElapsed, continuousAxeAction: continuous, lance: this.lanceEquipped, actualSword: this.hasEquippedSword, swordGripSections: this.hasEquippedSword ? this.meleePivot.userData.weaponGripSections : undefined, carryWeapon: this.meleePivot.visible && this.meleePivot.userData.swordAttachmentOwned ? this.meleePivot.userData.axeVisual ? 'axe' : 'sword' : undefined })
    // Melee sockets drive physical collision, so their pose must follow the
    // action clock every frame, including fast T4 attacks. Idle/ranged may throttle.
    if (this.isPunchClip) this.advancePunchClip(dt, actionDt)
    else this.rig.animation?.update(dt, this.isMeleeAction || canceledPose ? 0 : cameraDistance)
    // Animated sockets and forward axe carry follow the evaluated pose and
    // LOD proxy, before this tick's hit/contact evaluation.
    if (!(this.ownsAxeContact && this.meleePivot.userData.axeVisual) && (this.meleePivot.userData.authoredAxeSocket || this.meleePivot.userData.authoredAxe1Socket || this.meleePivot.userData.forwardAxeCarryRoot)) setSwordMountedAttachment(this.meleePivot, mounted,
      mounted ? axeCarryWeight(poseAction, poseElapsed) : 0, this.usesTwoHandedAxeCarry, poseAction, axeCarryWeight(poseAction, poseElapsed), continuous, axeRecoveryWeight(poseAction, poseElapsed, continuous))
    if (canceledPose && this.canceledAxePose >= .48) {
      this.clearCanceledAxePose()
      setSwordMountedAttachment(this.meleePivot, mounted, mounted ? 1 : 0, this.usesTwoHandedAxeCarry)
      this.rig.animation?.setEquipmentState?.({ action: 'idle', elapsed: 0, continuousAxeAction: false })
      this.rig.animation?.update(0, cameraDistance)
    }

    if (this.action === 'idle' || this.action === 'bowAim') {
      return this.events
    }

    const profile = COMBAT_ANIMATION_PROFILES[this.action]
    const previous = this.elapsed
    this.elapsed += actionDt
    if (!this.isPunchClip && (this.action === 'punchCombo' || this.action === 'punchRight')) {
      const shield = this.action === 'punchRight'
      for (const event of punchEventsBetween(previous, this.elapsed, shield)) {
        const from = new THREE.Vector3(), to = new THREE.Vector3()
        this.sampleFist(event.time - .10, event.hand, from)
        this.sampleFist(event.time, event.hand, to)
        this.events.fists.push({ from, to })
      }
      this.sampleFist(Math.min(this.elapsed, UNARMED_DURATION), 'right', new THREE.Vector3())
    }
    const importedPilumDuration = this.action === 'pilumThrow' && this.ownership === 'clip'
      ? this.rig.animation?.getDuration('pilumThrow')
      : undefined
    const total = Math.round((this.meleeTiming?.duration ?? (this.isPunchClip ? this.punchTiming!.duration : undefined) ?? importedPilumDuration ?? (profile.windup + profile.active + profile.recovery)) * 1e9) / 1e9

    if (this.action === 'bowRelease' || this.action === 'pilumThrow') {
      const pilumReleaseTime = (this.ownership === 'clip' ? PILUM_THROW_RELEASE_TIME : profile.windup) - 1e-9
      const releasingPilum = this.action === 'pilumThrow'
        && previous < pilumReleaseTime && this.elapsed >= pilumReleaseTime
      const releasingBow = this.action === 'bowRelease' && previous < profile.windup && this.elapsed >= profile.windup
      if (releasingPilum || releasingBow) {
        this.events.projectileRelease = true
      }
      if (this.ownership === 'procedural') {
        if (this.action === 'bowRelease') this.poseBowRelease(clamp01(this.elapsed / total))
        else this.posePilumFrame(clamp01(this.elapsed / total))
      }
    } else {
      const isLance = this.action === 'lanceThrust' || this.action === 'mountedLance'
      const contactTime = this.meleeTiming?.hit ?? (this.action === 'axeAttack1H' || this.action === 'axeAttack2H'
        ? AXE_HIT_TIMES[this.action]
        : Math.round((profile.windup + profile.active * (isLance ? 0.9 : 0.8)) * 1e9) / 1e9)
      if (previous < contactTime && this.elapsed >= contactTime) {
        this.events.hitActiveStarted = true
      }
      if (this.ownership === 'procedural' && this.action !== 'punchCombo' && this.action !== 'punchRight') this.poseMelee(this.action, this.elapsed, profile)
    }

    if (this.elapsed >= total - 1e-9) {
      const returnToLocomotion = this.isPunchClip || ((this.action === 'swordSlash' || this.action === 'axeAttack1H' || this.action === 'axeAttack2H') && this.ownership === 'clip') || this.lanceEquipped
      this.action = 'idle'
      this.ownership = 'procedural'
      this.elapsed = 0
      this.actionTimeScale = 1
      setSwordMountedAttachment(this.meleePivot, this.locomotion === 'mounted', this.locomotion === 'mounted' ? 1 : 0, this.usesTwoHandedAxeCarry, this.action, axeCarryWeight(this.action, this.poseTime(this.elapsed)))
      this.events.actionCompleted = true
      this.punchTiming = undefined
      this.rig.animation?.setEquipmentState?.({ punchClip: false })
      if (returnToLocomotion) {
        this.resetWeaponPivots()
        this.rig.animation?.play(this.locomotionClip, { fadeSeconds: 0.12, loop: true, timeScale: this.locomotionTimeScale })
      } else this.poseIdle()
      this.rig.animation?.setEquipmentState?.({ action: 'idle', elapsed: 0 })
      this.rig.animation?.update(0, cameraDistance)
    }
    return this.events
  }

  poseIdle(): void {
    this.action = 'idle'
    this.actionTimeScale = 1
    this.ownership = 'procedural'
    this.rig.animation?.setEquipmentState?.({ action: this.hasCanceledAxePose ? 'axeAttack2H' : 'idle', elapsed: this.hasCanceledAxePose ? this.canceledAxePose : 0 })
    this.rig.animation?.play(this.locomotionClip, { fadeSeconds: 0.12, loop: true, timeScale: this.locomotionTimeScale })
    if (this.rig.animation?.has('idle')) {
      this.resetWeaponPivots()
      return
    }
    const { right, left } = this.rig
    setRigRotation(right.shoulder, 0, 0, -0.12)
    setRigRotation(right.elbow, 0.15, 0, 0)
    setRigRotation(right.wrist, 0, 0, 0)
    setRigRotation(left.shoulder, 0, 0, 0.12)
    setRigRotation(left.elbow, 0.15, 0, 0)
    setRigRotation(left.wrist, 0, 0, 0)
    this.applyShieldGuard()
    this.resetWeaponPivots()
    // Static model-to-grip alignment lives below this action pivot.
    // The elbow contributes ~0.15 rad, so this action pitch makes the blade's
    // model axis level instead of leaving the tip angled into the ground.
    this.meleePivot.rotation.set(IDLE_BLADE_PITCH, 0, 0)
  }

  private recordPunchSample(time: number): void {
    let sample = this.punchSamples.length > 24 ? this.punchSamples.shift()! : undefined
    sample ??= { time, left: new THREE.Vector3(), right: new THREE.Vector3() }
    sample.time = time
    this.fistWorld('left', sample.left)
    this.fistWorld('right', sample.right)
    this.punchSamples.push(sample)
  }

  /** Palm position at clip time `time`, interpolated between recorded sub-steps. */
  private punchPalmAt(time: number, hand: PunchHand, out: THREE.Vector3): THREE.Vector3 {
    const samples = this.punchSamples
    if (time <= samples[0].time) return out.copy(samples[0][hand])
    for (let i = samples.length - 1; i > 0; i--) {
      const a = samples[i - 1], b = samples[i]
      if (time >= a.time) return out.lerpVectors(a[hand], b[hand], b.time > a.time ? THREE.MathUtils.clamp((time - a.time) / (b.time - a.time), 0, 1) : 1)
    }
    return out.copy(samples[samples.length - 1][hand])
  }

  /** Advance the authored clip in <=1/60 s sub-steps so a hitch can never skip a contact; one strike per punch. */
  private advancePunchClip(dt: number, actionDt: number): void {
    const timing = this.punchTiming!
    const steps = THREE.MathUtils.clamp(Math.ceil(dt * 60 - 1e-6), 1, 16)
    for (let step = 1; step <= steps; step++) {
      this.rig.animation?.update(dt / steps, 0)
      const time = Math.min(timing.duration, this.elapsed + actionDt * step / steps)
      this.recordPunchSample(time)
      while (this.punchNext < timing.contacts.length && timing.contacts[this.punchNext].time <= time + 1e-9) {
        const { time: contact, hand } = timing.contacts[this.punchNext++]
        const from = new THREE.Vector3(), to = new THREE.Vector3()
        this.punchPalmAt(contact - .10, hand, from)
        this.punchPalmAt(contact, hand, to)
        this.events.fists.push({ from, to })
      }
    }
  }

  private sampleFist(elapsed: number, hand: PunchHand, out: THREE.Vector3): void {
    this.rig.animation?.setEquipmentState?.({ action: this.action, elapsed })
    this.rig.animation?.update(0)
    if (!this.rig.animation?.setEquipmentState) {
      for (const side of ['right', 'left'] as const) {
        if (this.action === 'punchRight' && side === 'left') continue
        const extension = punchExtension(elapsed, side, this.action === 'punchRight')
        setRigRotation(this.rig[side].shoulder, 1.1 + .3 * extension, 0, side === 'right' ? -.2 : .2)
        setRigRotation(this.rig[side].elbow, 1.4 * (1 - extension), 0, 0)
      }
      this.applyShieldGuard()
    }
    this.fistWorld(hand, out)
  }

  /** The closed fist's centre (the grip contact), not the wrist socket 10 cm behind it. */
  private fistWorld(hand: PunchHand, out: THREE.Vector3): THREE.Vector3 {
    const frames = this.rig.equipmentGripFrames
    if (!frames) return this.rig[hand].handSocket.getWorldPosition(out)
    const wrist = this.rig[hand].wrist
    wrist.updateWorldMatrix(true, false)
    return wrist.localToWorld(out.fromArray(hand === 'right' ? frames.lanceRight.gripCenterLocal : frames.lanceLeft.gripCenterLocal))
  }

  poseBow(chargeRatio: number, aimBlend = 1): void {
    if (this.busy || this.shieldGuardEnabled) return
    this.clearCanceledAxePose()
    this.rig.animation?.setEquipmentState?.({ action: 'bowAim' })
    this.action = 'bowAim'
    const imported = this.rig.animation?.has('bowLoad') && this.rig.animation.has('bowHold')
    this.ownership = imported ? 'clip' : 'procedural'
    if (imported) {
      if (chargeRatio >= 1) this.rig.animation!.play('bowHold', { fadeSeconds: 0.08, loop: true })
      else this.rig.animation!.seek('bowLoad', chargeRatio, this.cameraDistance)
      return
    }
    this.applyBowPose(chargeRatio, aimBlend)
  }

  private applyBowPose(chargeRatio: number, aimBlend: number): void {
    const aim = ease(aimBlend)
    const draw = ease(chargeRatio) * aim
    const { right, left } = this.rig

    // Positive X rotates a hanging arm toward local -Z, the character's forward axis.
    // The bow arm stays outside the left shoulder instead of folding across the
    // torso. This keeps the bow, string, and nocked arrow visibly clear of the body.
    // Keep the grip low enough that a vertical longbow's upper tip sits near
    // the forehead instead of extending above the helmet.
    setRigRotation(left.shoulder, 1.2 * aim, -0.1 * aim, 0.12 - 0.22 * aim)
    setRigRotation(left.elbow, 0.15 + 0.15 * aim, 0, 0.05 * aim)
    setRigRotation(left.wrist, -0.15 * aim, 0, 0.04 * aim)

    // Start near the nock, then draw the right hand back and upward to the cheek.
    // The progressively negative Z rotation crosses the arm in front of the chest
    // without leaving the hand (and the draw trajectory) buried inside the torso.
    setRigRotation(right.shoulder, 1.45 * aim, 0, -0.12 - 0.68 * aim - 0.6 * draw)
    setRigRotation(right.elbow, 0.15 + 0.15 * aim + 0.5 * draw, 0, 0.12 * draw)
    setRigRotation(right.wrist, -0.1 * draw, 0.08 * draw, 0)
    if (!this.rig.handGripFrames?.left) this.bowPivot.rotation.set(0, 0, -0.1)
  }

  poseMountedLanceReady(): void {
    this.poseLanceReady(true)
  }

  poseLanceReady(mounted: boolean): void {
    this.lanceEquipped = true
    this.rig.animation?.setEquipmentState?.({ lance: true, mounted })
    // Releasing RMB can return here from bowAim, including a fresh aim frame
    // after a shot. End that state before the imported-rig early return so
    // locomotion fades out the bow clip and its equipment pose compensation.
    if (this.action === 'bowAim') this.cancel()
    if (this.rig.equipmentGripFrames || this.busy) return
    const { right, left } = this.rig
    setRigRotation(right.shoulder, mounted ? 1.25 : 1.08, 0.08, -0.32)
    setRigRotation(right.elbow, mounted ? 0.15 : 0.38, 0, 0.12)
    setRigRotation(right.wrist, 0, 0, 0)
    if (mounted) {
      setRigRotation(left.shoulder, 0, 0, 0.12)
      setRigRotation(left.elbow, 0.15, 0, 0)
      setRigRotation(left.wrist, 0, 0, 0)
      this.applyShieldGuard()
    } else {
      setRigRotation(left.shoulder, 1.02, -0.12, 0.42)
      setRigRotation(left.elbow, 0.48, 0, -0.15)
      setRigRotation(left.wrist, 0, -0.18, 0)
    }
    this.meleePivot.rotation.set(0, 0, 0)
    this.meleePivot.position.set(0, -0.08, 0)
  }

  posePilum(progress: number): void {
    if (this.busy) return
    if (this.rig.animation?.has('pilumThrow')) {
      this.rig.animation.seek('pilumThrow', progress, this.cameraDistance)
      return
    }
    this.posePilumFrame(progress)
  }

  private posePilumFrame(progress: number): void {
    const t = ease(progress)
    const { right, left } = this.rig
    setRigRotation(right.shoulder, THREE.MathUtils.lerp(-0.25, -1.4, t), 0.2 * t, -0.12)
    setRigRotation(right.elbow, THREE.MathUtils.lerp(-0.15, -0.8, t), 0, 0.25 * t)
    setRigRotation(right.wrist, -0.25 * t, 0, 0)
    setRigRotation(left.shoulder, -0.25 * t, 0, 0.12)
    setRigRotation(left.elbow, -0.15, 0, 0)
    this.bowPivot.rotation.set(THREE.MathUtils.lerp(-Math.PI / 2, -0.35, t), 0, 0)
  }

  private poseBowRelease(progress: number): void {
    const snap = 1 - ease(progress)
    this.applyBowPose(snap, 1)
  }

  private resetWeaponPivots(): void {
    if (!this.meleePivot.userData.swordAttachmentOwned && !this.meleePivot.userData.equipmentAttachmentOwned) {
      this.meleePivot.position.set(0, 0, 0)
      this.meleePivot.rotation.set(IDLE_BLADE_PITCH, 0, 0)
    }
    // Modern equipment owns its authored attachment; animation never resets it.
    if (!this.rig.animation && !this.rig.handGripFrames?.left) {
      this.bowPivot.position.set(0, 0, 0)
      this.bowPivot.rotation.set(0, 0, 0)
    }
  }

  private poseMelee(action: CombatAction, elapsed: number, profile: CombatAnimationProfile): void {
    const windupEnd = profile.windup
    const activeEnd = windupEnd + profile.active
    let phase: 'windup' | 'active' | 'recovery'
    let t: number
    if (elapsed < windupEnd) {
      phase = 'windup'
      t = ease(elapsed / Math.max(0.001, profile.windup))
    } else if (elapsed < activeEnd) {
      phase = 'active'
      t = ease((elapsed - windupEnd) / Math.max(0.001, profile.active))
    } else {
      phase = 'recovery'
      t = ease((elapsed - activeEnd) / Math.max(0.001, profile.recovery))
    }

    if (action === 'lanceThrust' || action === 'mountedLance') {
      if (!this.rig.equipmentGripFrames) this.poseLance(action === 'mountedLance', phase, t)
    } else {
      this.poseBladeThrust(action, phase, t)
    }
  }

  private poseBladeThrust(action: CombatAction, phase: 'windup' | 'active' | 'recovery', t: number): void {
    const great = action === 'greatswordSlash'
    const dagger = action === 'daggerSlash'
    const { right, left } = this.rig

    const readyShoulderX = great ? 0.78 : dagger ? 0.92 : 0.86
    const strikeShoulderX = great ? 1.18 : dagger ? 1.12 : 1.24
    const readyShoulderZ = great ? -0.18 : dagger ? -0.3 : -0.24
    const strikeShoulderZ = great ? -0.08 : dagger ? -0.2 : -0.12
    // Shoulder + elbow stays near PI / 2, so the forearm and blade remain
    // horizontal while the arm extends instead of pitching toward the ground.
    const readyElbowX = Math.PI / 2 - readyShoulderX
    const strikeElbowX = Math.PI / 2 - strikeShoulderX
    const thrustDistance = great ? 0.42 : dagger ? 0.24 : 0.36
    const drawBackDistance = great ? 0.08 : 0.05

    let shoulderX: number
    let shoulderY: number
    let shoulderZ: number
    let elbowX: number
    let weaponPitch: number
    let weaponOffset: number

    if (phase === 'windup') {
      shoulderX = THREE.MathUtils.lerp(0, readyShoulderX, t)
      shoulderY = 0
      shoulderZ = THREE.MathUtils.lerp(-0.12, readyShoulderZ, t)
      elbowX = THREE.MathUtils.lerp(0.15, readyElbowX, t)
      weaponPitch = THREE.MathUtils.lerp(IDLE_BLADE_PITCH, 0, t)
      weaponOffset = THREE.MathUtils.lerp(0, drawBackDistance, t)
    } else if (phase === 'active') {
      shoulderX = THREE.MathUtils.lerp(readyShoulderX, strikeShoulderX, t)
      shoulderY = 0
      shoulderZ = THREE.MathUtils.lerp(readyShoulderZ, strikeShoulderZ, t)
      elbowX = THREE.MathUtils.lerp(readyElbowX, strikeElbowX, t)
      weaponPitch = 0
      weaponOffset = THREE.MathUtils.lerp(drawBackDistance, -thrustDistance, t)
    } else {
      // Pull the blade straight back before rotating it upright. Keeping the
      // pitch fixed during the first leg prevents recovery from drawing a
      // second diagonal cut through the character.
      const retract = clamp01(t / 0.58)
      const returnToIdle = clamp01((t - 0.58) / 0.42)
      if (t < 0.58) {
        shoulderX = THREE.MathUtils.lerp(strikeShoulderX, readyShoulderX, retract)
        shoulderY = 0
        shoulderZ = THREE.MathUtils.lerp(strikeShoulderZ, readyShoulderZ, retract)
        elbowX = THREE.MathUtils.lerp(strikeElbowX, readyElbowX, retract)
        weaponPitch = 0
        weaponOffset = THREE.MathUtils.lerp(-thrustDistance, drawBackDistance, retract)
      } else {
        shoulderX = THREE.MathUtils.lerp(readyShoulderX, 0, returnToIdle)
        shoulderY = 0
        shoulderZ = THREE.MathUtils.lerp(readyShoulderZ, -0.12, returnToIdle)
        elbowX = THREE.MathUtils.lerp(readyElbowX, 0.15, returnToIdle)
        weaponPitch = THREE.MathUtils.lerp(0, IDLE_BLADE_PITCH, returnToIdle)
        weaponOffset = THREE.MathUtils.lerp(drawBackDistance, 0, returnToIdle)
      }
    }

    setRigRotation(right.shoulder, shoulderX, shoulderY, shoulderZ)
    setRigRotation(right.elbow, elbowX, 0, 0)
    setRigRotation(right.wrist, 0, 0, 0)

    if (great) {
      // The off hand follows the same extend/retract rhythm for a stable
      // two-handed heavy thrust. The shield remains on the back for this mode.
      const leftShoulderX = Math.max(0, shoulderX - 0.08)
      setRigRotation(left.shoulder, leftShoulderX, -0.1, 0.28)
      setRigRotation(left.elbow, Math.max(0.15, elbowX - 0.08), 0.08, -0.08)
      setRigRotation(left.wrist, 0, -0.12, 0)
    } else {
      setRigRotation(left.shoulder, 0, 0, 0.12)
      setRigRotation(left.elbow, 0.15, 0, 0)
      setRigRotation(left.wrist, 0, 0, 0)
      this.applyShieldGuard()
    }

    this.meleePivot.rotation.set(weaponPitch, 0, 0)
    // Once the arm is raised, local -Y is character-forward. Sliding the
    // action pivot along that axis makes the blade tip travel almost linearly.
    this.meleePivot.position.set(0, weaponOffset, 0)
  }

  private poseLance(mounted: boolean, phase: 'windup' | 'active' | 'recovery', t: number): void {
    const thrust = phase === 'windup' ? 0 : phase === 'active' ? t : 1 - t
    const drawBack = phase === 'windup' ? t : phase === 'active' ? 1 - t : 0
    const { right, left } = this.rig

    const readyShoulder = mounted ? 1.25 : 1.08
    const readyElbow = mounted ? 0.15 : 0.38
    setRigRotation(right.shoulder, readyShoulder - drawBack * 0.18 + thrust * 0.18, 0.08, -0.3)
    setRigRotation(right.elbow, readyElbow + drawBack * 0.24 - thrust * 0.22, 0, 0.12)
    setRigRotation(right.wrist, 0, 0, 0)

    if (mounted) {
      setRigRotation(left.shoulder, 0, 0, 0.12)
      setRigRotation(left.elbow, 0.15, 0, 0)
      setRigRotation(left.wrist, 0, 0, 0)
      this.applyShieldGuard()
    } else {
      setRigRotation(left.shoulder, 0.82 - drawBack * 0.18 + thrust * 0.12, -0.12, 0.42)
      setRigRotation(left.elbow, 0.9 - thrust * 0.3, 0, -0.15)
      setRigRotation(left.wrist, 0, -0.18, 0)
    }

    this.meleePivot.rotation.set(0, 0, 0)
    // The lance grip maps mesh +Y onto action-local -Y. Move along that same
    // axis so the attack is a true forward thrust instead of a sideways slide.
    this.meleePivot.position.set(0, -0.08 - thrust * 0.48 + drawBack * 0.22, 0)
  }

  /** Raises the shield hand to the torso and extends it along character-forward (-Z). */
  private applyShieldGuard(): void {
    if (!this.shieldGuardEnabled || !this.shieldRaised || this.busy) return
    const { left } = this.rig
    setRigRotation(left.shoulder, 1.05, -0.05, 0.1)
    setRigRotation(left.elbow, 0.45, 0, -0.04)
    setRigRotation(left.wrist, -0.08, 0, 0.04)
  }
}
