/**
 * ArrowProjectile.ts
 * Arrow projectile with realistic parabolic gravity trajectory and hit detection on all targetable entities based on Factions.
 */
import * as THREE from 'three'
import { NPC, Faction } from './NPC'
import type { Player } from '../player/Player'
import { getTerrainHeight, type ObstacleData } from './Terrain'
import { traceCombatSegment, segmentBoxTime, type CombatContact } from '../combat/ShieldBlocking'
import { damageMount, damageNpc, damageObstacle, type DamageResult } from '../combat/DamageRouter'
import type { Mount } from './Mount'
import type {
  CombatActorRef,
  CombatDamageContext,
  CombatEventSink,
} from '../combat/CombatAttribution'
import { proceduralMaterial } from './ProceduralMaterials'
import type { DamageableObstacle } from './DamageableObstacle'

const GRAVITY = -9.8 // m/s² downforce for arrow arc
const ARROW_LOCAL_FORWARD = new THREE.Vector3(0, 0, -1)
export type ProjectileVisualKind = 'arrow' | 'pilum'

export interface ProjectileAttribution {
  source: CombatActorRef
  weaponId?: string
  emit?: CombatEventSink
}

interface SharedProjectileVisuals {
  woodMaterial: THREE.Material
  ironMaterial: THREE.Material
  bronzeMaterial: THREE.Material
  featherMaterial: THREE.Material
  arrowShaft: THREE.BufferGeometry
  arrowTip: THREE.BufferGeometry
  arrowFin: THREE.BufferGeometry
  pilumShaft: THREE.BufferGeometry
  pilumSocket: THREE.BufferGeometry
  pilumNeck: THREE.BufferGeometry
  pilumTip: THREE.BufferGeometry
  pilumWrap: THREE.BufferGeometry
}

let sharedProjectileVisuals: SharedProjectileVisuals | null = null

/** Projectiles are frequent transient objects; their immutable render assets must be shared. */
function getSharedProjectileVisuals(): SharedProjectileVisuals {
  if (sharedProjectileVisuals) return sharedProjectileVisuals
  sharedProjectileVisuals = {
    woodMaterial: proceduralMaterial({ kind: 'wood', color: 0x6e4722, roughness: 0.78, repeat: [2, 7] }),
    ironMaterial: proceduralMaterial({ kind: 'iron', color: 0xa8adae, metalness: 0.9, roughness: 0.3 }),
    bronzeMaterial: proceduralMaterial({ kind: 'bronze', color: 0xa77d43, roughness: 0.42, metalness: 0.7 }),
    featherMaterial: new THREE.MeshBasicMaterial({ color: 0xe8e0d0 }),
    arrowShaft: new THREE.CylinderGeometry(0.004, 0.004, 0.95, 6),
    arrowTip: new THREE.ConeGeometry(0.014, 0.09, 6),
    arrowFin: new THREE.BoxGeometry(0.003, 0.035, 0.09),
    pilumShaft: new THREE.CylinderGeometry(0.022, 0.026, 1.5, 10),
    pilumSocket: new THREE.CylinderGeometry(0.032, 0.025, 0.18, 10),
    pilumNeck: new THREE.CylinderGeometry(0.008, 0.015, 0.48, 8),
    pilumTip: new THREE.ConeGeometry(0.052, 0.2, 4),
    pilumWrap: new THREE.TorusGeometry(0.032, 0.008, 6, 10),
  }
  return sharedProjectileVisuals
}

/** Prewarms shared projectile procedural textures, materials, and geometries ahead of time. */
export function prewarmProjectileVisuals(): void {
  getSharedProjectileVisuals()
}

/** Creates a representative group containing all projectile materials & geometries for GPU compilation. */
export function createProjectileWarmupGroup(): THREE.Group {
  const shared = getSharedProjectileVisuals()
  const group = new THREE.Group()
  group.name = 'projectile-warmup-group'
  group.add(new THREE.Mesh(shared.arrowShaft, shared.woodMaterial))
  group.add(new THREE.Mesh(shared.arrowTip, shared.ironMaterial))
  group.add(new THREE.Mesh(shared.arrowFin, shared.featherMaterial))
  group.add(new THREE.Mesh(shared.pilumShaft, shared.woodMaterial))
  group.add(new THREE.Mesh(shared.pilumSocket, shared.ironMaterial))
  group.add(new THREE.Mesh(shared.pilumNeck, shared.ironMaterial))
  group.add(new THREE.Mesh(shared.pilumTip, shared.ironMaterial))
  group.add(new THREE.Mesh(shared.pilumWrap, shared.bronzeMaterial))
  return group
}

export class ArrowProjectile {
  static prewarm(): void {
    prewarmProjectileVisuals()
  }

  static getSharedVisuals(): SharedProjectileVisuals {
    return getSharedProjectileVisuals()
  }

  readonly mesh: THREE.Group
  private velocity: THREE.Vector3
  private alive = true
  private stuck = false
  private stuckTimer = 0
  private travelledDistance = 0
  private readonly tipLocalZ: number

