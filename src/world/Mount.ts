import * as THREE from 'three'
import { getObstacleAvoidanceDirection, getTerrainHeight, ObstacleData, resolveObstacleCollision } from './Terrain'
import type { Faction, NPC } from './NPC'

export enum MountType {
  BLACK_CAT = 'BLACK_CAT',
  CORGI = 'CORGI',
}

export enum MountState {
  IDLE = 'IDLE',
  WANDER = 'WANDER',
  CONTROLLED = 'CONTROLLED',
  DEAD = 'DEAD',
}

export class Mount {
  readonly group: THREE.Group
  readonly type: MountType

  public maxHp: number = 100
  public currentHp: number = 100
  public baseSpeed: number = 12 // Faster than player walk (8)
  
  public state: MountState = MountState.IDLE
  public riderNpc: NPC | null = null
  public riderFaction: Faction | null = null
  public previousPosition = new THREE.Vector3()
  public movementSpeed = 0
  public isSprinting = false
  public skipImpactThisFrame = false

  private impactTimes = new Map<object, number>()
  
  private wanderTimer = 0
  private wanderTarget = new THREE.Vector3()

  // For jumping
  public velY = 0
  public onGround = false

  public deathTimer: number = 3.0

  // Riding visual offsets
  public rideHeightOffset: number = 1.6
  public ridePitch: number = 0.4

  constructor(scene: THREE.Scene, type: MountType, x: number, z: number, y?: number) {
    this.type = type
    this.group = new THREE.Group()
    this.group.name = 'mount_' + type

    if (type === MountType.BLACK_CAT) {
      this.baseSpeed = 13.2 // 10% faster
      this._buildBlackCat()
    } else {
      this.baseSpeed = 12
      this._buildCorgi()
    }

    const startY = y !== undefined ? y : getTerrainHeight(x, z)
    this.group.position.set(x, startY, z)
    this.previousPosition.copy(this.group.position)
    this.group.scale.set(2.2, 2.2, 2.2)
    scene.add(this.group)
    
    this._pickWanderTarget()
  }

  get dead(): boolean { return this.state === MountState.DEAD }
  get availableForPlayer(): boolean {
    return !this.dead && this.state !== MountState.CONTROLLED && this.riderNpc === null
  }

  /** Short display name, e.g. '黑貓' or '柯基' */
  get displayName(): string {
    return this.type === MountType.BLACK_CAT ? '黑貓' : '柯基'
  }

  /** Full combat display name, e.g. '黑貓坐騎' or '柯基坐騎' */
  get mountDisplayName(): string {
    return this.type === MountType.BLACK_CAT ? '黑貓坐騎' : '柯基坐騎'
  }

  setNpcRider(npc: NPC, faction: Faction): void {
    if (this.dead) return
    this.riderNpc = npc
    this.riderFaction = faction
    this.state = MountState.CONTROLLED
  }

  releaseRider(): void {
    this.riderNpc = null
    this.riderFaction = null
    if (!this.dead) this.state = MountState.IDLE
  }

  takeDamage(amount: number): boolean {
    if (this.dead) return false
    this.currentHp = Math.max(0, this.currentHp - amount)
    if (this.currentHp <= 0) {
      this.state = MountState.DEAD
      this.riderNpc = null
      this.riderFaction = null
    }
    return true
  }

  beginControlledFrame(): void {
    this.previousPosition.copy(this.group.position)
    this.movementSpeed = 0
  }

  addControlledMovement(direction: THREE.Vector3, speed: number, dt: number): void {
    if (this.dead || direction.lengthSq() === 0) return
    this.group.position.addScaledVector(direction, speed * dt)
  }

