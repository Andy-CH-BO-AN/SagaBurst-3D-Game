import * as THREE from 'three'
import { getTerrainHeight } from './Terrain'

export enum MountType {
  BLACK_CAT = 'BLACK_CAT',
  CORGI = 'CORGI',
}

export enum MountState {
  IDLE = 'IDLE',
  WANDER = 'WANDER',
  CONTROLLED = 'CONTROLLED',
}

export class Mount {
  readonly group: THREE.Group
  readonly type: MountType

  public maxHp: number = 100
  public currentHp: number = 100
  public baseSpeed: number = 12 // Faster than player walk (8)
  
  public state: MountState = MountState.IDLE
  
  private wanderTimer = 0
  private wanderTarget = new THREE.Vector3()

  // For jumping
  public velY = 0
  public onGround = false

  constructor(scene: THREE.Scene, type: MountType, x: number, z: number) {
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

    const y = getTerrainHeight(x, z)
    this.group.position.set(x, y, z)
    scene.add(this.group)
    
    this._pickWanderTarget()
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
    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), mat)
    earL.position.set(0.15, 0.25, 0)
    head.add(earL)
    
    const earR = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), mat)
    earR.position.set(-0.15, 0.25, 0)
    head.add(earR)
  }

  private _buildCorgi() {
    const orangeMat = new THREE.MeshLambertMaterial({ color: 0xd97c2e, flatShading: true })
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })
    
    // Body (long)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 1.3), orangeMat)
    body.position.y = 0.35
    body.castShadow = true
    this.group.add(body)

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

    // Ears (Upright)
    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 4), orangeMat)
    earL.position.set(0.15, 0.3, 0)
    head.add(earL)
    
    const earR = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 4), orangeMat)
    earR.position.set(-0.15, 0.3, 0)
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

  update(dt: number) {
    if (this.state === MountState.CONTROLLED) return // Player controls it

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

    // Gravity / Terrain snap (if wandering)
    const ty = getTerrainHeight(this.group.position.x, this.group.position.z)
    this.velY += -22 * dt // gravity
    this.group.position.y += this.velY * dt
    
    if (this.group.position.y <= ty) {
      this.group.position.y = ty
      this.velY = 0
      this.onGround = true
    } else {
      this.onGround = false
    }
  }
}
