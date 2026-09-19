import * as THREE from 'three'
import { clampToPlayableWorld, getObstacleAvoidanceDirection, getTerrainHeight, ObstacleData, resolveObstacleCollision } from './Terrain'
import type { Faction, NPC } from './NPC'
import {
  HorseAssetRegistry,
  horseVariantFromSave,
  type HorseAppearanceVariant,
  type HorseAnimationState,
  type HorseDebugState,
  type HorseInstance,
} from './HorseAssetRegistry'
import { AIM_RAYCAST_LAYER } from './AimTargetRegistry'
import type { NpcSubphaseCollector } from '../debug/NpcSubphaseProfiler'

const MOUNT_AIM_GEOMETRY = new THREE.BoxGeometry(1.1, 1.65, 2.4)
const MOUNT_AIM_PROXY_MATERIAL = new THREE.MeshBasicMaterial()

export enum MountType {
  BLACK_CAT = 'BLACK_CAT',
  CORGI = 'CORGI',
  HORSE = 'HORSE',
}

export const DEFAULT_MOUNT_TYPE = MountType.HORSE

/**
 * The authored leather saddle spans local Z -0.02…0.53m, while its raw socket
 * is at Z -0.19m behind it. Keep the authored socket height and move the rider
 * forward to the visual saddle centre, while preserving the raw socket for
 * tack/camera attachments.
 */
export const HORSE_RIDER_PELVIS_SADDLE_FORWARD_OFFSET = 0.45

const horseRiderSeatWorldOffset = new THREE.Vector3()
const horseRiderSeatWorldQuaternion = new THREE.Quaternion()

export enum MountState {
  IDLE = 'IDLE',
  WANDER = 'WANDER',
  CONTROLLED = 'CONTROLLED',
  DEAD = 'DEAD',
}

export function mountTypeFromSave(value: string): MountType {
  if (value === MountType.BLACK_CAT) return MountType.BLACK_CAT
  if (value === MountType.CORGI) return MountType.CORGI
  if (value === MountType.HORSE) return MountType.HORSE
  return DEFAULT_MOUNT_TYPE
}

export class Mount {
  readonly group: THREE.Group
  readonly type: MountType
  readonly horseVisual: HorseInstance | null
  public appearanceVariant: HorseAppearanceVariant
  public readonly aimCollider: THREE.Mesh
  public readonly onDeathCallbacks: Array<(mount: Mount) => void> = []

  public maxHp = 100
  public currentHp = 100
  public baseSpeed = 12
  public state: MountState = MountState.IDLE
  public riderNpc: NPC | null = null
  public riderFaction: Faction | null = null
  public previousPosition = new THREE.Vector3()
  public movementSpeed = 0
  public isSprinting = false
  public skipImpactThisFrame = false
  public velY = 0
  public onGround = false
  public deathTimer = 3
  public rideHeightOffset = 1.6
  public ridePitch = 0.4
  public visualHold = false

  private impactTimes = new Map<object, number>()
  private wanderTimer = 0
  private wanderTarget = new THREE.Vector3()
  private cameraDistance = 0
  private hasGroundedOnce = false

