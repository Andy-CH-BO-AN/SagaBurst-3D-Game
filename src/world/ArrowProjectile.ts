/**
 * ArrowProjectile.ts
 * Arrow projectile with realistic parabolic gravity trajectory and hit detection on all targetable entities based on Factions.
 */
import * as THREE from 'three'
import type { DummyEnemy } from './DummyEnemy'
import { NPC, Faction } from './NPC'
import type { Player } from '../player/Player'
import { getTerrainHeight, type ObstacleData } from './Terrain'
import { damageNpc } from '../combat/DamageRouter'
import { proceduralMaterial } from './ProceduralMaterials'

const GRAVITY = -9.8 // m/s² downforce for arrow arc
const ARROW_LOCAL_FORWARD = new THREE.Vector3(0, 0, -1)
export type ProjectileVisualKind = 'arrow' | 'pilum'

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
    arrowShaft: new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6),
    arrowTip: new THREE.ConeGeometry(0.04, 0.15, 6),
    arrowFin: new THREE.BoxGeometry(0.01, 0.12, 0.18),
    pilumShaft: new THREE.CylinderGeometry(0.022, 0.026, 1.5, 10),
    pilumSocket: new THREE.CylinderGeometry(0.032, 0.025, 0.18, 10),
    pilumNeck: new THREE.CylinderGeometry(0.008, 0.015, 0.48, 8),
    pilumTip: new THREE.ConeGeometry(0.052, 0.2, 4),
    pilumWrap: new THREE.TorusGeometry(0.032, 0.008, 6, 10),
  }
  return sharedProjectileVisuals
}

export class ArrowProjectile {
  readonly mesh: THREE.Group
  private velocity: THREE.Vector3
  private alive = true
  private stuck = false
  private stuckTimer = 0
  private travelledDistance = 0
  private readonly tipLocalZ: number

  // ── Reusable temporary vectors (P-1: avoid per-frame GC pressure) ──
  private readonly _tmpTargetPos = new THREE.Vector3()

  readonly damage: number
  readonly shooterFaction: Faction
  readonly isPlayerFired: boolean

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
  ) {
    this.damage = damage
    this.shooterFaction = shooterFaction
    this.isPlayerFired = isPlayerFired
    this.mesh = new THREE.Group()
    this.mesh.name = `${visualKind}-projectile`
    this.mesh.userData.ignoreAimRaycast = true

    const shared = getSharedProjectileVisuals()
    if (visualKind === 'pilum') {
      this.tipLocalZ = -1.4
      const shaft = new THREE.Mesh(shared.pilumShaft, shared.woodMaterial)
      shaft.rotation.x = Math.PI / 2
      shaft.castShadow = true
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
      this.tipLocalZ = -0.5
      const shaft = new THREE.Mesh(shared.arrowShaft, shared.woodMaterial)
      shaft.rotation.x = Math.PI / 2
      shaft.castShadow = true
      this.mesh.add(shaft)

      const tip = new THREE.Mesh(shared.arrowTip, shared.ironMaterial)
      tip.rotation.x = -Math.PI / 2
      tip.position.z = this.tipLocalZ
      this.mesh.add(tip)

      const fin = new THREE.Mesh(shared.arrowFin, shared.featherMaterial)
      fin.position.z = 0.4
      this.mesh.add(fin)
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
    dummy: DummyEnemy,
    player: Player,
    npcs: NPC[],
    obstacles: ObstacleData[],
    onHitTarget: (damage: number, hitPos: THREE.Vector3, targetName: string, hpRatio: number, isPlayerHit: boolean, npc?: NPC, isMountHit?: boolean) => void
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

    // Apply gravity
    this.velocity.y += GRAVITY * dt

    // Move along velocity
    this.mesh.position.addScaledVector(this.velocity, dt)
    this.travelledDistance += this.velocity.length() * dt

    // Orient arrow towards velocity
    this._tmpTargetPos.copy(this.velocity).normalize()
    this.mesh.quaternion.setFromUnitVectors(ARROW_LOCAL_FORWARD, this._tmpTargetPos)

    // Give the arrowhead enough clearance to leave the nock before testing
    // world geometry, then collide against the procedural terrain height—not
    // the global y=0 plane, which incorrectly swallowed shots fired in valleys.
    const worldCollisionsEnabled = this.travelledDistance >= 0.12
    const groundY = getTerrainHeight(this.mesh.position.x, this.mesh.position.z) + 0.05
    if (worldCollisionsEnabled && this.mesh.position.y <= groundY) {
      this.mesh.position.y = groundY
      this.stuck = true
      return
    }

    // ── Hit Detection 2: Obstacles (Rocks / Trees / Barricades) ──
    if (worldCollisionsEnabled) {
      for (const obs of obstacles) {
        if (obs.box.containsPoint(this.mesh.position)) {
          this.stuck = true
          return
        }
      }
    }

    // ── Hit Detection 3: Dummy Enemy ──
    if (this.shooterFaction === Faction.PLAYER && !dummy.dead) {
      const enemyCenter = dummy.position.clone()
      enemyCenter.y += 1.0 // Torso height

      const dist = this.mesh.position.distanceTo(enemyCenter)
      if (dist <= 0.9) {
        const hitSuccess = dummy.takeDamage(this.damage)
        if (hitSuccess) {
          onHitTarget(this.damage, this.mesh.position.clone(), '訓練假人 Dummy Target', dummy.hpRatio, false)
        }
        this.destroy()
        return
      }
    }

    // ── Hit Detection 4: Player (If shooter is ENEMY) ──
    if (this.shooterFaction === Faction.ENEMY && !player.dead) {
      const playerCenter = player.combatPosition.clone()
      playerCenter.y += 1.0 // Torso height
      const dist = this.mesh.position.distanceTo(playerCenter)
      if (dist <= 0.9) {
        if (player.isMounted && player.currentMount) {
          const mount = player.currentMount
          const hitSuccess = mount.takeDamage(this.damage)
          if (hitSuccess) {
            const mountName = `坐騎：${mount.displayName}`
            onHitTarget(this.damage, this.mesh.position.clone(), mountName, mount.currentHp / mount.maxHp, true, undefined, true)
            if (mount.dead) player.dismountFromMount()
          }
        } else {
          onHitTarget(this.damage, this.mesh.position.clone(), 'Player', player.hpRatio, true, undefined, false)
        }
        this.destroy()
        return
      }
    }

    // ── Hit Detection 5: NPCs (Faction Check) ──
    for (const npc of npcs) {
      if (npc.dead || npc.faction === this.shooterFaction) continue
      const aiCenter = npc.combatPosition.clone()
      aiCenter.y += 1.0 // Torso height

      const dist = this.mesh.position.distanceTo(aiCenter)
      if (dist <= 1.0) {
        const result = damageNpc(npc, this.damage)
        if (result.hitSuccess) {
          onHitTarget(this.damage, this.mesh.position.clone(), result.targetName, result.hpRatio, false, npc, result.isMountHit)
        }
        this.destroy()
        return
      }
    }

    // Out of bounds check
    if (this.mesh.position.lengthSq() > 200 * 200) {
      this.destroy()
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
