import * as THREE from 'three'
import type { HumanoidCharacterInstance } from '../world/HumanoidAssetRegistry'
import { CharacterCombatAnimator, COMBAT_ANIMATION_PROFILES } from '../world/CharacterCombatAnimator'
import { CharacterBowVisual } from '../world/CharacterBowVisual'
import { WeaponMeshFactory } from '../world/WeaponMeshFactory'
import { Faction } from '../world/NPC'
import { applySwordAttachment } from '../world/SwordAttachmentContract'
import { applyBowAttachment } from '../world/BowAttachmentContract'
import { applyCharacterMountedPose, type HumanoidAnimationState } from '../world/CharacterVisuals'

/** Studio exercises the production animator and actual faction equipment. */
export class HumanoidStudioPlayback {
  readonly sword = new THREE.Group()
  readonly bow = new THREE.Group()
  readonly pilum = new THREE.Group()
  private readonly animator: CharacterCombatAnimator
  private readonly bowVisual: CharacterBowVisual
  private readonly target = new THREE.Vector3()
  private elapsed = 0
  private equipped = true
  private started = false

  constructor(readonly instance: HumanoidCharacterInstance, readonly state: HumanoidAnimationState, readonly faction: 'viking' | 'roman') {
    const grip = new THREE.Group()
    this.sword.add(grip)
    WeaponMeshFactory.buildNpcMelee(faction === 'roman' ? Faction.ENEMY : Faction.PLAYER, 2, false, grip)
    applySwordAttachment(instance.rig.right.handSocket, this.sword, grip, instance.rig.swordGripFrame!)
    instance.rig.right.handSocket.add(this.sword, this.pilum)
    WeaponMeshFactory.buildNpcRanged(Faction.ENEMY, 2, this.pilum)
    const bowGrip = new THREE.Group()
    this.bow.add(bowGrip)
    applyBowAttachment(instance.rig.left.handSocket, this.bow)
    instance.rig.left.handSocket.add(this.bow)
    this.bowVisual = new CharacterBowVisual(this.bow, bowGrip)
    this.bowVisual.rebuild('recurve_longbow')
    this.animator = new CharacterCombatAnimator(instance.rig, this.sword, state === 'pilumThrow' ? this.pilum : this.bow)
    this.reset()
  }

  /** Fixed-time, bow-only diagnostic. No production flags or legacy body. */
  sampleBowComparison(time: number, mode: 'current' | 'legacy' | 'raw' | 'gameplay', motion: 'idle' | 'walk' | 'run' = 'idle'): void {
    this.reset()
    const animation = this.instance.rig.animation!
    animation.setSwordHandShape?.(false)
    animation.setPoseLayersEnabled?.(mode === 'current' || mode === 'gameplay')
    const speed = motion === 'walk' ? 2 : motion === 'run' ? 4 : 0
    if (mode === 'gameplay') {
      // Exercise the same charge / locomotion / release ordering as Player/NPC.
      const ratio = this.state === 'bowLoad' ? time : 1
      for (let i = 0; i < 12; i++) {
        this.animator.poseBow(ratio)
        this.animator.setLocomotion(speed)
        this.animator.update(1 / 60)
      }
      if (this.state === 'bowRelease') {
        this.animator.start('bowRelease')
        const profile = COMBAT_ANIMATION_PROFILES.bowRelease
        const duration = (profile.windup + profile.active + profile.recovery) * time
        for (let elapsed = 0; elapsed < duration;) {
          const dt = Math.min(1 / 60, duration - elapsed)
          this.animator.setLocomotion(speed)
          this.animator.update(dt)
          elapsed += dt
        }
      }
    } else {
      animation.play(this.state, { fadeSeconds: 0, loop: false })
      animation.seek(this.state, time)
      if (mode === 'current') animation.setBowLocomotion?.(motion, 1)
      animation.update(0.001)
    }
    if (mode === 'legacy') {
      // Evaluate imported body first, then remove mixer ownership before sampling
      // only the six legacy bow arm joints through the existing fallback.
      const pose = new Map<THREE.Object3D, THREE.Quaternion>()
      this.instance.root.traverse(object => { if (object instanceof THREE.Bone) pose.set(object, object.quaternion.clone()) })
      animation.stop()
      for (const [bone, rotation] of pose) bone.quaternion.copy(rotation)
      this.animator.cancel()
      animation.stop()
      for (const [bone, rotation] of pose) bone.quaternion.copy(rotation)
      this.instance.rig.animation = undefined
      this.animator.poseBow(this.state === 'bowHold' ? 1 : this.state === 'bowRelease' ? 1 - time : time)
      this.instance.rig.animation = animation
      animation.update(0)
    }
    this.bow.visible = mode !== 'raw'
    this.sword.visible = this.pilum.visible = false
    this.instance.root.updateMatrixWorld(true)
    this.target.set(0, 1.4, 10).applyMatrix4(this.instance.root.matrixWorld)
    if (this.bow.visible) this.bowVisual.update(this.state === 'bowHold' ? 1 : this.state === 'bowRelease' ? 1 - time : time, this.target, !(this.state === 'bowRelease' && time >= 0.04 / 0.22))
    this.instance.root.updateMatrixWorld(true)
  }

  setEquipped(enabled: boolean): void { this.equipped = enabled; this.reset() }

  reset(): void {
    this.elapsed = 0
    this.started = false
    this.instance.rig.animation!.stop()
    this.animator.cancel()
    this.instance.rig.animation!.setPoseLayersEnabled?.(this.equipped)
    this.sword.visible = this.equipped && !this.state.startsWith('bow') && this.state !== 'pilumThrow'
    this.bow.visible = this.equipped && this.state.startsWith('bow')
    this.pilum.visible = this.equipped && this.state === 'pilumThrow'
    this.instance.rig.animation!.setSwordHandShape?.(this.sword.visible)
  }

  update(dt: number): void {
    const animation = this.instance.rig.animation!
    this.elapsed += dt
    if (!this.equipped) {
      if (!this.started) animation.play(this.state, { fadeSeconds: 0, loop: true })
      animation.update(dt)
    } else if (this.state === 'idle' || this.state === 'walk' || this.state === 'run') {
      this.animator.setLocomotion(this.state === 'walk' ? 2 : this.state === 'run' ? 4 : 0)
      this.animator.update(dt)
    } else if (this.state === 'bowLoad' || this.state === 'bowHold') {
      const ratio = this.state === 'bowHold' ? 1 : (this.elapsed % 2) / 2
      this.animator.poseBow(ratio)
      this.animator.update(dt)
    } else if (this.state === 'swordSlash' || this.state === 'bowRelease' || this.state === 'pilumThrow') {
      if (!this.animator.busy) this.animator.start(this.state)
      this.animator.update(dt)
    } else {
      if (!this.started) {
        animation.setSwordHandShape?.(false)
        animation.play(this.state, { fadeSeconds: 0, loop: this.state === 'mounted' })
      }
      animation.update(dt)
      if (this.state === 'mounted') applyCharacterMountedPose(this.instance.rig, true, 'HORSE')
    }
    if (this.bow.visible) {
      this.target.set(0, 1.4, 10).applyMatrix4(this.instance.root.matrixWorld)
      this.bowVisual.update(this.state === 'bowHold' ? 1 : (this.elapsed % 2) / 2, this.target, true)
    }
    this.started = true
  }
}
