/**
 * NPC.ts
 * Generic NPC AI unit (Faction System, Melee/Ranged).
 * Calibrated with getTerrainHeight(x, z) for procedural heightmap terrain.
 */
import * as THREE from 'three'
import type { Player } from '../player/Player'
import type { HpBar } from '../ui/HpBar'
import { getObstacleAvoidanceDirection, getTerrainHeight, ObstacleData, resolveObstacleCollision } from './Terrain'
import { buildCharacterVisual, polishWeaponMaterials } from './CharacterVisuals'
import { Mount, MountType } from './Mount'
import { WEAPONS } from '../rpg/WeaponDatabase'

export enum AIState {
  IDLE = 'IDLE',
  ALERT = 'ALERT',
  CHASE = 'CHASE',
  ATTACK = 'ATTACK',
  DEAD = 'DEAD',
}

export enum Faction {
  PLAYER = 'PLAYER', // Allied with Player
  ENEMY = 'ENEMY',   // Hostile to Player
}

export enum AIType {
  MELEE = 'MELEE',
  RANGED = 'RANGED',
}

const DETECTION_RADIUS = 300.0
const RANGED_ATTACK_MAX = 15.0
const RANGED_ATTACK_MIN = 6.0

const CHASE_SPEED      = 4.8
const PATROL_SPEED     = 2.2
const MELEE_COOLDOWN   = 1.2
const RANGED_COOLDOWN  = 1.5
const RESPAWN_TIME     = 10.0

export class NPC {
  readonly group: THREE.Group
  readonly faction: Faction
  readonly aiType: AIType
  readonly name: string
  readonly tier: 1 | 2 | 3

  public readonly meleeDamage: number
  public readonly rangedDamage: number
  public readonly generatedAsCavalry: boolean
  public mount: Mount | null = null
  public meleeAttackRadius = 1.8
  public isUsingLance = false

  private bodyMesh: THREE.Mesh
  private headMesh: THREE.Mesh
  private headMat: THREE.MeshStandardMaterial
  private rightArm: THREE.Group
  private leftArm: THREE.Group
  private alertSprite: THREE.Sprite

  private swordPivot: THREE.Group
  private bowPivot: THREE.Group

  private bodyMat: THREE.MeshStandardMaterial
  private flashMat: THREE.MeshBasicMaterial

  readonly maxHp = 120
  private currentHp = 120

  private state: AIState = AIState.IDLE
  private alertTimer = 0
  private attackTimer = 0
  private attackHitProcessed = false

  private flashTimer = 0
  private respawnTimer = 0

  private spawnX: number
  private spawnZ: number
  private waypoints: THREE.Vector3[] = []
  private currentWaypointIdx = 0

  private arrows: number = 0
  private velY = 0
  private onGround = false

  get hp(): number { return this.currentHp }
  get hpRatio(): number { return Math.max(0, this.currentHp / this.maxHp) }
  get currentState(): AIState { return this.state }
  get dead(): boolean { return this.state === AIState.DEAD }
  get position(): THREE.Vector3 { return this.group.position }
  get combatPosition(): THREE.Vector3 { return this.mount ? this.mount.group.position : this.group.position }
  get isMounted(): boolean { return this.mount !== null && !this.mount.dead }

