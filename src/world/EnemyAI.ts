/**
 * EnemyAI.ts
 * Hostile AI Unit: "Bandit Warrior 野蠻人戰士".
 * Calibrated with getTerrainHeight(x, z) for procedural heightmap terrain.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Player } from '../player/Player'
import type { HpBar } from '../ui/HpBar'
import { getTerrainHeight } from './Terrain'

export enum AIState {
  IDLE = 'IDLE',
  ALERT = 'ALERT',
  CHASE = 'CHASE',
  ATTACK = 'ATTACK',
  DEAD = 'DEAD',
}

const DETECTION_RADIUS = 12.0
const ATTACK_RADIUS    = 1.8
const CHASE_SPEED      = 4.8
const PATROL_SPEED     = 2.2
const ATTACK_COOLDOWN  = 1.2
const RESPAWN_TIME     = 10.0

export class EnemyAI {
  readonly group: THREE.Group
  private bodyMesh: THREE.Mesh
  private headMesh: THREE.Mesh
  private hornLeft!: THREE.Mesh
  private hornRight!: THREE.Mesh
  private enemyModelGroup: THREE.Group
  private alertSprite: THREE.Sprite

  private macePivot: THREE.Group
  private bodyMat: THREE.MeshLambertMaterial
  private flashMat: THREE.MeshBasicMaterial

  readonly name = '野蠻人戰士 Bandit Warrior'
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

  get hp(): number { return this.currentHp }
  get hpRatio(): number { return Math.max(0, this.currentHp / this.maxHp) }
  get currentState(): AIState { return this.state }
  get dead(): boolean { return this.state === AIState.DEAD }
  get position(): THREE.Vector3 { return this.group.position }

  constructor(scene: THREE.Scene, spawnX = 18, spawnZ = -18) {
    this.spawnX = spawnX
    this.spawnZ = spawnZ

    // Calibrate waypoints to terrain height
    const baseTerrainY = getTerrainHeight(spawnX, spawnZ)
    const basePos = new THREE.Vector3(spawnX, baseTerrainY, spawnZ)

    const wp1 = new THREE.Vector3(spawnX - 10, getTerrainHeight(spawnX - 10, spawnZ - 8), spawnZ - 8)
    const wp2 = new THREE.Vector3(spawnX + 8, getTerrainHeight(spawnX + 8, spawnZ - 12), spawnZ - 12)
    this.waypoints = [basePos.clone(), wp1, wp2]

    this.group = new THREE.Group()
    this.group.name = 'enemy_ai'

    this.enemyModelGroup = new THREE.Group()
    this.group.add(this.enemyModelGroup)

    this.bodyMat  = new THREE.MeshLambertMaterial({ color: 0x3d352e })
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff })

    const bodyGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.3, 12)
    this.bodyMesh = new THREE.Mesh(bodyGeo, this.bodyMat)
    this.bodyMesh.position.y = 0.65
    this.bodyMesh.castShadow = true
    this.bodyMesh.visible = false
    this.group.add(this.bodyMesh)

    const headGeo = new THREE.SphereGeometry(0.38, 12, 8)
    this.headMesh = new THREE.Mesh(headGeo, this.bodyMat)
    this.headMesh.position.y = 1.55
    this.headMesh.castShadow = true
    this.headMesh.visible = false
    this.group.add(this.headMesh)

    const hornMat = new THREE.MeshLambertMaterial({ color: 0xc4b998 })
    this.hornLeft = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 6), hornMat)
    this.hornLeft.position.set(-0.32, 1.8, 0)
    this.hornLeft.rotation.z = 0.5
    this.hornLeft.visible = false
    this.group.add(this.hornLeft)

    this.hornRight = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 6), hornMat)
    this.hornRight.position.set(0.32, 1.8, 0)
    this.hornRight.rotation.z = -0.5
    this.hornRight.visible = false
    this.group.add(this.hornRight)

    this.macePivot = new THREE.Group()
    this.group.add(this.macePivot)

    const loader = new GLTFLoader()
    loader.load('/models/characters/enemy.glb', (gltf) => {
      const model = gltf.scene
      model.scale.set(1.0, 1.0, 1.0)
      model.position.y = 0
      model.rotation.y = Math.PI

      let rightHandBone: THREE.Object3D | null = null

      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true
          child.receiveShadow = true
          const nameLower = child.name.toLowerCase()
          if (nameLower.includes('sword') || nameLower.includes('shield')) {
            child.visible = false
          }
        }
        if (child.name === 'handslot.r' || child.name === 'hand.r' || child.name === 'mixamorig:RightHand' || child.name === 'RightHand') {
          rightHandBone = child
        }
      })

      if (rightHandBone) {
        (rightHandBone as THREE.Object3D).add(this.macePivot)
        this.macePivot.position.set(0, 0, 0)
        this.macePivot.rotation.set(Math.PI / 2, 0, 0)
      }

      this.enemyModelGroup.add(model)
    }, undefined, () => {
      if (this.bodyMesh) this.bodyMesh.visible = true
      if (this.headMesh) this.headMesh.visible = true
      if (this.hornLeft) this.hornLeft.visible = true
      if (this.hornRight) this.hornRight.visible = true
    })

    loader.load('/models/weapons/sword.glb', (gltf) => {
      while (this.macePivot.children.length > 0) {
        this.macePivot.remove(this.macePivot.children[0])
      }
      const sword = gltf.scene
      sword.scale.set(0.7, 0.7, 0.7)
      sword.rotation.set(Math.PI / 2, 0, Math.PI / 2)
      sword.position.set(0, 0, 0)
      this.macePivot.add(sword)
    })

    this.alertSprite = this._createAlertSprite()
    this.alertSprite.position.set(0, 2.3, 0)
    this.alertSprite.visible = false
    this.group.add(this.alertSprite)

    this.group.position.copy(basePos)
    scene.add(this.group)
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
      this.state = AIState.DEAD
      this.respawnTimer = RESPAWN_TIME
      this.alertSprite.visible = false
    }
    return true
  }

  update(
    dt: number,
    player: Player,
    _playerHpBar: HpBar,
    onHitPlayer: (damage: number) => void
  ): void {

    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      this.bodyMesh.material = this.flashMat
      this.headMesh.material = this.flashMat
    } else {
      this.bodyMesh.material = this.bodyMat
      this.headMesh.material = this.bodyMat
    }

    switch (this.state) {

      case AIState.IDLE: {
        this.alertSprite.visible = false
        this._updatePatrol(dt)

        const distToPlayer = this.group.position.distanceTo(player.position)
        if (distToPlayer <= DETECTION_RADIUS && !player.dead) {
          this.state = AIState.ALERT
          this.alertTimer = 0.6
          this.alertSprite.visible = true
        }
        break
      }

      case AIState.ALERT: {
        this.alertTimer -= dt
        this._faceTarget(player.position)

        if (this.alertTimer <= 0) {
          this.alertSprite.visible = false
          this.state = AIState.CHASE
        }
        break
      }

      case AIState.CHASE: {
        this.alertSprite.visible = false
        const distToPlayer = this.group.position.distanceTo(player.position)

        if (player.dead || distToPlayer > DETECTION_RADIUS * 1.5) {
          this.state = AIState.IDLE
          break
        }

        if (distToPlayer <= ATTACK_RADIUS) {
          this.state = AIState.ATTACK
          this.attackTimer = 0
          this.attackHitProcessed = false
          break
        }

        // Chase towards player position while calibrating Y height to terrain
        const dir = player.position.clone().sub(this.group.position)
        dir.y = 0
        dir.normalize()

        this.group.position.addScaledVector(dir, CHASE_SPEED * dt)
        this.group.position.y = getTerrainHeight(this.group.position.x, this.group.position.z)
        this._faceTarget(player.position)
        break
      }

      case AIState.ATTACK: {
        this._faceTarget(player.position)
        this.attackTimer += dt

        // Keep attached to terrain
        this.group.position.y = getTerrainHeight(this.group.position.x, this.group.position.z)

        const progress = Math.min(1, this.attackTimer / ATTACK_COOLDOWN)

        if (progress < 0.4) {
          const t = progress / 0.4
          this.macePivot.rotation.x = THREE.MathUtils.lerp(0, -Math.PI / 2, t)
        } else if (progress < 0.7) {
          const t = (progress - 0.4) / 0.3
          this.macePivot.rotation.x = THREE.MathUtils.lerp(-Math.PI / 2, Math.PI / 3, t)

          if (!this.attackHitProcessed && progress >= 0.5) {
            const currentDist = this.group.position.distanceTo(player.position)
            if (currentDist <= ATTACK_RADIUS + 0.4 && !player.dead) {
              this.attackHitProcessed = true
              onHitPlayer(15)
            }
          }
        } else {
          const t = (progress - 0.7) / 0.3
          this.macePivot.rotation.x = THREE.MathUtils.lerp(Math.PI / 3, 0, t)
        }

        if (this.attackTimer >= ATTACK_COOLDOWN) {
          const distToPlayer = this.group.position.distanceTo(player.position)
          if (distToPlayer <= ATTACK_RADIUS && !player.dead) {
            this.attackTimer = 0
            this.attackHitProcessed = false
          } else {
            this.state = AIState.CHASE
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
  }

  private _updatePatrol(dt: number): void {
    const target = this.waypoints[this.currentWaypointIdx]
    const dist = this.group.position.distanceTo(target)

    if (dist < 0.5) {
      this.currentWaypointIdx = (this.currentWaypointIdx + 1) % this.waypoints.length
    } else {
      const dir = target.clone().sub(this.group.position)
      dir.y = 0
      dir.normalize()
      this.group.position.addScaledVector(dir, PATROL_SPEED * dt)
      this.group.position.y = getTerrainHeight(this.group.position.x, this.group.position.z)
      this._faceTarget(target)
    }
  }

  private _faceTarget(targetPos: THREE.Vector3): void {
    const dir = targetPos.clone().sub(this.group.position)
    dir.y = 0
    if (dir.lengthSq() > 0.001) {
      const targetAngle = Math.atan2(dir.x, dir.z)
      this.group.rotation.y = targetAngle
    }
  }

  respawn(): void {
    this.state = AIState.IDLE
    this.currentHp = this.maxHp
    const terrainY = getTerrainHeight(this.spawnX, this.spawnZ)
    this.group.position.set(this.spawnX, terrainY, this.spawnZ)
    this.group.rotation.set(0, 0, 0)
    this.macePivot.rotation.set(0, 0, 0)
    this.alertSprite.visible = false
  }
}