  // ── Reusable temporary vectors (P-1: avoid per-frame GC pressure) ──
  private readonly _tmpTargetPos = new THREE.Vector3()
  private readonly previousPosition = new THREE.Vector3()
  private readonly contact: CombatContact = { kind: 'body', time: Infinity }
  private readonly bestContact: CombatContact = { kind: 'body', time: Infinity }

  readonly damage: number
  readonly shooterFaction: Faction
  readonly isPlayerFired: boolean
  readonly attribution?: ProjectileAttribution

  get isAlive(): boolean { return this.alive }
  get isStuck(): boolean { return this.stuck }

  getTipPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.mesh.localToWorld(target.set(0, 0, this.tipLocalZ))
  }

  constructor(
    scene: THREE.Scene,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    damage: number,
    shooterFaction: Faction,
    isPlayerFired: boolean = false,
    visualKind: ProjectileVisualKind = 'arrow',
    attribution?: ProjectileAttribution,
  ) {
    this.damage = damage
    this.shooterFaction = shooterFaction
    this.isPlayerFired = isPlayerFired
    this.attribution = attribution
    this.mesh = new THREE.Group()
    this.mesh.name = `${visualKind}-projectile`
    this.mesh.userData.ignoreAimRaycast = true

    const shared = getSharedProjectileVisuals()
    if (visualKind === 'pilum') {
      this.tipLocalZ = -1.4
      const shaft = new THREE.Mesh(shared.pilumShaft, shared.woodMaterial)
      shaft.rotation.x = Math.PI / 2
      shaft.castShadow = this.isPlayerFired
      this.mesh.add(shaft)

      const socket = new THREE.Mesh(shared.pilumSocket, shared.ironMaterial)
      socket.rotation.x = Math.PI / 2
      socket.position.z = -0.79
      this.mesh.add(socket)

      const ironNeck = new THREE.Mesh(shared.pilumNeck, shared.ironMaterial)
      ironNeck.rotation.x = Math.PI / 2
      ironNeck.position.z = -1.08
      this.mesh.add(ironNeck)

      const tip = new THREE.Mesh(shared.pilumTip, shared.ironMaterial)
      tip.rotation.x = -Math.PI / 2
      tip.position.z = this.tipLocalZ
      this.mesh.add(tip)

      const wrap = new THREE.Mesh(
        shared.pilumWrap,
        shared.bronzeMaterial,
      )
      wrap.position.z = 0.62
      this.mesh.add(wrap)
    } else {
      this.tipLocalZ = -0.52
      const shaft = new THREE.Mesh(shared.arrowShaft, shared.woodMaterial)
      shaft.rotation.x = Math.PI / 2
      shaft.castShadow = this.isPlayerFired
      this.mesh.add(shaft)

      const tip = new THREE.Mesh(shared.arrowTip, shared.ironMaterial)
      tip.rotation.x = -Math.PI / 2
      tip.position.z = this.tipLocalZ
      this.mesh.add(tip)

      const fin = new THREE.Mesh(shared.arrowFin, shared.featherMaterial)
      fin.position.z = 0.4
      this.mesh.add(fin)
    }

    if (!this.isPlayerFired) {
      for (const child of this.mesh.children) {
        child.castShadow = false
      }
    }

    this.mesh.position.copy(origin)
    this.velocity = direction.clone().normalize().multiplyScalar(speed)

    // Arrow geometry points down local -Z. Align that axis—not Object3D's
    // generic +Z lookAt axis—with the physical velocity.
    this._tmpTargetPos.copy(this.velocity).normalize()
    this.mesh.quaternion.setFromUnitVectors(ARROW_LOCAL_FORWARD, this._tmpTargetPos)
    scene.add(this.mesh)
  }

  update(
    dt: number,
    player: Player,
    npcs: NPC[],
    obstacles: ObstacleData[],
    onHitTarget: (damage: number, hitPos: THREE.Vector3, targetName: string, hpRatio: number, isPlayerHit: boolean, npc?: NPC, isMountHit?: boolean) => void,
    onDamagePlayer: (damage: number, context?: CombatDamageContext) => DamageResult,
    onHitObstacle?: (
      damage: number,
      hitPos: THREE.Vector3,
      obstacle: DamageableObstacle,
      hpRatio: number,
    ) => void,
    visualOnly = false,
    mounts: readonly Mount[] = [],
  ): void {
    if (!this.alive) return

    // If stuck in ground or wall, countdown decay
    if (this.stuck) {
      this.stuckTimer += dt
      if (this.stuckTimer >= 5.0) {
        this.destroy()
      }
      return
    }

    this.previousPosition.copy(this.mesh.position)
    // Apply gravity
    this.velocity.y += GRAVITY * dt

    // Move along velocity
    this.mesh.position.addScaledVector(this.velocity, dt)
    this.travelledDistance += this.velocity.length() * dt

    // Orient arrow towards velocity
    this._tmpTargetPos.copy(this.velocity).normalize()
    this.mesh.quaternion.setFromUnitVectors(ARROW_LOCAL_FORWARD, this._tmpTargetPos)

    if (visualOnly) return

    // Give the arrowhead enough clearance to leave the nock before testing
    // world geometry, then collide against the procedural terrain height—not
    // the global y=0 plane, which incorrectly swallowed shots fired in valleys.
    const worldCollisionsEnabled = this.travelledDistance >= 0.12
    const groundY = getTerrainHeight(this.mesh.position.x, this.mesh.position.z) + 0.05
    let nearest = worldCollisionsEnabled && this.mesh.position.y <= groundY
      ? Math.max(0, Math.min(1, (this.previousPosition.y - groundY) / Math.max(1e-9, this.previousPosition.y - this.mesh.position.y))) : Infinity
    let hitObstacle: ObstacleData | undefined
    let hitNpc: NPC | undefined
    let hitPlayer = false
    let hitMount: Mount | undefined

    // ── Hit Detection 2: Obstacles (Trees / Barricades / Campaign Structures) ──
    if (worldCollisionsEnabled) {
      for (const obs of obstacles) {
        const time = segmentBoxTime(this.previousPosition, this.mesh.position, obs.box)
        if (time < nearest) { nearest = time; hitObstacle = obs }
      }
    }
    const broadRadius = this.previousPosition.distanceTo(this.mesh.position) + 4
    if (this.shooterFaction === Faction.ENEMY && player.targetable
      && player.group.position.distanceToSquared(this.previousPosition) <= broadRadius * broadRadius
      && traceCombatSegment(player, this.previousPosition, this.mesh.position, this.contact) && this.contact.time < nearest) {
      nearest = this.contact.time; hitPlayer = true; hitObstacle = undefined
      Object.assign(this.bestContact, this.contact)
    }
    for (const npc of npcs) {
      if (npc.dead || npc.faction === this.shooterFaction || npc.group.position.distanceToSquared(this.previousPosition) > broadRadius * broadRadius) continue
      if (traceCombatSegment(npc, this.previousPosition, this.mesh.position, this.contact) && this.contact.time < nearest) {
        nearest = this.contact.time; hitNpc = npc; hitPlayer = false; hitObstacle = undefined
        Object.assign(this.bestContact, this.contact)
      }
    }
    // Mounts remain physical targets after release, independent of faction or NPC liveness.
    for (const mount of mounts) {
      if (mount.dead || mount.disposed || (this.isPlayerFired && mount === player.currentMount)
        || (mount.riderNpc && mount.riderNpc.combatantId === this.attribution?.source.actorId)
        || mount.group.position.distanceToSquared(this.previousPosition) > broadRadius * broadRadius) continue
      if (traceCombatSegment(mount, this.previousPosition, this.mesh.position, this.contact) && this.contact.time < nearest) {
        nearest = this.contact.time; hitMount = mount; hitNpc = undefined; hitPlayer = false; hitObstacle = undefined
        Object.assign(this.bestContact, this.contact)
      }
    }
    if (Number.isFinite(nearest)) {
      this.mesh.position.lerpVectors(this.previousPosition, this.mesh.position, nearest)
      if (hitNpc || hitPlayer || hitMount) {
        const context = this._damageContext()
        if (context) context.contact = this.bestContact
        // Unattributed projectiles still physically block, but never award XP.
        const physicalContext = context ?? {
          source: { actorId: 'unattributed-projectile', actorType: 'npc' as const, allegiance: this.shooterFaction, characterFaction: player.characterFaction },
          method: 'projectile' as const, contact: this.bestContact, hostileToTarget: false,
        }
        const playerMountHit = hitMount === player.currentMount
        const result = hitMount ? damageMount(hitMount, this.damage, physicalContext)
          : hitNpc ? damageNpc(hitNpc, this.damage, physicalContext) : onDamagePlayer(this.damage, physicalContext)
        if (result.hitSuccess) onHitTarget(result.appliedDamage, this.mesh.position.clone(), result.targetName, result.hpRatio, hitPlayer || playerMountHit, hitNpc, result.isMountHit)
        this.destroy()
        return
      }
      if (hitObstacle) {
        const damageable = hitObstacle.damageable
        const canDamageObstacle = damageable
          && !damageable.destroyed
          && (
            !this.isPlayerFired && this.attribution?.source.ownership !== 'player-personal'
            || damageable.isDamageableBy(this.attribution?.source.characterFaction ?? player.characterFaction)
          )
        if (canDamageObstacle) {
          const result = damageObstacle(damageable, this.damage, this._damageContext())
          if (result.appliedDamage > 0) {
            onHitObstacle?.(
              result.appliedDamage,
              this.mesh.position.clone(),
              damageable,
              result.hpRatio,
            )
          }
        }

      }
      this.stuck = true
      return
    }

    // Out of bounds check (despawn radius scaled with world scale)
    if (this.mesh.position.lengthSq() > 400 * 400) {
      this.destroy()
    }
  }

  private _damageContext(): CombatDamageContext | undefined {
    if (!this.attribution) return undefined
    return {
      source: this.attribution.source,
      method: 'projectile',
      weaponId: this.attribution.weaponId,
      emit: this.attribution.emit,
    }
  }

  destroy(): void {
    if (!this.alive) return
    this.alive = false
    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh)
    }
  }
}