  constructor(
    scene: THREE.Scene,
    spawnX: number,
    spawnZ: number,
    faction: Faction,
    aiType: AIType,
    name: string,
    tier: 1 | 2 | 3,
    cavalry?: boolean,
  ) {
    this.spawnX = spawnX
    this.spawnZ = spawnZ
    this.faction = faction
    this.aiType = aiType
    this.name = name
    this.tier = tier
    this.generatedAsCavalry = cavalry ?? Math.random() < 0.4

    if (this.aiType === AIType.RANGED) {
      this.arrows = 30
    } else {
      this.arrows = 0
    }

    // Assign Damages
    if (this.faction === Faction.ENEMY) {
      // Ranged units' fallback melee weapon is always Tier 1
      const meleeT = this.aiType === AIType.RANGED ? 1 : this.tier
      this.meleeDamage = WEAPONS[meleeT === 1 ? 'gladius_rusty' : meleeT === 2 ? 'gladius_standard' : 'centurion_blade'].damageMax
      this.rangedDamage = WEAPONS[this.tier === 1 ? 'pilum_basic' : this.tier === 2 ? 'pilum_standard' : 'legionary_pilum'].damageMax
    } else {
      // Viking Ally fallback fixed tiers
      this.meleeDamage = WEAPONS['steel_sword'].damageMax
      this.rangedDamage = WEAPONS['recurve_longbow'].damageMax
    }

    if (this.generatedAsCavalry && this.aiType === AIType.MELEE) {
      this.isUsingLance = true
      this.meleeAttackRadius = 3.0
      this.meleeDamage = this.meleeDamage * 1.5 // Extra damage for lance
    }

    // Calibrate waypoints to terrain height
    const baseTerrainY = getTerrainHeight(spawnX, spawnZ)
    // Spawn 20 units in the air so they drop down
    const basePos = new THREE.Vector3(spawnX, baseTerrainY + 20, spawnZ)

    const wp1 = new THREE.Vector3(spawnX - 10, getTerrainHeight(spawnX - 10, spawnZ - 8), spawnZ - 8)
    const wp2 = new THREE.Vector3(spawnX + 8, getTerrainHeight(spawnX + 8, spawnZ - 12), spawnZ - 12)
    this.waypoints = [basePos.clone(), wp1, wp2]

    this.group = new THREE.Group()
    this.group.name = `npc_${faction}_${aiType}`

    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const visual = buildCharacterVisual(this.group, {
      faction: this.faction === Faction.ENEMY ? 'roman' : 'viking',
      tier: this.tier,
      isPlayer: false,
    })
    this.bodyMesh = visual.bodyMesh
    this.headMesh = visual.headMesh
    this.bodyMat = visual.bodyMaterial
    this.headMat = visual.headMaterial
    this.rightArm = visual.rightArm
    this.leftArm = visual.leftArm

    // Weapons
    this.swordPivot = new THREE.Group()
    this.swordPivot.position.set(0.45, 0.75, -0.1)
    this.group.add(this.swordPivot)

    this.bowPivot = new THREE.Group()
    if (this.faction === Faction.ENEMY) {
      this.bowPivot.position.set(0.45, 0.75, -0.1) // Pilum held in right hand like sword
      this.bowPivot.rotation.set(0, 0, 0)
    } else {
      this.bowPivot.position.set(0.35, 0.8, -0.5) // Bow held
      this.bowPivot.rotation.set(0, 0, -0.1)
    }
    this.group.add(this.bowPivot)

    if (this.isUsingLance) {
      this._buildLance()
    } else {
      this._buildSword(this.faction, this.aiType === AIType.RANGED ? 1 : this.tier)
    }
    this._buildBow()
    polishWeaponMaterials(this.swordPivot)
    polishWeaponMaterials(this.bowPivot)

    if (this.arrows > 0) {
      this.swordPivot.visible = false
      this.bowPivot.visible = true
    } else {
      this.swordPivot.visible = true
      this.bowPivot.visible = false
    }

    this.alertSprite = this._createAlertSprite()
    this.alertSprite.position.set(0, 2.3, 0)
    this.alertSprite.visible = false
    this.group.add(this.alertSprite)

    this.group.position.copy(basePos)
    scene.add(this.group)

    if (this.generatedAsCavalry) {
      const mountType = Math.random() < 0.5 ? MountType.BLACK_CAT : MountType.CORGI
      this.mount = new Mount(scene, mountType, spawnX, spawnZ, basePos.y)
      this.mount.setNpcRider(this, this.faction)
      this._syncToMount()
    }
  }

  /** Releases this NPC from its mount and returns it to a normal walking body. */
  dismountFromMount(): void {
    if (!this.mount) return
    const mountPosition = this.mount.group.position.clone()
    this.mount.releaseRider()
    this.mount = null
    this.group.position.copy(mountPosition)
  }