  constructor(
    scene: THREE.Scene,
    type: MountType,
    x: number,
    z: number,
    y?: number,
    appearanceVariant: HorseAppearanceVariant = 0,
  ) {
    this.type = type
    this.appearanceVariant = type === MountType.HORSE ? horseVariantFromSave(appearanceVariant) : 0
    this.group = new THREE.Group()
    this.group.name = `mount_${type}`
    this.baseSpeed = type === MountType.BLACK_CAT ? 13.2 : 12

    if (type === MountType.HORSE) {
      if (!HorseAssetRegistry.ready) throw new Error('Horse assets were not preloaded')
      this.horseVisual = HorseAssetRegistry.createInstance({ variant: this.appearanceVariant })
      this.group.add(this.horseVisual.root)
      this.horseVisual.root.updateWorldMatrix(true, true)
      const saddleWorld = this.horseVisual.saddleSeat.getWorldPosition(new THREE.Vector3())
      this.rideHeightOffset = this.horseVisual.root.worldToLocal(saddleWorld).y
      this.ridePitch = 0.05
    } else {
      this.horseVisual = null
      if (type === MountType.BLACK_CAT) this._buildBlackCat()
      else this._buildCorgi()
    }

    const startY = y ?? getTerrainHeight(x, z)
    this.group.position.set(x, startY, z)
    this.previousPosition.copy(this.group.position)
    if (type !== MountType.HORSE) this.group.scale.set(2.2, 2.2, 2.2)

    this.aimCollider = new THREE.Mesh(MOUNT_AIM_GEOMETRY, MOUNT_AIM_PROXY_MATERIAL)
    this.aimCollider.name = `aim_proxy_mount_${type}`
    this.aimCollider.position.set(0, 0.825, 0)
    this.aimCollider.layers.set(AIM_RAYCAST_LAYER)
    this.group.add(this.aimCollider)

    scene.add(this.group)
    this._pickWanderTarget()
  }

  get dead(): boolean { return this.state === MountState.DEAD }
  get availableForPlayer(): boolean {
    return !this.dead && this.state !== MountState.CONTROLLED && this.riderNpc === null
  }
  get displayName(): string {
    if (this.type === MountType.HORSE) return '戰馬'
    return this.type === MountType.BLACK_CAT ? '黑貓' : '柯基'
  }
  get mountDisplayName(): string { return `${this.displayName}坐騎` }
  get horseSkeleton(): THREE.Skeleton | null { return this.horseVisual?.skeleton ?? null }

  getSaddleSeatLocal(target = new THREE.Vector3()): THREE.Vector3 {
    if (!this.horseVisual) return target.set(0, this.rideHeightOffset, 0)
    this.group.updateWorldMatrix(true, true)
    this.horseVisual.saddleSeat.getWorldPosition(target)
    return this.group.worldToLocal(target)
  }

  /** Visual rider seat: raw saddle socket adjusted to the saddle pan. */
  getRiderPelvisSeatLocal(target = new THREE.Vector3()): THREE.Vector3 {
    this.getSaddleSeatLocal(target)
    if (this.type === MountType.HORSE) {
      target.z += HORSE_RIDER_PELVIS_SADDLE_FORWARD_OFFSET
    }
    return target
  }

  getSaddleSeatWorld(target = new THREE.Vector3()): THREE.Vector3 {
    if (this.horseVisual) {
      return this.horseVisual.saddleSeat.getWorldPosition(target)
    }
    return target.copy(this.group.position).addScaledVector(THREE.Object3D.DEFAULT_UP, this.rideHeightOffset)
  }

  /** Visual rider seat: raw saddle socket adjusted to the saddle pan. */
  getRiderPelvisSeatWorld(target = new THREE.Vector3()): THREE.Vector3 {
    this.getSaddleSeatWorld(target)
    if (this.type === MountType.HORSE) {
      this.group.getWorldQuaternion(horseRiderSeatWorldQuaternion)
      target.add(horseRiderSeatWorldOffset
        .set(0, 0, HORSE_RIDER_PELVIS_SADDLE_FORWARD_OFFSET)
        .applyQuaternion(horseRiderSeatWorldQuaternion))
    }
    return target
  }

  setCameraDistance(distance: number): void {
    this.cameraDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0
  }

  startJump(velocity: number): void {
    if (this.dead || !this.onGround) return
    this.velY = velocity
    this.onGround = false
    this.horseVisual?.playOnce('jump')
  }

  playStudioClip(state: HorseAnimationState): void {
    this.horseVisual?.playStudioClip(state)
  }

  toggleStudioPause(): boolean {
    return this.horseVisual?.togglePaused() ?? false
  }

  getHorseDebugState(): HorseDebugState | null {
    return this.horseVisual?.debugState() ?? null
  }

