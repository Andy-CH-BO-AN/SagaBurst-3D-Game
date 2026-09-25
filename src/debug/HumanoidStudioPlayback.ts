import { applyEquipmentAttachment } from '../world/EquipmentAttachmentContract'
import * as THREE from 'three'
import type { HumanoidCharacterInstance } from '../world/HumanoidAssetRegistry'
import { CharacterCombatAnimator, COMBAT_ANIMATION_PROFILES } from '../world/CharacterCombatAnimator'
import { CharacterBowVisual } from '../world/CharacterBowVisual'
import { WeaponMeshFactory } from '../world/WeaponMeshFactory'
import { applySwordAttachment } from '../world/SwordAttachmentContract'
import { applyBowAttachment } from '../world/BowAttachmentContract'
import { applyCharacterMountedPose, type HumanoidAnimationState } from '../world/CharacterVisuals'
import { ArrowProjectile } from '../world/ArrowProjectile'
import { Faction } from '../world/NPC'
import { WEAPONS } from '../rpg/WeaponDatabase'

/** Studio exercises the production animator and actual faction equipment. */
export class HumanoidStudioPlayback {
  readonly sword = new THREE.Group()
  readonly bow = new THREE.Group()
  readonly pilum = new THREE.Group()
  readonly lance = new THREE.Group()
  readonly lanceModel = new THREE.Group()
  readonly shield = new THREE.Group()
  private equipmentLoadout: 'none' | 'sword' | 'lance' | null = null
  private hasShield = false
  private readonly animator: CharacterCombatAnimator
  private readonly bowVisual: CharacterBowVisual
  private readonly target = new THREE.Vector3()
  private readonly pilumPreviewDirection = new THREE.Vector3()
  private readonly pilumPreviewRotation = new THREE.Quaternion()
  private readonly pilumPreviewSpeed = WEAPONS.pilum_standard.arrowSpeedMax ?? 24
  private pilumPreview: ArrowProjectile | null = null
  private elapsed = 0
  private equipped = true
  private started = false