  private _buildLance(): void {
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x5c4033, flatShading: true })
    const headMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa, flatShading: true })

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 8), poleMat)
    pole.position.y = 0.75
    this.swordPivot.add(pole)

    const head = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.6, 8), headMat)
    head.position.y = 2.3
    head.castShadow = true
    this.swordPivot.add(head)
  }

  private _buildSword(faction: Faction, tier: number): void {
    if (faction === Faction.PLAYER) {
      // Viking Steel Sword (T2)
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9, roughness: 0.2 })
      const handleMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e })
      const guardMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7 })

      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 8), handleMat)
      handle.position.y = 0.09
      this.swordPivot.add(handle)

      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.06), guardMat)
      guard.position.y = 0.2
      this.swordPivot.add(guard)

      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.015), bladeMat)
      blade.position.y = 0.62
      this.swordPivot.add(blade)
    } else {
      // Roman Gladius
      let bladeColor = 0x888888 // T1 Rusty
      let bladeLength = 0.6
      let bladeWidth = 0.08
      let metalness = 0.4
      let emissive = 0x000000

      if (tier === 2) {
        bladeColor = 0xcccccc // Standard
        metalness = 0.8
      } else if (tier === 3) {
        bladeColor = 0xffffcc // Centurion
        bladeLength = 0.75
        bladeWidth = 0.1
        metalness = 1.0
        emissive = 0x555500
      }

      const bladeMat = new THREE.MeshStandardMaterial({ color: bladeColor, metalness, roughness: 0.2, emissive })
      const handleMat = new THREE.MeshLambertMaterial({ color: 0x3a1e00 })
      const pommelMat = new THREE.MeshStandardMaterial({ color: tier === 3 ? 0xd4af37 : 0x444444, metalness: 0.8 })

      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), pommelMat)
      this.swordPivot.add(pommel)

      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.15, 8), handleMat)
      handle.position.y = 0.1
      this.swordPivot.add(handle)

      const guard = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), pommelMat)
      guard.scale.set(1, 0.4, 0.6)
      guard.position.y = 0.2
      this.swordPivot.add(guard)

      const blade = new THREE.Mesh(new THREE.BoxGeometry(bladeWidth, bladeLength, 0.02), bladeMat)
      blade.position.y = 0.2 + bladeLength / 2
      this.swordPivot.add(blade)
      
      const tip = new THREE.Mesh(new THREE.ConeGeometry(bladeWidth / 2, 0.1, 4), bladeMat)
      tip.rotation.y = Math.PI / 4
      tip.position.y = 0.2 + bladeLength + 0.05
      this.swordPivot.add(tip)
    }
  }

  private _buildBow() {
    if (this.faction === Faction.ENEMY) {
      // Roman Pilum (Javelin)
      const woodMat = new THREE.MeshLambertMaterial({ color: 0x5c3a21, flatShading: true })
      const ironMat = new THREE.MeshLambertMaterial({ color: 0x777777, flatShading: true })
      const goldMat = new THREE.MeshLambertMaterial({ color: 0xd4af37, flatShading: true })

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 6), woodMat)
      shaft.position.y = 0.6
      this.bowPivot.add(shaft)

      if (this.tier === 1) {
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), ironMat)
        head.position.y = 1.275
        this.bowPivot.add(head)
      } else if (this.tier === 2) {
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.015, 0.4, 4), ironMat)
        neck.position.y = 1.4
        this.bowPivot.add(neck)
        
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 4), ironMat)
        head.position.y = 1.65
        this.bowPivot.add(head)
      } else {
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.5, 4), ironMat)
        neck.position.y = 1.45
        this.bowPivot.add(neck)
        
        const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), goldMat)
        wrap.position.y = 1.2
        this.bowPivot.add(wrap)

        const head = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 4), ironMat)
        head.position.y = 1.775
        this.bowPivot.add(head)
      }

    } else {
      // Viking Bow
      const bowMat = new THREE.MeshLambertMaterial({ color: 0x5c3a21, flatShading: true })
      const stringMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, flatShading: true })

      const upperCurve = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.5, 6), bowMat)
      upperCurve.position.set(0, 0.25, 0)
      upperCurve.rotation.z = -0.1
      this.bowPivot.add(upperCurve)

      const lowerCurve = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.015, 0.5, 6), bowMat)
      lowerCurve.position.set(0, -0.25, 0)
      lowerCurve.rotation.z = 0.1
      this.bowPivot.add(lowerCurve)

      const bowString = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1.0, 4), stringMat)
      bowString.position.set(0.05, 0, 0)
      this.bowPivot.add(bowString)
    }
  }

  private _createAlertSprite(): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!

    ctx.fillStyle = '#ffeb3b'
    ctx.font = 'bold 52px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('!', 32, 32)

    const texture = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(0.8, 0.8, 1)
    return sprite
  }

  takeDamage(amount: number): boolean {
    if (this.state === AIState.DEAD) return false

    this.currentHp = Math.max(0, this.currentHp - amount)
    this.flashTimer = 0.15

    if (this.state === AIState.IDLE) {
      this.state = AIState.ALERT
      this.alertTimer = 0.4
      this.alertSprite.visible = true
    }

    if (this.currentHp <= 0) {
      this.dismountFromMount()
      this.state = AIState.DEAD
      this.respawnTimer = RESPAWN_TIME
      this.alertSprite.visible = false
    }
    return true
  }

  private _findTarget(player: Player, allNPCs: NPC[]): { position: THREE.Vector3, isDead: boolean, isPlayer: boolean, npc?: NPC } | null {
    let closestTarget = null
    let closestDist = Infinity

    // Check Player
    if (this.faction === Faction.ENEMY && !player.dead) {
      const d = this.combatPosition.distanceTo(player.combatPosition)
      if (d < closestDist) {
        closestDist = d
        closestTarget = { position: player.combatPosition, isDead: player.dead, isPlayer: true }
      }
    }

    // Check NPCs
    for (const npc of allNPCs) {
      if (npc === this || npc.dead || npc.faction === this.faction) continue
      const d = this.combatPosition.distanceTo(npc.combatPosition)
      if (d < closestDist) {
        closestDist = d
        closestTarget = { position: npc.combatPosition, isDead: npc.dead, isPlayer: false, npc }
      }
    }

    return closestTarget
  }

  update(
    dt: number,
    player: Player,
    allNPCs: NPC[],
    obstacles: ObstacleData[],
    _playerHpBar: HpBar,
    onHitEntity: (damage: number, isPlayer: boolean, targetNpc?: NPC) => void,
    onFireArrow: (origin: THREE.Vector3, direction: THREE.Vector3) => void
  ): void {
    const previousPosition = this.group.position.clone()
    if (this.mount) this.mount.beginControlledFrame()
    this.rightArm.rotation.set(0, 0, -0.12)
    this.leftArm.rotation.set(0, 0, 0.12)

    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      this.bodyMesh.material = this.flashMat
      this.headMesh.material = this.flashMat
    } else {
      this.bodyMesh.material = this.bodyMat
      this.headMesh.material = this.headMat
    }

    const targetInfo = this._findTarget(player, allNPCs)

    switch (this.state) {
      case AIState.IDLE: {
        this.alertSprite.visible = false
        this._updatePatrol(dt, obstacles)

        if (targetInfo && !targetInfo.isDead) {
          const dist = this.combatPosition.distanceTo(targetInfo.position)
          if (dist <= DETECTION_RADIUS) {
            this.state = AIState.ALERT
            this.alertTimer = 0.6
            this.alertSprite.visible = true
          }
        }
        break
      }

      case AIState.ALERT: {
        this.alertTimer -= dt
        if (targetInfo) this._faceTarget(targetInfo.position)

        if (this.alertTimer <= 0) {
          this.alertSprite.visible = false
          this.state = AIState.CHASE
        }
        break
      }

      case AIState.CHASE: {
        this.alertSprite.visible = false
        if (!targetInfo || targetInfo.isDead) {
          this.state = AIState.IDLE
          break
        }

        const dist = this.combatPosition.distanceTo(targetInfo.position)
        if (dist > DETECTION_RADIUS * 1.5) {
          this.state = AIState.IDLE
          break
        }

        let moveDir = new THREE.Vector3()

        if (this.arrows > 0) {
          // Ranged behavior
          if (dist <= RANGED_ATTACK_MAX && dist >= RANGED_ATTACK_MIN) {
            this.state = AIState.ATTACK
            this.attackTimer = 0
            break
          } else if (dist < RANGED_ATTACK_MIN) {
            // Flee (move backwards)
            moveDir.copy(this.group.position).sub(targetInfo.position)
          } else {
            // Approach
            moveDir.copy(targetInfo.position).sub(this.group.position)
          }
        } else {
          // Melee behavior
          if (dist <= this.meleeAttackRadius) {
            this.state = AIState.ATTACK
            this.attackTimer = 0
            this.attackHitProcessed = false
            break
          }
          // Approach
          moveDir.copy(targetInfo.position).sub(this.group.position)
        }

        moveDir.y = 0
        moveDir.normalize()

        // Boid separation (prevent overlapping with other NPCs)
        const sep = new THREE.Vector3()
        let sepCount = 0
        for (const other of allNPCs) {
          if (other === this || other.dead) continue
          const d = this.group.position.distanceTo(other.position)
          if (d < 1.2) {
            const push = this.group.position.clone().sub(other.position)
            push.y = 0
            sep.add(push.normalize().multiplyScalar(1.5 / Math.max(0.1, d)))
            sepCount++
          }
        }
        if (sepCount > 0) {
          sep.divideScalar(sepCount)
          moveDir.add(sep).normalize()
        }

        moveDir.copy(getObstacleAvoidanceDirection(this.group.position, moveDir, 0.5, 2.3, 0, obstacles))

        // Move towards target / flee + separation
        this._moveByDirection(moveDir, this.mount ? this.mount.baseSpeed : CHASE_SPEED, dt)
        
        // Map boundary clamp
        this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -95, 95)
        this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -95, 95)
        
        this._faceTarget(targetInfo.position)
        break
      }

      case AIState.ATTACK: {
        if (!targetInfo || targetInfo.isDead) {
          this.state = AIState.CHASE
          break
        }
        
        this._faceTarget(targetInfo.position)
        
        // Mounted Archers can move while attacking
        if (this.isMounted && this.arrows > 0) {
          const dist = this.combatPosition.distanceTo(targetInfo.position)
          let moveDir = new THREE.Vector3()
          if (dist < RANGED_ATTACK_MIN) {
            moveDir.copy(this.group.position).sub(targetInfo.position)
          } else if (dist > RANGED_ATTACK_MAX) {
            moveDir.copy(targetInfo.position).sub(this.group.position)
          } else {
            // Orbit target
            moveDir.copy(targetInfo.position).sub(this.group.position).cross(new THREE.Vector3(0,1,0))
          }
          moveDir.y = 0
          if (moveDir.lengthSq() > 0.001) {
             moveDir.normalize()
             moveDir.copy(getObstacleAvoidanceDirection(this.group.position, moveDir, 0.5, 2.3, 0, obstacles))
             this._moveByDirection(moveDir, this.mount ? this.mount.baseSpeed : CHASE_SPEED, dt)
          }
        }

        this.attackTimer += dt
        if (this.arrows > 0) {
          // Ranged Attack (Bow draw / Pilum throw animation)
          const progress = Math.min(1, this.attackTimer / RANGED_COOLDOWN)
          
          if (this.faction === Faction.PLAYER) {
            // Rotate bow up to aim (simulate drawing)
            this.bowPivot.rotation.z = THREE.MathUtils.lerp(-0.1, -0.6, progress) // raise bow
            this.bowPivot.rotation.x = THREE.MathUtils.lerp(0, 0.2, progress)   // tilt slightly
          } else {
            // Pilum throw animation (wind up)
            this.bowPivot.rotation.x = THREE.MathUtils.lerp(0, Math.PI / 4, progress) 
          }
          this.rightArm.rotation.set(THREE.MathUtils.lerp(-0.35, -0.85, progress), 0, -0.18)
          this.leftArm.rotation.set(THREE.MathUtils.lerp(-0.2, -0.45, progress), 0, 0.16)

          if (this.attackTimer >= RANGED_COOLDOWN) {
            // Reset rotation
            if (this.faction === Faction.PLAYER) {
              this.bowPivot.rotation.set(0, 0, -0.1)
            } else {
              this.bowPivot.rotation.set(0, 0, 0)
            }

            // Fire arrow
            const origin = this.group.position.clone()
            origin.y += 1.0 // Chest height

            // Aim at head (y + 1.8) and compensate for gravity based on distance
            const targetCenter = targetInfo.position.clone()
            targetCenter.y += 1.8 // Aim even higher than head
            const dist = origin.distanceTo(targetCenter)
            
            const dir = targetCenter.sub(origin)
            // Gravity compensation approx (upward angle based on distance)
            dir.y += dist * 0.25 
            dir.normalize()
            onFireArrow(origin, dir)

            this.arrows -= 1
            if (this.arrows === 0) {
              // Switch to melee mode
              this.swordPivot.visible = true
              this.bowPivot.visible = false
            }

            this.attackTimer = 0
            this.state = AIState.CHASE
          }
        } else {
          // Melee Attack
          const progress = Math.min(1, this.attackTimer / MELEE_COOLDOWN)

          if (progress < 0.4) {
            const t = progress / 0.4
            this.swordPivot.rotation.x = THREE.MathUtils.lerp(0, -Math.PI / 2, t)
            this.rightArm.rotation.x = THREE.MathUtils.lerp(-0.2, -0.95, t)
          } else if (progress < 0.7) {
            const t = (progress - 0.4) / 0.3
            this.swordPivot.rotation.x = THREE.MathUtils.lerp(-Math.PI / 2, Math.PI / 3, t)
            this.rightArm.rotation.x = THREE.MathUtils.lerp(-0.95, 0.55, t)

            if (!this.attackHitProcessed && progress >= 0.5) {
              const currentDist = this.combatPosition.distanceTo(targetInfo.position)
              if (currentDist <= this.meleeAttackRadius + 0.4) {
                this.attackHitProcessed = true
                let finalDamage = this.meleeDamage
                if (this.isUsingLance && this.isMounted && this.mount && this.mount.movementSpeed > 10) {
                  finalDamage *= 3.0
                  this.mount.skipImpactThisFrame = true
                }
                onHitEntity(finalDamage, targetInfo.isPlayer, targetInfo.npc)
              }
            }
          } else {
            const t = (progress - 0.7) / 0.3
            this.swordPivot.rotation.x = THREE.MathUtils.lerp(Math.PI / 3, 0, t)
            this.rightArm.rotation.x = THREE.MathUtils.lerp(0.55, 0, t)
          }

          if (this.attackTimer >= MELEE_COOLDOWN) {
            const dist = this.combatPosition.distanceTo(targetInfo.position)
            if (dist <= this.meleeAttackRadius) {
              this.attackTimer = 0
              this.attackHitProcessed = false
            } else {
              this.state = AIState.CHASE
            }
          }
        }
        break
      }

      case AIState.DEAD: {
        this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, Math.PI / 2, dt * 8)
        this.respawnTimer -= dt
        if (this.respawnTimer <= 0) {
          this.respawn()
        }
        break
      }
    }

    if (this.state !== AIState.DEAD && this.mount) {
      this.mount.finishControlledFrame(dt, obstacles)
      this._syncToMount()
    } else if (this.state !== AIState.DEAD) {
      // NPCs use the same terrain/platform gravity as the player and mounts.
      const terrainY = getTerrainHeight(this.group.position.x, this.group.position.z)
      this.velY += -22 * dt
      this.group.position.y += this.velY * dt
      if (this.group.position.y <= terrainY) {
        this.group.position.y = terrainY
        this.velY = 0
        this.onGround = true
      } else {
        this.onGround = false
      }

      const collision = resolveObstacleCollision(
        this.group.position,
        previousPosition,
        this.velY,
        this.onGround,
        0.5,
        2.3,
        0,
        obstacles,
      )
      this.velY = collision.velocityY
      this.onGround = collision.onGround
      
      // Global Map boundary clamp for foot NPCs
      this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -95, 95)
      this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -95, 95)
    }
  }

  private _updatePatrol(dt: number, obstacles: ObstacleData[]): void {
    const target = this.waypoints[this.currentWaypointIdx]
    const dist = this.group.position.distanceTo(target)

    if (dist < 0.5) {
      this.currentWaypointIdx = (this.currentWaypointIdx + 1) % this.waypoints.length
    } else {
      const dir = target.clone().sub(this.group.position)
      dir.y = 0
      dir.normalize()
      dir.copy(getObstacleAvoidanceDirection(this.group.position, dir, 0.5, 2.3, 0, obstacles))
      this._moveByDirection(dir, this.mount ? this.mount.baseSpeed : PATROL_SPEED, dt)
      this._faceTarget(target)
    }
  }

  private _moveByDirection(direction: THREE.Vector3, speed: number, dt: number): void {
    if (this.mount) {
      this.mount.addControlledMovement(direction, speed, dt)
    } else {
      this.group.position.addScaledVector(direction, speed * dt)
    }
  }

  private _syncToMount(): void {
    if (!this.mount) return
    this.group.position.copy(this.mount.group.position)
    this.group.position.y += 1.65
    this.group.rotation.y = this.mount.group.rotation.y
  }

  private _faceTarget(targetPos: THREE.Vector3): void {
    const dir = targetPos.clone().sub(this.group.position)
    dir.y = 0
    if (dir.lengthSq() > 0.001) {
      const targetAngle = Math.atan2(dir.x, dir.z)
      this.group.rotation.y = targetAngle
      if (this.mount) this.mount.group.rotation.y = targetAngle
    }
  }

  respawn(): void {
    this.state = AIState.IDLE
    this.currentHp = this.maxHp
    if (this.aiType === AIType.RANGED) {
      this.arrows = 1
      this.swordPivot.visible = false
      this.bowPivot.visible = true
    } else {
      this.arrows = 0
      this.swordPivot.visible = true
      this.bowPivot.visible = false
    }

    const terrainY = getTerrainHeight(this.spawnX, this.spawnZ)
    this.group.position.set(this.spawnX, terrainY, this.spawnZ)
    this.velY = 0
    this.onGround = true
    this.group.rotation.set(0, 0, 0)
    this.swordPivot.rotation.set(0, 0, 0)
    this.alertSprite.visible = false
  }
}