  setAppearanceVariant(variant: HorseAppearanceVariant): void {
    if (!this.horseVisual) return
    this.appearanceVariant = horseVariantFromSave(variant)
    this.horseVisual.setAppearanceVariant(this.appearanceVariant)
  }

  setVisualHidden(hidden: boolean): void {
    if (this.horseVisual) {
      this.horseVisual.root.visible = !hidden
    }
  }

  isVisualHidden(): boolean {
    return this.horseVisual ? !this.horseVisual.root.visible : false
  }

  dispose(): void {
    this.horseVisual?.dispose()
    this.group.removeFromParent()
  }

  /**
   * DEV-only diagnostic hook to replace mount visual materials with simple diagnostic materials.
   */
  devApplySimpleMaterials(getDiagnosticMaterial: (sourceMat: THREE.Material, isSkinned: boolean) => THREE.Material): void {
    if (!import.meta.env.DEV) return
    const root = this.horseVisual?.root ?? this.group
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        const isSkinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => getDiagnosticMaterial(mat, isSkinned))
        } else if (mesh.material) {
          mesh.material = getDiagnosticMaterial(mesh.material, isSkinned)
        }
      }
    })
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
      this.horseVisual?.playDeath()
      for (const cb of this.onDeathCallbacks) cb(this)
    } else {
      this.horseVisual?.playOnce('hit')
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

  finishControlledFrame(
    dt: number,
    obstacles: ObstacleData[],
    collector: NpcSubphaseCollector | null = null,
  ): void {
    if (this.dead) return
    const wasOnGround = this.onGround
    if (import.meta.env.DEV && collector) { var _tPhysics = performance.now() }
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
    if (import.meta.env.DEV && collector) { collector.endPhase('mountPhysics', _tPhysics!) }

    if (import.meta.env.DEV && collector) { var _tObstacle = performance.now() }
    const collision = resolveObstacleCollision(
      this.group.position,
      this.previousPosition,
      this.velY,
      this.onGround,
      1,
      2.6,
      0,
      obstacles,
    )
    this.velY = collision.velocityY
    this.onGround = collision.onGround
    if (import.meta.env.DEV && collector) { collector.endPhase('mountObstacleCollision', _tObstacle!) }

    clampToPlayableWorld(this.group.position)
    this.movementSpeed = this.previousPosition.distanceTo(this.group.position) / Math.max(dt, 0.0001)
    if (this.horseVisual) {
      if (!wasOnGround && this.onGround && this.hasGroundedOnce) this.horseVisual.playOnce('land')
      this.hasGroundedOnce ||= this.onGround
      if (import.meta.env.DEV && collector) { var _tHorseAnimation = performance.now() }
      this.horseVisual.setLocomotion(this.movementSpeed)
      this.horseVisual.update(dt, this.cameraDistance)
      if (import.meta.env.DEV && collector) { collector.endPhase('mountHorseAnimation', _tHorseAnimation!) }
    }
  }

  canImpact(target: object, now: number): boolean {
    const lastImpact = this.impactTimes.get(target) ?? -Infinity
    if (now - lastImpact < 0.6) return false
    this.impactTimes.set(target, now)
    return true
  }

  /** Preserve the exact legacy procedural Black Cat used by existing saves. */
  private _buildBlackCat(): void {
    const material = new THREE.MeshLambertMaterial({ color: 0x111111, flatShading: true })
    const eyeMaterial = new THREE.MeshLambertMaterial({ color: 0xffff00, flatShading: true })
    const pupilMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 1.2), material)
    body.position.y = 0.4
    body.castShadow = true
    this.group.add(body)

    const saddle = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.1, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x8b4513, flatShading: true }),
    )
    saddle.position.set(0, 0.65, 0.1)
    this.group.add(saddle)
    this.rideHeightOffset = 1.3
    this.ridePitch = 0.4

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.4), material)
    head.position.set(0, 0.8, 0.7)
    head.castShadow = true
    this.group.add(head)

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.1), eyeMaterial)
      eye.position.set(side * 0.12, 0.05, 0.2)
      head.add(eye)

      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.11), pupilMaterial)
      pupil.position.set(side * 0.12, 0.05, 0.21)
      head.add(pupil)

      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), material)
      ear.position.set(side * 0.18, 0.3, 0)
      ear.rotation.z = side * -0.2
      head.add(ear)
    }

    const whiskerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
    for (let index = 0; index < 2; index++) {
      for (const side of [-1, 1]) {
        const whisker = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.02), whiskerMaterial)
        whisker.position.set(side * 0.25, -0.05 + index * 0.08, 0.18)
        whisker.rotation.z = side * (-0.1 + index * 0.2)
        head.add(whisker)
      }
    }
  }

  /** Preserve the exact legacy procedural Corgi used by existing saves. */
  private _buildCorgi(): void {
    const orangeMaterial = new THREE.MeshLambertMaterial({ color: 0xd97c2e, flatShading: true })
    const whiteMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })
    const blackMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 1.3), orangeMaterial)
    body.position.y = 0.35
    body.castShadow = true
    this.group.add(body)

    const saddle = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.1, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x8b4513, flatShading: true }),
    )
    saddle.position.set(0, 0.58, 0.1)
    this.group.add(saddle)
    this.rideHeightOffset = 1.15
    this.ridePitch = 0.4

    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.2, 1.2), whiteMaterial)
    belly.position.y = 0.25
    this.group.add(belly)

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), orangeMaterial)
    head.position.set(0, 0.7, 0.7)
    head.castShadow = true
    this.group.add(head)

    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.2), whiteMaterial)
    snout.position.set(0, -0.05, 0.25)
    head.add(snout)

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.05), blackMaterial)
    nose.position.set(0, 0.05, 0.1)
    snout.add(nose)

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), blackMaterial)
      eye.position.set(side * 0.12, 0.1, 0.21)
      head.add(eye)

      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), orangeMaterial)
      ear.position.set(side * 0.18, 0.35, 0)
      ear.rotation.z = side * -0.1
      head.add(ear)
    }

    for (let index = 0; index < 4; index++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.12), whiteMaterial)
      leg.position.set(index % 2 === 0 ? 0.2 : -0.2, 0.1, index < 2 ? 0.4 : -0.4)
      this.group.add(leg)
    }
  }

  private _pickWanderTarget(): void {
    const angle = Math.random() * Math.PI * 2
    const distance = 5 + Math.random() * 15
    this.wanderTarget.set(
      this.group.position.x + Math.cos(angle) * distance,
      0,
      this.group.position.z + Math.sin(angle) * distance,
    )
    clampToPlayableWorld(this.wanderTarget)
  }

  update(dt: number, obstacles: ObstacleData[]): void {
    if (this.state === MountState.DEAD) {
      if (this.horseVisual) this.horseVisual.update(dt, this.cameraDistance)
      else this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, Math.PI / 2, dt * 8)
      this.deathTimer -= dt
      if (this.deathTimer <= 0) this.group.visible = false
      return
    }
    if (this.state === MountState.CONTROLLED) return

    if (this.visualHold) {
      this.onGround = true
      if (this.horseVisual) this.horseVisual.update(dt, this.cameraDistance)
      return
    }

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
        const direction = new THREE.Vector3().subVectors(this.wanderTarget, this.group.position)
        direction.y = 0
        if (direction.length() > 0.5) {
          direction.normalize()
          direction.copy(getObstacleAvoidanceDirection(this.group.position, direction, 1, 2.6, 0, obstacles))
          this.group.position.addScaledVector(direction, 2 * dt)
          const targetRotation = Math.atan2(direction.x, direction.z)
          const delta = Math.atan2(Math.sin(targetRotation - this.group.rotation.y), Math.cos(targetRotation - this.group.rotation.y))
          this.group.rotation.y += delta * 5 * dt
        } else {
          this.state = MountState.IDLE
          this.wanderTimer = 2 + Math.random() * 4
        }
      }
    }
    this.finishControlledFrame(dt, obstacles)
  }
}