  constructor(readonly instance: HumanoidCharacterInstance, readonly state: HumanoidAnimationState, readonly faction: 'viking' | 'roman') {
    this.lance.add(this.lanceModel)
    WeaponMeshFactory.buildMelee('steel_lance', this.lanceModel)
    WeaponMeshFactory.buildShield(faction === 'roman' ? 'scutum_t2' : 'round_shield_t2', this.shield)
    instance.rig.right.handSocket.add(this.lance)
    instance.rig.left.handSocket.add(this.shield)
    const frames = instance.rig.equipmentGripFrames
    if (frames) {
      applyEquipmentAttachment(instance.rig.right.handSocket, this.lance, this.lanceModel, frames.lanceRight, 'lance')
      applyEquipmentAttachment(instance.rig.left.handSocket, this.shield, this.shield, frames.shieldLeft, 'shield')
    }
    this.lance.visible = this.shield.visible = false
    const grip = new THREE.Group()
    this.sword.add(grip)
    WeaponMeshFactory.buildNpcMelee(faction, 2, false, grip)
    applySwordAttachment(instance.rig.right.handSocket, this.sword, grip, instance.rig.swordGripFrame!, instance.rig.equipmentGripFrames?.lanceRight.modelRotationLocal)
    instance.rig.right.handSocket.add(this.sword, this.pilum)
    WeaponMeshFactory.buildNpcRanged('roman', 2, this.pilum)
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
    const sprinting = motion === 'run'
    if (mode === 'gameplay') {
      // Exercise the same charge / locomotion / release ordering as Player/NPC.
      const ratio = this.state === 'bowLoad' ? time : 1
      for (let i = 0; i < 12; i++) {
        this.animator.poseBow(ratio)
        this.animator.setLocomotion(speed, false, sprinting)
        this.animator.update(1 / 60)
      }
      if (this.state === 'bowRelease') {
        this.animator.start('bowRelease')
        const profile = COMBAT_ANIMATION_PROFILES.bowRelease
        const duration = (profile.windup + profile.active + profile.recovery) * time
        for (let elapsed = 0; elapsed < duration;) {
          const dt = Math.min(1 / 60, duration - elapsed)
          this.animator.setLocomotion(speed, false, sprinting)
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

  setEquipmentLoadout(weapon: 'none' | 'sword' | 'lance', shield: boolean): void {
    this.equipmentLoadout = weapon
    this.hasShield = shield
    this.reset()
  }

  attackEquipment(): void {
    this.animator.start(this.equipmentLoadout === 'lance' ? this.state === 'mounted' || this.state === 'mountedLance' ? 'mountedLance' : 'lanceThrust' : 'swordSlash')
  }

  sampleEquipment(time: number, mounted: boolean, motion: 'idle' | 'walk' | 'run' = 'idle', attack = false): void {
    this.reset()
    const speed = motion === 'walk' ? 2 : motion === 'run' ? 4 : 0
    const sprinting = motion === 'run'
    this.animator.setEquipment(this.equipmentLoadout === 'lance', this.hasShield)
    this.animator.setLocomotion(speed, mounted, sprinting)
    this.animator.update(0.2)
    if (attack) this.animator.start(this.equipmentLoadout === 'lance' ? mounted ? 'mountedLance' : 'lanceThrust' : 'swordSlash')
    const duration = attack ? this.equipmentLoadout === 'lance' ? mounted ? 0.42 : 0.70 : 0.48 : 1
    const end = time * duration
    for (let elapsed = 0; elapsed < end - 1e-9;) {
      const dt = Math.min(1 / 120, end - elapsed)
      this.animator.setLocomotion(speed, mounted, sprinting)
      this.animator.update(dt)
      elapsed += dt
    }
    this.instance.root.updateWorldMatrix(true, true)
  }

  setEquipped(enabled: boolean): void { this.equipped = enabled; this.reset() }

  reset(): void {
    this.pilumPreview?.destroy()
    this.pilumPreview = null
    this.elapsed = 0
    this.started = false
    this.instance.rig.animation!.stop()
    this.animator.cancel()
    this.instance.rig.animation!.setPoseLayersEnabled?.(this.equipped)
    const alive = this.state !== 'death'
    this.sword.visible = this.equipped && alive && !this.state.startsWith('bow') && this.state !== 'pilumThrow'
    this.bow.visible = this.equipped && alive && this.state.startsWith('bow')
    this.pilum.visible = this.equipped && alive && this.state === 'pilumThrow'
    if (this.equipmentLoadout !== null) {
      this.sword.visible = this.equipped && alive && this.equipmentLoadout === 'sword'
      this.lance.visible = this.equipped && alive && this.equipmentLoadout === 'lance'
      this.shield.visible = this.equipped && alive && this.hasShield
      this.bow.visible = this.pilum.visible = false
      this.animator.setEquipment(this.lance.visible, this.shield.visible)
    }
    this.instance.rig.animation!.setSwordHandShape?.(this.sword.visible || this.lance.visible)
  }

  update(dt: number): void {
    const animation = this.instance.rig.animation!
    this.elapsed += dt
    if (this.equipped && this.equipmentLoadout !== null) {
      const mounted = this.state === 'mounted' || this.state === 'mountedLance'
      this.animator.setEquipment(this.lance.visible, this.shield.visible)
      this.animator.setLocomotion(this.state === 'walk' ? 2 : this.state === 'run' ? 4 : 0, mounted, this.state === 'run')
      if ((this.state === 'lanceThrust' || this.state === 'mountedLance' || this.state === 'swordSlash') && !this.animator.busy) {
        this.animator.start(this.lance.visible ? mounted ? 'mountedLance' : 'lanceThrust' : 'swordSlash')
      }
      this.animator.update(dt)
    } else if (!this.equipped) {
      if (!this.started) animation.play(this.state, { fadeSeconds: 0, loop: true })
      animation.update(dt)
    } else if (this.state === 'idle' || this.state === 'walk' || this.state === 'run') {
      this.animator.setLocomotion(this.state === 'walk' ? 2 : this.state === 'run' ? 4 : 0, false, this.state === 'run')
      this.animator.update(dt)
    } else if (this.state === 'bowLoad' || this.state === 'bowHold') {
      const ratio = this.state === 'bowHold' ? 1 : (this.elapsed % 2) / 2
      this.animator.poseBow(ratio)
      this.animator.update(dt)
    } else if (this.state === 'swordSlash' || this.state === 'bowRelease' || this.state === 'pilumThrow') {
      if (!this.animator.busy && this.animator.start(this.state) && this.state === 'pilumThrow') {
        this.pilumPreview?.destroy()
        this.pilumPreview = null
        this.pilum.visible = true
      }
      const events = this.animator.update(dt)
      if (this.state === 'pilumThrow' && events.projectileRelease) {
        this.pilum.visible = false
        const scene = this.instance.root.parent
        if (scene instanceof THREE.Scene) {
          const origin = this.pilum.getWorldPosition(new THREE.Vector3())
          this.pilumPreviewDirection.set(0, 0, 1).applyQuaternion(this.instance.root.getWorldQuaternion(this.pilumPreviewRotation))
          this.pilumPreview = new ArrowProjectile(scene, origin, this.pilumPreviewDirection,
            this.pilumPreviewSpeed, 0, this.faction === 'viking' ? Faction.PLAYER : Faction.ENEMY, false, 'pilum')
        }
      }
      // On the release frame the new projectile starts at the held grip, not a
      // full update step ahead of the hand.
      if (!events.projectileRelease) this.pilumPreview?.mesh.position.addScaledVector(this.pilumPreviewDirection, dt * this.pilumPreviewSpeed)
    } else {
      if (!this.started) {
        animation.setSwordHandShape?.(false)
        animation.play(this.state, { fadeSeconds: 0, loop: this.state === 'mounted' })
      }
      animation.update(dt)
      if (this.state === 'mounted') {
        if (this.instance.rig.equipmentGripFrames) { animation.setEquipmentState?.({ mounted: true }); animation.update(0) }
        else applyCharacterMountedPose(this.instance.rig, true, 'HORSE')
      }
    }
    if (this.bow.visible) {
      this.target.set(0, 1.4, 10).applyMatrix4(this.instance.root.matrixWorld)
      this.bowVisual.update(this.state === 'bowHold' ? 1 : (this.elapsed % 2) / 2, this.target, true)
    }
    this.started = true
  }
}