  finishControlledFrame(dt: number, obstacles: ObstacleData[]): void {
    if (this.dead) return

    const ty = getTerrainHeight(this.group.position.x, this.group.position.z)
    this.velY += -22 * dt
    this.group.position.y += this.velY * dt

    if (this.group.position.y <= ty) {
      this.group.position.y = ty
      this.velY = 0
      this.onGround = true
    } else {
      this.onGround = false
    }

    const collision = resolveObstacleCollision(
      this.group.position,
      this.previousPosition,
      this.velY,
      this.onGround,
      1.0,
      2.6,
      0,
      obstacles,
    )
    this.velY = collision.velocityY
    this.onGround = collision.onGround
    
    // Map boundary clamp
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -95, 95)
    this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -95, 95)

    this.movementSpeed = this.previousPosition.distanceTo(this.group.position) / Math.max(dt, 0.0001)
  }

  canImpact(target: object, now: number): boolean {
    const lastImpact = this.impactTimes.get(target) ?? -Infinity
    if (now - lastImpact < 0.6) return false
    this.impactTimes.set(target, now)
    return true
  }

  private _buildBlackCat() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x111111, flatShading: true })
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0xffff00, flatShading: true })
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 })

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 1.2), mat)
    body.position.y = 0.4
    body.castShadow = true
    this.group.add(body)

    // Saddle
    const saddleMat = new THREE.MeshLambertMaterial({ color: 0x8B4513, flatShading: true })
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.4), saddleMat)
    saddle.position.set(0, 0.65, 0.1) // slightly back
    this.group.add(saddle)
    
    this.rideHeightOffset = 1.3
    this.ridePitch = 0.4

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.4), mat)
    head.position.set(0, 0.8, 0.7)
    head.castShadow = true
    this.group.add(head)

    // Big Eyes
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.1), eyeMat)
    eyeL.position.set(0.12, 0.05, 0.2)
    head.add(eyeL)
    
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.1), eyeMat)
    eyeR.position.set(-0.12, 0.05, 0.2)
    head.add(eyeR)

    // Pupils
    const pupilL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.11), pupilMat)
    pupilL.position.set(0.12, 0.05, 0.21)
    head.add(pupilL)

    const pupilR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.11), pupilMat)
    pupilR.position.set(-0.12, 0.05, 0.21)
    head.add(pupilR)

    // Ears
    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), mat)
    earL.position.set(0.18, 0.3, 0)
    earL.rotation.z = -0.2
    head.add(earL)
    
    const earR = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), mat)
    earR.position.set(-0.18, 0.3, 0)
    earR.rotation.z = 0.2
    head.add(earR)

    // Whiskers
    const whiskerMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    for (let i = 0; i < 2; i++) {
      const wL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.02), whiskerMat)
      wL.position.set(0.25, -0.05 + i * 0.08, 0.18)
      wL.rotation.z = -0.1 + i * 0.2
      head.add(wL)

      const wR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.02), whiskerMat)
      wR.position.set(-0.25, -0.05 + i * 0.08, 0.18)
      wR.rotation.z = 0.1 - i * 0.2
      head.add(wR)
    }
  }

  private _buildCorgi() {
    const orangeMat = new THREE.MeshLambertMaterial({ color: 0xd97c2e, flatShading: true })
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })
    
    // Body (long)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 1.3), orangeMat)
    body.position.y = 0.35
    body.castShadow = true
    this.group.add(body)

    // Saddle
    const saddleMat = new THREE.MeshLambertMaterial({ color: 0x8B4513, flatShading: true })
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.4), saddleMat)
    saddle.position.set(0, 0.58, 0.1) // slightly back
    this.group.add(saddle)

    this.rideHeightOffset = 1.15
    this.ridePitch = 0.4

    // White belly
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.2, 1.2), whiteMat)
    belly.position.y = 0.25
    this.group.add(belly)

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), orangeMat)
    head.position.set(0, 0.7, 0.7)
    head.castShadow = true
    this.group.add(head)

    // Snout
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.2), whiteMat)
    snout.position.set(0, -0.05, 0.25)
    head.add(snout)

    // Nose
    const blackMat = new THREE.MeshBasicMaterial({ color: 0x000000 })
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.05), blackMat)
    nose.position.set(0, 0.05, 0.1)
    snout.add(nose)

    // Eyes
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), blackMat)
    eyeL.position.set(0.12, 0.1, 0.21)
    head.add(eyeL)

    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), blackMat)
    eyeR.position.set(-0.12, 0.1, 0.21)
    head.add(eyeR)

    // Ears (Upright and larger)
    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), orangeMat)
    earL.position.set(0.18, 0.35, 0)
    earL.rotation.z = -0.1
    head.add(earL)
    
    const earR = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), orangeMat)
    earR.position.set(-0.18, 0.35, 0)
    earR.rotation.z = 0.1
    head.add(earR)

    // Short legs
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.12), whiteMat)
      const px = (i % 2 === 0) ? 0.2 : -0.2
      const pz = (i < 2) ? 0.4 : -0.4
      leg.position.set(px, 0.1, pz)
      this.group.add(leg)
    }
  }

  private _pickWanderTarget() {
    const angle = Math.random() * Math.PI * 2
    const dist = 5 + Math.random() * 15
    this.wanderTarget.set(
      this.group.position.x + Math.cos(angle) * dist,
      0,
      this.group.position.z + Math.sin(angle) * dist
    )
    
    // Clamp to map bounds
    this.wanderTarget.x = Math.max(-95, Math.min(95, this.wanderTarget.x))
    this.wanderTarget.z = Math.max(-95, Math.min(95, this.wanderTarget.z))
  }

  update(dt: number, obstacles: ObstacleData[]) {
    if (this.state === MountState.DEAD) {
      this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, Math.PI / 2, dt * 8)
      this.deathTimer -= dt
      if (this.deathTimer <= 0) {
        this.group.visible = false
      }
      return
    }

    if (this.state === MountState.CONTROLLED) return // Rider controls it

    this.beginControlledFrame()

    this.wanderTimer -= dt

    if (this.state === MountState.IDLE) {
      if (this.wanderTimer <= 0) {
        this.state = MountState.WANDER
        this.wanderTimer = 3 + Math.random() * 5
        this._pickWanderTarget()
      }
    } else if (this.state === MountState.WANDER) {
      if (this.wanderTimer <= 0) {
        this.state = MountState.IDLE
        this.wanderTimer = 2 + Math.random() * 4
      } else {
        // Move towards target
        const dir = new THREE.Vector3().subVectors(this.wanderTarget, this.group.position)
        dir.y = 0
        
        if (dir.length() > 0.5) {
          dir.normalize()
          dir.copy(getObstacleAvoidanceDirection(this.group.position, dir, 1.0, 2.6, 0, obstacles))
          const speed = 2.0 // Slow wander speed
          this.group.position.addScaledVector(dir, speed * dt)
          
          // Face direction
          const targetRotation = Math.atan2(dir.x, dir.z)
          // Simple lerp rotation
          const currentRotation = this.group.rotation.y
          const diff = targetRotation - currentRotation
          let normDiff = Math.atan2(Math.sin(diff), Math.cos(diff))
          this.group.rotation.y += normDiff * 5 * dt
        } else {
          this.state = MountState.IDLE
          this.wanderTimer = 2 + Math.random() * 4
        }
      }
    }

    this.finishControlledFrame(dt, obstacles)
  }
}
