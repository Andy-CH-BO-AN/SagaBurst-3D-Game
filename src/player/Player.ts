/**
 * Player.ts
 * The player character (capsule geometry).
 * Calibrated with getTerrainHeight(x, z) for procedural heightmap terrain.
 * Supports 6 distinct 3D weapon geometries for Tier 1~3 Melee and Ranged weapons.
 * Triggers SoundManager audio effects for sword swings and bow releases.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import type { PlayerInput } from './PlayerInput'
import type { StaminaBar } from '../ui/StaminaBar'
import type { HpBar } from '../ui/HpBar'
import type { QuiverUI } from '../ui/QuiverUI'
import type { SoundManager } from '../audio/SoundManager'
import type { InventoryManager } from '../rpg/InventoryManager'
import type { WeaponData } from '../rpg/WeaponDatabase'
import { getTerrainHeight } from '../world/Terrain'

// ── Tuning constants ──
const MOVE_SPEED        = 8    // units/s walk
const SPRINT_MULTIPLIER = 2.0  // walk × this = sprint speed
const JUMP_VELOCITY     = 9    // units/s upward
const GRAVITY           = -22  // units/s²
const PLAYER_HALF_HEIGHT = 0.95

const MAX_HP            = 100
const MAX_STAMINA       = 100
const STAMINA_DRAIN     = 30   // per second while sprinting
const STAMINA_REGEN     = 15   // per second when not sprinting
const STAMINA_SPRINT_MIN = 10  // must have at least this much to start sprint
const SWING_STAMINA_COST = 15  // stamina consumed per sword swing

const PLAYER_RADIUS = 0.38
const SWING_DURATION = 0.35
const MAX_BOW_CHARGE_TIME = 1.2

export interface ArrowLaunchEvent {
  origin: THREE.Vector3
  direction: THREE.Vector3
  speed: number
  damage: number
}

export class Player {
  readonly group: THREE.Group

  private bodyMat: THREE.MeshLambertMaterial
  private hitFlashMat: THREE.MeshBasicMaterial
  private bodyMesh!: THREE.Mesh
  private headMesh!: THREE.Mesh
  private faceCone!: THREE.Mesh
  private characterModelGroup: THREE.Group
  private gltfLoader: GLTFLoader
  private flashTimer = 0

  // FBX Animation System
  private mixer: THREE.AnimationMixer | null = null
  private animClips: THREE.AnimationClip[] = []
  private currentAction: THREE.AnimationAction | null = null
  private currentAnimName = ''
  private knightMeshes: THREE.Mesh[] = []

  // 3D Weapon Pivots & Models
  private rightHandSocket!: THREE.Group
  private swordPivot!: THREE.Group
  private currentMeleeId: string = ''

  private bowPivot!: THREE.Group
  private currentRangedId: string = ''
  private stringMeshTop!: THREE.Mesh
  private stringMeshBottom!: THREE.Mesh
  private nockedArrow!: THREE.Group

  private velY = 0
  private onGround = false

  private currentHp = MAX_HP
  private stamina = MAX_STAMINA
  private isSprinting = false

  private isSwinging = false
  private swingTimer = 0
  private attackHitProcessed = false

  private aiming = false
  private bowChargeTime = 0
  private arrows = 30
  private isDead = false

  onFireArrow: ((evt: ArrowLaunchEvent) => void) | null = null
  onPlayerDeath: (() => void) | null = null

  get position(): THREE.Vector3 { return this.group.position }
  get staminaRatio(): number    { return this.stamina / MAX_STAMINA }
  get hpRatio(): number         { return Math.max(0, this.currentHp / MAX_HP) }
  get hp(): number              { return this.currentHp }
  get staminaValue(): number    { return this.stamina }
  get swinging(): boolean       { return this.isSwinging }
  get isAiming(): boolean       { return this.aiming }
  get arrowCount(): number      { return this.arrows }
  get dead(): boolean           { return this.isDead }

  setPosition(x: number, y: number, z: number): void {
    this.group.position.set(x, y, z)
  }
  setStamina(value: number): void {
    this.stamina = Math.max(0, Math.min(MAX_STAMINA, value))
  }
  setHp(value: number): void {
    this.currentHp = Math.max(0, Math.min(MAX_HP, value))
  }
  setArrowCount(count: number): void {
    this.arrows = count
  }

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    this.group.name = 'player'

    this.bodyMat = new THREE.MeshLambertMaterial({ color: 0xe8e0d0 })
    this.hitFlashMat = new THREE.MeshBasicMaterial({ color: 0xff3333 })
    this.characterModelGroup = new THREE.Group()
    this.group.add(this.characterModelGroup)

    this.gltfLoader = new GLTFLoader()

    this._buildMesh()
    this._loadCharacterFBX()

    // Create Right Hand Socket (Attached to hand bone later)
    this.rightHandSocket = new THREE.Group()
    this.group.add(this.rightHandSocket)

    // Create Weapon Pivots inside Right Hand Socket
    this.swordPivot = new THREE.Group()
    this.rightHandSocket.add(this.swordPivot)

    // Create static Bow Socket (Keeps procedural bow aiming intact)
    this.bowSocket = new THREE.Group()
    this.bowSocket.position.set(0.68, 0.95, 0.05)
    this.group.add(this.bowSocket)

    this.bowPivot = new THREE.Group()
    this.bowSocket.add(this.bowPivot)

    // Build default initial weapons (Steel Sword & Recurve Longbow)
    this.rebuildMeleeWeapon('steel_sword')
    this.rebuildRangedWeapon('recurve_longbow')

    scene.add(this.group)

    // Initial position calibrated with terrain height at [0, 0]
    const terrainY = getTerrainHeight(0, 0)
    this.group.position.set(0, terrainY + PLAYER_HALF_HEIGHT, 0)
  }

  private _buildMesh(): void {
    const bodyGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.2, 12)
    this.bodyMesh = new THREE.Mesh(bodyGeo, this.bodyMat)
    this.bodyMesh.castShadow = true
    this.bodyMesh.visible = false
    this.group.add(this.bodyMesh)

    const headGeo = new THREE.SphereGeometry(0.35, 12, 8)
    this.headMesh = new THREE.Mesh(headGeo, this.bodyMat)
    this.headMesh.position.y = 0.95
    this.headMesh.castShadow = true
    this.headMesh.visible = false
    this.group.add(this.headMesh)

    const faceMat = new THREE.MeshLambertMaterial({ color: 0x333333 })
    this.faceCone = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 6), faceMat)
    this.faceCone.rotation.x = -Math.PI / 2
    this.faceCone.position.set(0, 0.95, -0.38)
    this.faceCone.visible = false
    this.group.add(this.faceCone)
  }

  private _loadCharacterFBX(): void {
    const fbxLoader = new FBXLoader()
    fbxLoader.load('/models/characters/KnightCharacter.fbx', (fbx) => {

      // Scale: FBXLoader auto-applies 0.01 for cm-unit FBX files from Blender
      fbx.scale.setScalar(0.01)
      fbx.position.set(0, -PLAYER_HALF_HEIGHT, 0)
      fbx.rotation.y = Math.PI

      // Hide capsule fallback geometry — FBX loaded successfully
      if (this.bodyMesh) this.bodyMesh.visible = false
      if (this.headMesh) this.headMesh.visible = false
      if (this.faceCone) this.faceCone.visible = false

      // Shadow + collect mesh refs + dynamic bone finding
      let rightHandBone: THREE.Object3D | null = null
      let headBone: THREE.Object3D | null = null
      let spineBone: THREE.Object3D | null = null

      fbx.traverse((child) => {
        const nameL = child.name.toLowerCase()
        // Try to find the bones dynamically instead of hardcoding
        if (nameL.includes('hand') && nameL.includes('r')) {
          rightHandBone = child
        }
        if (nameL.includes('head')) headBone = child
        if (nameL.includes('spine') || nameL.includes('chest')) spineBone = child

        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.castShadow = true
          mesh.receiveShadow = true
          this.knightMeshes.push(mesh)

          if (mesh.material) {
            const mat = mesh.material as THREE.MeshPhongMaterial
            if (mat.name === 'Armor') {
              mat.color.setHex(0x888888)
              mat.specular = new THREE.Color(0x555555)
              mat.shininess = 30
            }
          }
        }
      })

      // Fallback if dynamic search missed it
      if (!rightHandBone) rightHandBone = fbx.getObjectByName('MiddleHand.R') || null

      // Attach weapon socket to right hand
      let boneWorldScaleStr = 'N/A'
      let rightHandName = rightHandBone ? rightHandBone.name : 'NOT FOUND'
      
      if (rightHandBone) {
        rightHandBone.add(this.rightHandSocket)
        this.rightHandSocket.position.set(0, 0, 0)
        
        fbx.updateMatrixWorld(true)
        const boneWorldScale = new THREE.Vector3()
        boneWorldScale.setFromMatrixScale(rightHandBone.matrixWorld)
        
        // Counteract the inherited scale, should be roughly 1.0 since root is 0.01 and bone is 100
        this.rightHandSocket.scale.set(1 / boneWorldScale.x, 1 / boneWorldScale.y, 1 / boneWorldScale.z)
        
        // Correct the rotation so the sword points forward in the hand
        this.rightHandSocket.rotation.set(Math.PI / 2, 0, 0)
      } else {
        console.warn('[Player] Right hand bone not found — weapon at fallback position')
      }

      // Find spine/chest dynamically using UpperArm's parent!
      if (!spineBone) {
        const upperArm = fbx.getObjectByName('UpperArm.L')
        if (upperArm && upperArm.parent) {
          spineBone = upperArm.parent
        } else {
          spineBone = fbx.getObjectByName('Hips') || null
        }
      }

      // Load Accessories (Quaternius accessories are usually exported at 100x scale relative to character)
      if (headBone) {
        fbxLoader.load('/models/characters/Helmet1.fbx', (helmetFbx) => {
          helmetFbx.scale.setScalar(0.01) // Correct for 100x native scale
          helmetFbx.position.set(0, 0, 0)
          helmetFbx.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true }})
          headBone!.add(helmetFbx)
        })
      }
      if (spineBone) {
        fbxLoader.load('/models/characters/ShoulderPads.fbx', (padsFbx) => {
          padsFbx.scale.setScalar(0.01) // Correct for 100x native scale
          padsFbx.position.set(0, 0, 0)
          padsFbx.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true }})
          spineBone!.add(padsFbx)
        })
      }

      this.mixer = new THREE.AnimationMixer(fbx)
      this.animClips = fbx.animations
      this._switchAnimation('HumanArmature|Idle')

      this.characterModelGroup.add(fbx)

    }, undefined, (err) => {
      console.warn('[Player] FBX load failed, fallback to capsule geometry:', err)
      if (this.bodyMesh) this.bodyMesh.visible = true
      if (this.headMesh) this.headMesh.visible = true
      if (this.faceCone) this.faceCone.visible = true
    })
  }

  // ── Dynamic 3D Melee Weapon Builders ──
  private swordTipLocal = new THREE.Vector3(0, 1.2, 0)

  rebuildMeleeWeapon(weaponId: string): void {
    if (this.currentMeleeId === weaponId) return
    this.currentMeleeId = weaponId

    // Clear existing meshes
    while (this.swordPivot.children.length > 0) {
      this.swordPivot.remove(this.swordPivot.children[0])
    }

    this._buildGeometricMeleeWeapon(weaponId)
  }

  private _buildGeometricMeleeWeapon(weaponId: string): void {
    if (weaponId === 'rusty_dagger') {
      const hiltMat  = new THREE.MeshLambertMaterial({ color: 0x3a3028 })
      const guardMat = new THREE.MeshLambertMaterial({ color: 0x555555 })
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.3 })

      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 6), hiltMat)
      hilt.position.y = 0.09
      this.swordPivot.add(hilt)

      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.04), guardMat)
      guard.position.y = 0.18
      this.swordPivot.add(guard)

      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.55, 0.02), bladeMat)
      blade.position.y = 0.48
      blade.castShadow = true
      this.swordPivot.add(blade)

      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), bladeMat)
      tip.position.y = 0.81
      this.swordPivot.add(tip)
      this.swordTipLocal.set(0, 0.87, 0)

    } else if (weaponId === 'runic_greatsword') {
      const hiltMat  = new THREE.MeshLambertMaterial({ color: 0x222222 })
      const ringMat  = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 })
      const guardMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 })
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.95, roughness: 0.1 })
      const gemMat   = new THREE.MeshBasicMaterial({ color: 0x00d2ff })

      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.45, 8), hiltMat)
      hilt.position.y = 0.225
      this.swordPivot.add(hilt)

      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.012, 8, 16), ringMat)
        ring.rotation.x = Math.PI / 2
        ring.position.y = 0.1 + i * 0.12
        this.swordPivot.add(ring)
      }

      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.085), gemMat)
      gem.position.y = -0.04
      this.swordPivot.add(gem)

      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.09, 0.12), guardMat)
      guard.position.y = 0.48
      this.swordPivot.add(guard)

      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.55, 0.048), bladeMat)
      blade.position.y = 1.3
      blade.castShadow = true
      this.swordPivot.add(blade)

      const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.065, 1.35, 0.058), gemMat)
      fuller.position.y = 1.25
      this.swordPivot.add(fuller)
      this.swordTipLocal.set(0, 2.1, 0)

    } else {
      // Tier 2 Authentic Medieval Steel Sword (標準中世紀十字鋼鐵長劍)
      const hiltMat  = new THREE.MeshLambertMaterial({ color: 0x4a3525 }) // 皮革握把
      const guardMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 }) // 黃金/青銅十字護手
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.95, roughness: 0.1 }) // 亮銀高金屬感長劍刀刃
      const pommelMat= new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 })

      // 握柄 Hilt
      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), hiltMat)
      hilt.position.y = 0.15
      this.swordPivot.add(hilt)

      // 劍尾球 Pommel
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), pommelMat)
      pommel.position.y = 0.0
      this.swordPivot.add(pommel)

      // 十字護手 Crossguard
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 0.08), guardMat)
      guard.position.y = 0.3
      this.swordPivot.add(guard)

      // 鋼鐵長劍刀刃 Blade
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.03), bladeMat)
      blade.position.y = 0.85
      blade.castShadow = true
      this.swordPivot.add(blade)

      // 劍尖 Tip
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.056, 0.2, 4), bladeMat)
      tip.rotation.y = Math.PI / 4
      tip.position.y = 1.48
      this.swordPivot.add(tip)

      this.swordTipLocal.set(0, 1.58, 0)
    }

    // Orient sword to naturally rest along the hand forward
    this.swordPivot.rotation.set(0, 0, 0)
  }

  // ── Dynamic 3D Ranged Bow Builders (3 Distinct Geometries) ──
  rebuildRangedWeapon(weaponId: string): void {
    if (this.currentRangedId === weaponId) return
    this.currentRangedId = weaponId

    while (this.bowPivot.children.length > 0) {
      this.bowPivot.remove(this.bowPivot.children[0])
    }

    this.gltfLoader.load('/models/weapons/bow.glb', (gltf) => {
      if (this.currentRangedId !== weaponId) return

      while (this.bowPivot.children.length > 0) {
        this.bowPivot.remove(this.bowPivot.children[0])
      }

      const bowModel = gltf.scene
      bowModel.scale.set(0.6, 0.6, 0.6)
      bowModel.rotation.set(0, Math.PI / 2, 0)
      bowModel.position.set(0, 0, 0)

      bowModel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true
        }
      })

      this.bowPivot.add(bowModel)
      this._buildNockedArrow(weaponId)
    }, undefined, () => {
      this._buildGeometricRangedWeapon(weaponId)
    })

    this.bowPivot.visible = false
  }

  private _buildGeometricRangedWeapon(weaponId: string): void {
    const stringMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e })
    const gripMat = new THREE.MeshLambertMaterial({ color: 0x222222 })

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.25, 8), gripMat)
    this.bowPivot.add(grip)

    const upperLimb = new THREE.Group()
    const limbSeg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.55, 8), woodMat)
    limbSeg1.position.set(0, 0.35, -0.08)
    limbSeg1.rotation.x = -0.3
    upperLimb.add(limbSeg1)
    this.bowPivot.add(upperLimb)

    const lowerLimb = new THREE.Group()
    const limbSeg3 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.55, 8), woodMat)
    limbSeg3.position.set(0, -0.35, -0.08)
    limbSeg3.rotation.x = 0.3
    lowerLimb.add(limbSeg3)
    this.bowPivot.add(lowerLimb)

    this.stringMeshTop = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.78, 4), stringMat)
    this.bowPivot.add(this.stringMeshTop)

    this.stringMeshBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.78, 4), stringMat)
    this.bowPivot.add(this.stringMeshBottom)

    this._buildNockedArrow(weaponId)
  }

  getSwordTipPosition(): THREE.Vector3 {
    const tipWorld = new THREE.Vector3()
    this.swordPivot.localToWorld(tipWorld.copy(this.swordTipLocal))
    return tipWorld
  }

  private _buildNockedArrow(weaponId: string): void {
    this.nockedArrow = new THREE.Group()
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e })

    const arrowShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.95, 6), woodMat)
    arrowShaft.rotation.x = Math.PI / 2
    this.nockedArrow.add(arrowShaft)

    const tipColor = weaponId === 'elven_runebow' ? 0x00f0ff : 0xaaaaaa
    const tipMat = new THREE.MeshStandardMaterial({ color: tipColor, metalness: 0.9 })
    const arrowTip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 6), tipMat)
    arrowTip.rotation.x = -Math.PI / 2
    arrowTip.position.z = -0.52
    this.nockedArrow.add(arrowTip)

    const featherMat = new THREE.MeshBasicMaterial({ color: weaponId === 'elven_runebow' ? 0x00d2ff : 0xdddddd })
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.16), featherMat)
    fin.position.z = 0.4
    this.nockedArrow.add(fin)

    this.bowPivot.add(this.nockedArrow)
  }

  private _switchAnimation(name: string, loop = true): void {
    if (this.currentAnimName === name || !this.mixer) return

    const clip = THREE.AnimationClip.findByName(this.animClips, name)
    if (!clip) {
      console.warn(`[Player] Animation clip not found: ${name}`)
      return
    }

    const nextAction = this.mixer.clipAction(clip)
    nextAction.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce
    if (!loop) nextAction.clampWhenFinished = true

    if (this.currentAction && this.currentAction !== nextAction) {
      nextAction.reset().fadeIn(0.2)
      this.currentAction.fadeOut(0.2)
    } else {
      nextAction.reset().play()
    }

    this.currentAction = nextAction
    this.currentAnimName = name
  }

  private _updateAnimationState(isMoving: boolean): void {
    if (!this.mixer) return

    if (this.isDead) {
      this._switchAnimation('HumanArmature|Death', false)
      return
    }
    if (this.isSwinging) {
      this._switchAnimation('HumanArmature|Run_swordAttack', false)
      return
    }
    if (this.isSprinting && isMoving) {
      this._switchAnimation('HumanArmature|Run')
      return
    }
    if (isMoving) {
      this._switchAnimation('HumanArmature|Walking')
      return
    }
    this._switchAnimation('HumanArmature|Idle')
  }

  takeDamage(amount: number, hpBar: HpBar): void {
    if (this.isDead) return

    this.currentHp = Math.max(0, this.currentHp - amount)
    this.flashTimer = 0.2
    hpBar.setFill(this.hpRatio)

    if (this.currentHp <= 0) {
      this.isDead = true
      if (this.onPlayerDeath) this.onPlayerDeath()
      this.respawn(hpBar)
    }
  }

  respawn(hpBar: HpBar): void {
    this.currentHp = MAX_HP
    this.stamina = MAX_STAMINA
    this.isDead = false
    const terrainY = getTerrainHeight(0, 0)
    this.group.position.set(0, terrainY + PLAYER_HALF_HEIGHT, 0)
    hpBar.setFill(1)
  }

  isHitFrame(equippedMelee?: WeaponData): boolean {
    if (!this.isSwinging || this.attackHitProcessed) return false
    const swingDuration = equippedMelee ? equippedMelee.speedOrCharge : SWING_DURATION
    const progress = this.swingTimer / swingDuration
    return progress >= 0.2 && progress <= 0.8
  }

  markHitProcessed(): void {
    this.attackHitProcessed = true
  }

  update(
    dt: number,
    input: PlayerInput,
    cameraYaw: number,
    cameraDirection: THREE.Vector3,
    obstacles: THREE.Box3[],
    staminaBar: StaminaBar,
    quiverUI: QuiverUI,
    soundManager: SoundManager,
    inventoryManager?: InventoryManager,
    archeryMultiplier = 1.0,
  ): void {
    // Tick AnimationMixer
    this.mixer?.update(dt)

    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      this.bodyMesh.material = this.hitFlashMat
      this.headMesh.material = this.hitFlashMat
      for (const m of this.knightMeshes) {
        (m as any)._origMat ??= m.material
        m.material = this.hitFlashMat
      }
    } else {
      this.bodyMesh.material = this.bodyMat
      this.headMesh.material = this.bodyMat
      for (const m of this.knightMeshes) {
        if ((m as any)._origMat) m.material = (m as any)._origMat
      }
    }

    if (this.isDead) return

    const equippedMelee = inventoryManager?.equippedMelee
    const equippedRanged = inventoryManager?.equippedRanged

    if (equippedMelee) this.rebuildMeleeWeapon(equippedMelee.id)
    if (equippedRanged) this.rebuildRangedWeapon(equippedRanged.id)

    const maxChargeTime = equippedRanged ? equippedRanged.speedOrCharge : MAX_BOW_CHARGE_TIME
    const swingDuration = equippedMelee ? equippedMelee.speedOrCharge : SWING_DURATION

    const wantAim = input.isRightMouseDown
    this.aiming = wantAim && !this.isSwinging

    quiverUI.setAiming(this.aiming)

    if (this.aiming) {
      this.swordPivot.visible = false
      this.bowPivot.visible = true

      if (input.isLeftMouseDown && this.arrows > 0) {
        this.bowChargeTime = Math.min(maxChargeTime, this.bowChargeTime + dt)
        quiverUI.setChargeRatio(this.bowChargeTime / maxChargeTime)
      }

      if (input.consumeLeftClickRelease()) {
        if (this.bowChargeTime > 0.1 && this.arrows > 0) {
          this._fireArrow(cameraDirection, archeryMultiplier, equippedRanged)
          soundManager.playBowRelease()
        }
        this.bowChargeTime = 0
        quiverUI.setChargeRatio(0)
      }

    } else {
      this.swordPivot.visible = true
      this.bowPivot.visible = false
      this.bowChargeTime = 0
      quiverUI.setChargeRatio(0)

      if (input.consumeLeftClick() && !this.isSwinging && this.stamina >= SWING_STAMINA_COST) {
        this.isSwinging = true
        this.swingTimer = 0
        this.attackHitProcessed = false
        this.stamina -= SWING_STAMINA_COST
        soundManager.playSwing()
      }
    }

    this._updateBowPose(maxChargeTime)
    this._updateSwingAnimation(dt, swingDuration)

    const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw))
    const right   = new THREE.Vector3( Math.cos(cameraYaw), 0, -Math.sin(cameraYaw))

    const moveDir = new THREE.Vector3()
    if (input.keys['KeyW']) moveDir.addScaledVector(forward, 1)
    if (input.keys['KeyS']) moveDir.addScaledVector(forward, -1)
    if (input.keys['KeyA']) moveDir.addScaledVector(right, -1)
    if (input.keys['KeyD']) moveDir.addScaledVector(right, 1)

    const isMoving = moveDir.lengthSq() > 0

    const wantSprint = input.keys['ShiftLeft'] || input.keys['ShiftRight']

    if (wantSprint && isMoving && this.stamina >= STAMINA_SPRINT_MIN && !this.isSwinging && !this.aiming) {
      this.isSprinting = true
    }
    if (!wantSprint || !isMoving || this.stamina <= 0 || this.isSwinging || this.aiming) {
      this.isSprinting = false
    }

    this._updateAnimationState(isMoving)

    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt)
    } else if (!this.isSwinging) {
      this.stamina = Math.min(MAX_STAMINA, this.stamina + STAMINA_REGEN * dt)
    }
    staminaBar.setFill(this.staminaRatio)

    if (this.aiming) {
      this.group.rotation.y = cameraYaw
    } else if (isMoving) {
      moveDir.normalize()
      const targetAngle = Math.atan2(-moveDir.x, -moveDir.z)
      this.group.rotation.y = targetAngle
    } else if (this.isSwinging) {
      this.group.rotation.y = cameraYaw
    }

    const speed = MOVE_SPEED * (this.isSprinting ? SPRINT_MULTIPLIER : 1)
    this.group.position.addScaledVector(moveDir, speed * dt)

    // Jump
    if (input.keys['Space'] && this.onGround) {
      this.velY = JUMP_VELOCITY
      this.onGround = false
    }

    // Gravity
    this.velY += GRAVITY * dt
    this.group.position.y += this.velY * dt

    // Dynamic Heightmap Ground Collision
    const currentGroundY = getTerrainHeight(this.group.position.x, this.group.position.z)
    const footY = currentGroundY + PLAYER_HALF_HEIGHT
    if (this.group.position.y <= footY) {
      this.group.position.y = footY
      this.velY = 0
      this.onGround = true
    }

    // Obstacle Push-out
    this._resolveObstacles(obstacles)

    // World Boundary Clamp
    const BOUND = 95
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -BOUND, BOUND)
    this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -BOUND, BOUND)
  }

  private _updateBowPose(maxChargeTime = MAX_BOW_CHARGE_TIME): void {
    if (!this.aiming) return

    this.bowPivot.position.set(-0.48, 0.9, -0.45)
    this.bowPivot.rotation.set(0.1, -0.15, -0.2)

    const drawRatio = this.bowChargeTime / maxChargeTime
    const stringPullBack = drawRatio * 0.45

    const topTip = new THREE.Vector3(0, 0.75, 0.12)
    const botTip = new THREE.Vector3(0, -0.75, 0.12)
    const nockPos = new THREE.Vector3(0.15, 0, 0.12 + stringPullBack)

    if (this.stringMeshTop) {
      this.stringMeshTop.position.copy(topTip).add(nockPos).multiplyScalar(0.5)
      this.stringMeshTop.lookAt(nockPos)
      this.stringMeshTop.rotation.x += Math.PI / 2
      this.stringMeshTop.scale.set(1, topTip.distanceTo(nockPos) / 0.78, 1)
    }

    if (this.stringMeshBottom) {
      this.stringMeshBottom.position.copy(botTip).add(nockPos).multiplyScalar(0.5)
      this.stringMeshBottom.lookAt(nockPos)
      this.stringMeshBottom.rotation.x += Math.PI / 2
      this.stringMeshBottom.scale.set(1, botTip.distanceTo(nockPos) / 0.78, 1)
    }

    if (this.nockedArrow) {
      if (this.arrows > 0) {
        this.nockedArrow.visible = true
        this.nockedArrow.position.copy(nockPos)
      } else {
        this.nockedArrow.visible = false
      }
    }
  }

  private _fireArrow(
    cameraDirection: THREE.Vector3,
    archeryMultiplier = 1.0,
    equippedRanged?: WeaponData
  ): void {
    if (this.arrows <= 0) return

    this.arrows -= 1

    const maxChargeTime = equippedRanged ? equippedRanged.speedOrCharge : MAX_BOW_CHARGE_TIME
    const speedMin = equippedRanged?.arrowSpeedMin ?? 18
    const speedMax = equippedRanged?.arrowSpeedMax ?? 48
    const dmgMin   = equippedRanged?.damageMin ?? 15
    const dmgMax   = equippedRanged?.damageMax ?? 42

    const chargeRatio = this.bowChargeTime / maxChargeTime
    const speed  = THREE.MathUtils.lerp(speedMin, speedMax, chargeRatio)
    const baseDamage = THREE.MathUtils.lerp(dmgMin, dmgMax, chargeRatio)
    const damage = Math.round(baseDamage * archeryMultiplier)

    const origin = this.group.position.clone()
    origin.y += 1.4

    if (this.onFireArrow) {
      this.onFireArrow({
        origin,
        direction: cameraDirection.clone(),
        speed,
        damage,
      })
    }
  }

  private _updateSwingAnimation(dt: number, swingDuration = SWING_DURATION): void {
    if (!this.isSwinging) {
      this.swordPivot.rotation.set(0, 0, 0)
      return
    }

    this.swingTimer += dt
    const progress = Math.min(1, this.swingTimer / swingDuration)

    if (progress < 0.5) {
      const t = progress / 0.5
      const pitch = THREE.MathUtils.lerp(Math.PI / 6, -Math.PI / 3, t)
      const yaw   = THREE.MathUtils.lerp(0, Math.PI / 2, t)
      const roll  = THREE.MathUtils.lerp(-Math.PI / 12, -Math.PI / 4, t)
      this.swordPivot.rotation.set(pitch, yaw, roll)
    } else {
      const t = (progress - 0.5) / 0.5
      const pitch = THREE.MathUtils.lerp(-Math.PI / 3, Math.PI / 6, t)
      const yaw   = THREE.MathUtils.lerp(Math.PI / 2, 0, t)
      const roll  = THREE.MathUtils.lerp(-Math.PI / 4, -Math.PI / 12, t)
      this.swordPivot.rotation.set(pitch, yaw, roll)
    }

    if (this.swingTimer >= swingDuration) {
      this.isSwinging = false
    }
  }

  private _resolveObstacles(obstacles: THREE.Box3[]): void {
    const pos = this.group.position

    for (const box of obstacles) {
      const pMin = new THREE.Vector3(pos.x - PLAYER_RADIUS, pos.y - PLAYER_HALF_HEIGHT, pos.z - PLAYER_RADIUS)
      const pMax = new THREE.Vector3(pos.x + PLAYER_RADIUS, pos.y + PLAYER_HALF_HEIGHT, pos.z + PLAYER_RADIUS)
      const playerBox = new THREE.Box3(pMin, pMax)

      if (!playerBox.intersectsBox(box)) continue

      const overlapX1 = pMax.x - box.min.x
      const overlapX2 = box.max.x - pMin.x
      const overlapZ1 = pMax.z - box.min.z
      const overlapZ2 = box.max.z - pMin.z

      const minOverlap = Math.min(overlapX1, overlapX2, overlapZ1, overlapZ2)

      if (minOverlap === overlapX1) pos.x -= overlapX1
      else if (minOverlap === overlapX2) pos.x += overlapX2
      else if (minOverlap === overlapZ1) pos.z -= overlapZ1
      else pos.z += overlapZ2
    }
  }
}
