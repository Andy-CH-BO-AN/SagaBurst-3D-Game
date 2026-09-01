import * as THREE from 'three'
import type { CharacterRig } from './CharacterVisuals'
import { setRigRotation } from './CharacterVisuals'

export type CombatAction =
  | 'idle'
  | 'daggerSlash'
  | 'swordSlash'
  | 'greatswordSlash'
  | 'bowAim'
  | 'bowRelease'
  | 'lanceThrust'
  | 'mountedLance'

export interface CombatAnimationProfile {
  windup: number
  active: number
  recovery: number
}

export interface CombatAnimationEvents {
  hitActiveStarted: boolean
  projectileRelease: boolean
  actionCompleted: boolean
}

export const COMBAT_ANIMATION_PROFILES: Readonly<Record<CombatAction, CombatAnimationProfile>> = {
  idle: { windup: 0, active: 0, recovery: 0 },
  daggerSlash: { windup: 0.08, active: 0.10, recovery: 0.14 },
  swordSlash: { windup: 0.14, active: 0.14, recovery: 0.20 },
  greatswordSlash: { windup: 0.28, active: 0.18, recovery: 0.32 },
  bowAim: { windup: 0.18, active: 0, recovery: 0 },
  bowRelease: { windup: 0.04, active: 0, recovery: 0.18 },
  lanceThrust: { windup: 0.20, active: 0.20, recovery: 0.30 },
  mountedLance: { windup: 0.12, active: 0.12, recovery: 0.18 },
}

const clamp01 = (value: number): number => THREE.MathUtils.clamp(value, 0, 1)
const IDLE_BLADE_PITCH = 2.85
const ease = (value: number): number => {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

/** Shared allocation-free FK pose sampler used by Player and NPC combat. */
export class CharacterCombatAnimator {
  private action: CombatAction = 'idle'
  private elapsed = 0
  private shieldGuardEnabled = false
  private readonly events: CombatAnimationEvents = {
    hitActiveStarted: false,
    projectileRelease: false,
    actionCompleted: false,
  }

  constructor(
    private readonly rig: CharacterRig,
    private readonly meleePivot: THREE.Group,
    private readonly bowPivot: THREE.Group,
  ) {
    this.poseIdle()
  }

  get currentAction(): CombatAction { return this.action }
  get busy(): boolean { return this.action !== 'idle' && this.action !== 'bowAim' }

  setShieldGuard(enabled: boolean): void {
    this.shieldGuardEnabled = enabled
  }

  setLocomotion(speed: number, mounted = false): void {
    if (this.busy || this.action === 'bowAim') return
    const state = mounted ? 'mounted' : speed > 10 ? 'run' : speed > 0.1 ? 'walk' : 'idle'
    this.rig.animation?.play(state, 0.14, true)
  }

  start(action: Exclude<CombatAction, 'idle' | 'bowAim'>): boolean {
    if (this.busy) return false
    this.action = action
    this.elapsed = 0
    this.rig.animation?.play(action, 0.1, false)
    return true
  }

  cancel(): void {
    this.action = 'idle'
    this.elapsed = 0
    this.rig.animation?.play('idle', 0.12, true)
    this.poseIdle()
  }

  update(dt: number): CombatAnimationEvents {
    this.events.hitActiveStarted = false
    this.events.projectileRelease = false
    this.events.actionCompleted = false

    this.rig.animation?.update(dt)

    if (this.action === 'idle' || this.action === 'bowAim') return this.events

    const profile = COMBAT_ANIMATION_PROFILES[this.action]
    const previous = this.elapsed
    this.elapsed += dt
    const total = profile.windup + profile.active + profile.recovery

    if (this.action === 'bowRelease') {
      if (previous < profile.windup && this.elapsed >= profile.windup) {
        this.events.projectileRelease = true
      }
      this.poseBowRelease(clamp01(this.elapsed / total))
    } else {
      const isLance = this.action === 'lanceThrust' || this.action === 'mountedLance'
      const contactTime = profile.windup + profile.active * (isLance ? 0.9 : 0.8)
      if (previous < contactTime && this.elapsed >= contactTime) {
        this.events.hitActiveStarted = true
      }
      this.poseMelee(this.action, this.elapsed, profile)
    }

    if (this.elapsed >= total) {
      this.action = 'idle'
      this.elapsed = 0
      this.events.actionCompleted = true
      this.poseIdle()
    }
    return this.events
  }

  poseIdle(): void {
    this.action = 'idle'
    this.rig.animation?.play('idle', 0.12, true)
    const { right, left } = this.rig
    setRigRotation(right.shoulder, 0, 0, -0.12)
    setRigRotation(right.elbow, 0.15, 0, 0)
    setRigRotation(right.wrist, 0, 0, 0)
    setRigRotation(left.shoulder, 0, 0, 0.12)
    setRigRotation(left.elbow, 0.15, 0, 0)
    setRigRotation(left.wrist, 0, 0, 0)
    this.applyShieldGuard()
    this.meleePivot.position.set(0, 0, 0)
    // Static model-to-grip alignment lives below this action pivot.
    // The elbow contributes ~0.15 rad, so this action pitch makes the blade's
    // model axis level instead of leaving the tip angled into the ground.
    this.meleePivot.rotation.set(IDLE_BLADE_PITCH, 0, 0)
    this.bowPivot.position.set(0, 0, 0)
    this.bowPivot.rotation.set(0, 0, 0)
  }

  poseBow(chargeRatio: number, aimBlend = 1): void {
    if (this.busy) return
    this.action = 'bowAim'
    this.rig.animation?.play('bowAim', 0.12, true)
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
    this.bowPivot.rotation.set(0, 0, -0.1)
  }

  poseMountedLanceReady(): void {
    this.poseLanceReady(true)
  }

  poseLanceReady(mounted: boolean): void {
    if (this.busy) return
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
      this.poseLance(action === 'mountedLance', phase, t)
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
    this.meleePivot.position.set(0, -0.08 - thrust * 0.38 + drawBack * 0.18, 0)
  }

  /** Raises the shield hand to the torso and extends it along character-forward (-Z). */
  private applyShieldGuard(): void {
    if (!this.shieldGuardEnabled) return
    const { left } = this.rig
    setRigRotation(left.shoulder, 1.05, -0.05, 0.1)
    setRigRotation(left.elbow, 0.45, 0, -0.04)
    setRigRotation(left.wrist, -0.08, 0, 0.04)
  }
}
